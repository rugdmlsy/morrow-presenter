const STORAGE_KEY = 'morrow-presenter.deck.v1';
const VALID_LAYOUTS = new Set(['title-body', 'title', 'section', 'blank']);
const VALID_SHAPES = new Set(['rect', 'rounded-rect', 'ellipse', 'line', 'arrow']);
const VALID_TRANSITIONS = new Set(['none', 'fade']);
const SLIDE_ASPECT = 16 / 9;
const DEFAULT_IMAGE_WIDTH = 40;
const isNative = Boolean(window.webkit?.messageHandlers?.presenter);

const el = Object.fromEntries([
  'deck-title','slide-list','slide-canvas','layout-select','insert-text','shape-kind','insert-shape','choose-image',
  'slide-background','slide-transition','toggle-notes','notes-panel','slide-notes','object-toolbar','selection-count',
  'font-family','font-size','text-bold','text-italic','text-underline','text-align','text-color','object-fill','no-fill',
  'object-stroke','no-stroke','stroke-width','rotation','opacity','crop-toggle','crop-reset','object-order','object-align',
  'lock-object','duplicate-object','delete-object','add-slide','duplicate-slide','delete-slide','new-deck','open-deck',
  'save-deck','save-as','import-file','present','save-status','object-status','slide-position','presentation','presentation-slide',
  'presentation-counter','presentation-progress-bar','exit-presentation','undo','redo'
].map(id => [id.replace(/-([a-z])/g, (_, c) => c.toUpperCase()), document.querySelector(`#${id}`)]));

function uid() { return crypto.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function numberOr(value, fallback) { return typeof value === 'number' && Number.isFinite(value) ? value : fallback; }
function clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }
function deepClone(value) { return JSON.parse(JSON.stringify(value)); }
function imageHeightForWidth(width, iw, ih) { const aspect = iw > 0 && ih > 0 ? iw / ih : SLIDE_ASPECT; return width * SLIDE_ASPECT / aspect; }
function colorInputValue(value, fallback = '#ffffff') { return /^#[0-9a-f]{6}$/i.test(value || '') ? value : fallback; }
function cropClipPath(image) { const { top, right, bottom, left } = image.crop; return `inset(${top}% ${right}% ${bottom}% ${left}%)`; }

function normalizeCrop(candidate) {
  const crop = candidate && typeof candidate === 'object' ? candidate : {};
  const c = { left: clamp(numberOr(crop.left, 0), 0, 95), top: clamp(numberOr(crop.top, 0), 0, 95), right: clamp(numberOr(crop.right, 0), 0, 95), bottom: clamp(numberOr(crop.bottom, 0), 0, 95) };
  if (c.left + c.right > 95) c.right = Math.max(0, 95 - c.left);
  if (c.top + c.bottom > 95) c.bottom = Math.max(0, 95 - c.top);
  return c;
}
function normalizeTransition(candidate) {
  if (typeof candidate === 'string') candidate = { type: candidate };
  candidate = candidate && typeof candidate === 'object' ? candidate : {};
  return { type: VALID_TRANSITIONS.has(candidate.type) ? candidate.type : 'none', duration: clamp(numberOr(candidate.duration, .35), .05, 5) };
}
function safeAssetPath(path) {
  if (typeof path !== 'string' || !path.trim()) throw new Error('Invalid image path');
  const clean = path.replace(/\\/g, '/');
  const parts = clean.split('/');
  if (clean.startsWith('/') || parts.includes('..')) throw new Error('Image path must stay inside the deck directory');
  return clean;
}
function commonElement(candidate, width, height) {
  return {
    id: typeof candidate.id === 'string' && candidate.id ? candidate.id : uid(),
    x: clamp(numberOr(candidate.x, 10), -300, 300), y: clamp(numberOr(candidate.y, 10), -300, 300),
    width: clamp(numberOr(candidate.width, width), .5, 400), height: clamp(numberOr(candidate.height, height), .5, 400),
    rotation: ((numberOr(candidate.rotation, 0) % 360) + 360) % 360,
    opacity: clamp(numberOr(candidate.opacity, 1), 0, 1), locked: typeof candidate.locked === 'boolean' ? candidate.locked : false,
  };
}
function textStyle(candidate, defaults = {}) {
  const aligns = new Set(['left','center','right']); const valigns = new Set(['top','middle','bottom']);
  return {
    fontFamily: typeof candidate.fontFamily === 'string' ? candidate.fontFamily : (defaults.fontFamily || 'Inter'),
    fontSize: clamp(numberOr(candidate.fontSize, defaults.fontSize ?? 28), 4, 300),
    fontWeight: Math.round(clamp(numberOr(candidate.fontWeight, defaults.fontWeight ?? 400), 100, 900)),
    italic: typeof candidate.italic === 'boolean' ? candidate.italic : false,
    underline: typeof candidate.underline === 'boolean' ? candidate.underline : false,
    color: typeof candidate.color === 'string' ? candidate.color : (defaults.color || '#202124'),
    align: aligns.has(candidate.align) ? candidate.align : (defaults.align || 'left'),
    verticalAlign: valigns.has(candidate.verticalAlign) ? candidate.verticalAlign : (defaults.verticalAlign || 'top'),
  };
}
function normalizeElement(candidate) {
  if (!candidate || typeof candidate !== 'object') throw new Error('Invalid slide element');
  let type = candidate.type;
  if (!type && candidate.path) type = 'image';
  if (type === 'image') {
    const path = safeAssetPath(candidate.path);
    const iw = Math.max(1, numberOr(candidate.intrinsicWidth, 16)); const ih = Math.max(1, numberOr(candidate.intrinsicHeight, 9));
    const width = clamp(numberOr(candidate.width, DEFAULT_IMAGE_WIDTH), 1, 400); const height = imageHeightForWidth(width, iw, ih);
    const c = commonElement({ ...candidate, width, height }, width, height);
    return { id: c.id, type:'image', path, alt: typeof candidate.alt === 'string' ? candidate.alt : '', x:c.x,y:c.y,width,height,intrinsicWidth:iw,intrinsicHeight:ih,crop:normalizeCrop(candidate.crop),rotation:c.rotation,opacity:c.opacity,locked:c.locked };
  }
  if (type === 'text') {
    const c = commonElement(candidate, 35, 18);
    return { id:c.id,type:'text',text:typeof candidate.text==='string'?candidate.text:'',x:c.x,y:c.y,width:c.width,height:c.height,rotation:c.rotation,opacity:c.opacity,locked:c.locked,fill:typeof candidate.fill==='string'?candidate.fill:'transparent',stroke:typeof candidate.stroke==='string'?candidate.stroke:'transparent',strokeWidth:clamp(numberOr(candidate.strokeWidth,0),0,20),padding:clamp(numberOr(candidate.padding,1.2),0,20),...textStyle(candidate) };
  }
  if (type === 'shape') {
    const c = commonElement(candidate, 25, 18); const shape = VALID_SHAPES.has(candidate.shape) ? candidate.shape : 'rect';
    return { id:c.id,type:'shape',shape,text:typeof candidate.text==='string'?candidate.text:'',x:c.x,y:c.y,width:c.width,height:c.height,rotation:c.rotation,opacity:c.opacity,locked:c.locked,fill:typeof candidate.fill==='string'?candidate.fill:'#e8e8e4',stroke:typeof candidate.stroke==='string'?candidate.stroke:'#4b4d50',strokeWidth:clamp(numberOr(candidate.strokeWidth,1.5),0,20),...textStyle(candidate,{fontSize:20,align:'center',verticalAlign:'middle'}) };
  }
  throw new Error(`Unsupported element type: ${type}`);
}
function migrateLegacyImage(candidate) {
  if (!candidate) return null;
  const image = { ...candidate, type:'image' }; const iw = Math.max(1,numberOr(image.intrinsicWidth,16)); const ih=Math.max(1,numberOr(image.intrinsicHeight,9));
  if (image.x == null && ['right','left','background','full'].includes(image.placement)) {
    let width=100,x=0; if (image.placement==='right') {width=40;x=55;} else if (image.placement==='left') {width=40;x=5;}
    const height=imageHeightForWidth(width,iw,ih); Object.assign(image,{x,y:(100-height)/2,width,height});
  }
  return normalizeElement(image);
}
function emptySlide(layout='title-body') {
  return { id:uid(),layout,title:'',body:'',background:layout==='section'?'#202124':'#ffffff',notes:'',transition:{type:'none',duration:.35},elements:[] };
}
function starterDeck() { const first=emptySlide('title'); return {version:1,title:'Untitled deck',selectedId:first.id,slides:[first]}; }
function normalizeDeck(candidate) {
  if (!candidate || !Array.isArray(candidate.slides) || !candidate.slides.length) throw new Error('Invalid deck: slides are missing');
  const seenSlides=new Set();
  const slides=candidate.slides.map(raw=>{
    let id=typeof raw.id==='string'&&raw.id?raw.id:uid(); if(seenSlides.has(id)) id=uid(); seenSlides.add(id);
    const layout=VALID_LAYOUTS.has(raw.layout)?raw.layout:'title-body'; const seenElements=new Set(); const elements=[];
    for(const input of Array.isArray(raw.elements)?raw.elements:[]) { const e=normalizeElement(input); if(seenElements.has(e.id)) e.id=uid(); seenElements.add(e.id); elements.push(e); }
    const legacy=migrateLegacyImage(raw.image); if(legacy && !elements.some(e=>e.type==='image'&&e.path===legacy.path&&Math.abs(e.x-legacy.x)<.001&&Math.abs(e.y-legacy.y)<.001)) { if(seenElements.has(legacy.id)) legacy.id=uid(); elements.push(legacy); }
    return { id,layout,title:typeof raw.title==='string'?raw.title:'',body:typeof raw.body==='string'?raw.body:'',background:typeof raw.background==='string'?raw.background:(layout==='section'?'#202124':'#ffffff'),notes:typeof raw.notes==='string'?raw.notes:'',transition:normalizeTransition(raw.transition),elements };
  });
  const selectedId=slides.some(s=>s.id===candidate.selectedId)?candidate.selectedId:slides[0].id;
  return {version:1,title:typeof candidate.title==='string'&&candidate.title.trim()?candidate.title:'Untitled deck',selectedId,slides};
}

function loadBrowserDeck() { try { const raw=localStorage.getItem(STORAGE_KEY); return raw?normalizeDeck(JSON.parse(raw)):starterDeck(); } catch(error){ console.warn(error); return starterDeck(); } }
let state=isNative?starterDeck():loadBrowserDeck();
let currentPath=null,presentationIndex=0,savePulse,autosaveTimer,notesVisible=false,editingElementId=null,cropElementId=null,primaryElementId=null;
let selectedElementIds=new Set(); let objectClipboard=[]; const undoStack=[],redoStack=[]; const MAX_HISTORY=100; let continuousSnapshot=null;
const assetCache=new Map(),assetWaiters=new Map(),assetRequests=new Map();

function selectedIndex(){return Math.max(0,state.slides.findIndex(s=>s.id===state.selectedId));}
function selectedSlide(){return state.slides[selectedIndex()];}
function elementById(id){return selectedSlide()?.elements.find(e=>e.id===id)||null;}
function selectedElements(){const slide=selectedSlide(); return slide?slide.elements.filter(e=>selectedElementIds.has(e.id)):[];}
function primaryElement(){return elementById(primaryElementId)||selectedElements().at(-1)||null;}
function pathBasename(path){return path?.split('/').filter(Boolean).pop()||'Untitled.morrowdeck';}
function nativePost(action,payload={}){if(isNative) window.webkit.messageHandlers.presenter.postMessage({action,...payload});}

function setSaveStatus(text,pulse=false){el.saveStatus.textContent=text;clearTimeout(savePulse);el.saveStatus.style.opacity='1';if(pulse)savePulse=setTimeout(()=>{el.saveStatus.style.opacity='.72';},700);}
function scheduleAutosave(){if(!isNative||!currentPath)return;clearTimeout(autosaveTimer);autosaveTimer=setTimeout(()=>nativePost('autosave',{deck:state}),180);}
function persist(){if(isNative){if(currentPath){setSaveStatus(`${pathBasename(currentPath)} · 正在保存…`);scheduleAutosave();}else setSaveStatus('未保存 · ⌘S 保存');}else{localStorage.setItem(STORAGE_KEY,JSON.stringify(state));setSaveStatus('已保存到浏览器',true);}}
function stateSnapshot(){return JSON.stringify(state);}
function pushSnapshot(snapshot){if(!snapshot)return;if(undoStack.at(-1)!==snapshot){undoStack.push(snapshot);if(undoStack.length>MAX_HISTORY)undoStack.shift();}redoStack.length=0;syncHistoryButtons();}
function checkpoint(){pushSnapshot(stateSnapshot());}
function beginContinuousEdit(){continuousSnapshot=stateSnapshot();}
function markContinuousEdit(){if(continuousSnapshot){pushSnapshot(continuousSnapshot);continuousSnapshot=null;}}
function syncHistoryButtons(){el.undo.disabled=!undoStack.length;el.redo.disabled=!redoStack.length;}
function restoreSnapshot(snapshot){state=normalizeDeck(JSON.parse(snapshot));selectedElementIds.clear();primaryElementId=null;editingElementId=null;cropElementId=null;render();}
function undo(){if(!undoStack.length)return;redoStack.push(stateSnapshot());restoreSnapshot(undoStack.pop());syncHistoryButtons();persist();}
function redo(){if(!redoStack.length)return;undoStack.push(stateSnapshot());restoreSnapshot(redoStack.pop());syncHistoryButtons();persist();}

function loadAssetInto(img,path){if(!path)return;if(assetCache.has(path)){img.src=assetCache.get(path);img.classList.remove('asset-loading','asset-error');return;}img.classList.add('asset-loading');if(!isNative){img.classList.add('asset-error');return;}if(assetWaiters.has(path)){assetWaiters.get(path).push(img);return;}assetWaiters.set(path,[img]);const requestId=uid();assetRequests.set(requestId,path);nativePost('loadAsset',{requestId,path});}

function clearSelection(rerender=true){selectedElementIds.clear();primaryElementId=null;editingElementId=null;cropElementId=null;if(rerender)renderEditor();syncObjectToolbar();}
function setSelection(ids,primary=null,rerender=true){selectedElementIds=new Set(ids.filter(id=>elementById(id)));primaryElementId=primary&&selectedElementIds.has(primary)?primary:[...selectedElementIds].at(-1)||null;if(!selectedElementIds.has(editingElementId))editingElementId=null;if(!selectedElementIds.has(cropElementId))cropElementId=null;if(rerender)renderEditor();else syncSelectionClasses();syncObjectToolbar();}
function selectElement(id,event,rerender=true){const modifier=Boolean(event?.shiftKey||event?.metaKey);if(modifier){const next=new Set(selectedElementIds);if(next.has(id))next.delete(id);else next.add(id);setSelection([...next],next.has(id)?id:[...next].at(-1),rerender);}else if(!(selectedElementIds.size===1&&selectedElementIds.has(id))){setSelection([id],id,rerender);}else{primaryElementId=id;syncObjectToolbar();}}
function syncSelectionClasses(){el.slideCanvas.querySelectorAll('.slide-element').forEach(node=>node.classList.toggle('selected',selectedElementIds.has(node.dataset.elementId)));}

function applyTextStyle(node,e){node.style.fontFamily=e.fontFamily;node.style.fontSize=`${e.fontSize/12.8}cqw`;node.style.fontWeight=String(e.fontWeight);node.style.fontStyle=e.italic?'italic':'normal';node.style.textDecoration=e.underline?'underline':'none';node.style.color=e.color;node.style.textAlign=e.align;node.style.justifyContent={top:'flex-start',middle:'center',bottom:'flex-end'}[e.verticalAlign]||'flex-start';}
function applyElementGeometry(frame,e){frame.style.left=`${e.x}%`;frame.style.top=`${e.y}%`;frame.style.width=`${e.width}%`;frame.style.height=`${e.height}%`;frame.style.transform=`rotate(${e.rotation}deg)`;frame.style.opacity=String(e.opacity);}
function updateCropGeometry(frame,e){const main=frame.querySelector('.image-main');if(main)main.style.clipPath=cropClipPath(e);const {left,top,right,bottom}=e.crop;const outline=frame.querySelector('.crop-outline');if(outline){outline.style.left=`${left}%`;outline.style.top=`${top}%`;outline.style.width=`${100-left-right}%`;outline.style.height=`${100-top-bottom}%`;}for(const side of ['left','right','top','bottom']){const h=frame.querySelector(`.crop-${side}`);if(!h)continue;if(side==='left'||side==='right'){h.style.left=`${side==='left'?left:100-right}%`;h.style.top=`${top}%`;h.style.height=`${100-top-bottom}%`;}else{h.style.left=`${left}%`;h.style.top=`${side==='top'?top:100-bottom}%`;h.style.width=`${100-left-right}%`;}}}
function shapeVisual(e){
  if(e.shape==='line'||e.shape==='arrow'){
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 100 100');svg.classList.add('shape-svg');
    const line=document.createElementNS(svg.namespaceURI,'line');line.setAttribute('x1','3');line.setAttribute('y1','50');line.setAttribute('x2',e.shape==='arrow'?'86':'97');line.setAttribute('y2','50');line.setAttribute('stroke',e.stroke);line.setAttribute('stroke-width',String(Math.max(.5,e.strokeWidth)));line.setAttribute('vector-effect','non-scaling-stroke');svg.append(line);
    if(e.shape==='arrow'){const poly=document.createElementNS(svg.namespaceURI,'polygon');poly.setAttribute('points','84,37 98,50 84,63');poly.setAttribute('fill',e.stroke);svg.append(poly);}return svg;
  }
  const visual=document.createElement('div');visual.className=`shape-visual shape-${e.shape}`;visual.style.background=e.fill;visual.style.borderColor=e.stroke;visual.style.borderWidth=`${e.strokeWidth}px`;return visual;
}
function makeTextContent(e,editable=false){const node=document.createElement('div');node.className='object-text-content';node.textContent=e.text;applyTextStyle(node,e);if(editable){node.contentEditable='true';node.classList.add('editing');node.spellcheck=true;node.addEventListener('pointerdown',ev=>ev.stopPropagation());node.addEventListener('focus',beginContinuousEdit);node.addEventListener('input',()=>{markContinuousEdit();e.text=node.innerText;persist();renderList();});node.addEventListener('blur',()=>{editingElementId=null;continuousSnapshot=null;persist();renderList();});node.addEventListener('keydown',ev=>{if(ev.key==='Escape'){ev.preventDefault();node.blur();renderEditor();}});}return node;}

function makeElementFrame(e,mode='editor',index=0){const interactive=mode==='editor';const frame=document.createElement('div');frame.className=`slide-element element-${e.type}${selectedElementIds.has(e.id)&&interactive?' selected':''}${e.locked?' locked':''}`;frame.dataset.elementId=e.id;frame.style.zIndex=String(10+index);applyElementGeometry(frame,e);
  if(e.type==='image'){
    if(interactive&&cropElementId===e.id){const ghost=document.createElement('img');ghost.className='element-image crop-ghost';ghost.draggable=false;loadAssetInto(ghost,e.path);frame.append(ghost);}
    const img=document.createElement('img');img.className='element-image image-main';img.alt=e.alt||'';img.draggable=false;img.style.clipPath=cropClipPath(e);img.addEventListener('load',()=>nativePost('assetRendered',{path:e.path}),{once:true});loadAssetInto(img,e.path);frame.append(img);
  }else if(e.type==='text'){
    frame.style.background=e.fill;frame.style.borderColor=e.stroke;frame.style.borderWidth=`${e.strokeWidth}px`;frame.style.padding=`${e.padding||0}%`;frame.append(makeTextContent(e,interactive&&editingElementId===e.id));
  }else if(e.type==='shape'){
    frame.append(shapeVisual(e));if(e.text||interactive){const text=makeTextContent(e,interactive&&editingElementId===e.id);text.classList.add('shape-text-content');frame.append(text);}
  }
  if(interactive){
    frame.addEventListener('pointerdown',ev=>startElementMove(ev,e,frame));frame.addEventListener('dblclick',ev=>{if((e.type==='text'||e.type==='shape')&&!e.locked){ev.preventDefault();setSelection([e.id],e.id,false);editingElementId=e.id;cropElementId=null;renderEditor();requestAnimationFrame(()=>{const n=el.slideCanvas.querySelector(`[data-element-id="${e.id}"] .object-text-content`);n?.focus();document.execCommand?.('selectAll',false,null);});}});
    if(selectedElementIds.size===1&&selectedElementIds.has(e.id)&&!e.locked){
      if(e.type==='image'&&cropElementId===e.id){const outline=document.createElement('div');outline.className='crop-outline';frame.append(outline);for(const side of ['left','right','top','bottom']){const h=document.createElement('div');h.className=`crop-handle crop-${side}`;h.addEventListener('pointerdown',ev=>startCropEdge(ev,e,frame,side));frame.append(h);}updateCropGeometry(frame,e);}
      else{for(const corner of ['nw','ne','se','sw']){const h=document.createElement('div');h.className=`resize-handle resize-${corner}`;h.addEventListener('pointerdown',ev=>startElementResize(ev,e,frame,corner));frame.append(h);}const rot=document.createElement('div');rot.className='rotation-handle';rot.title='旋转';rot.addEventListener('pointerdown',ev=>startElementRotation(ev,e,frame));frame.append(rot);}
    }
  }
  return frame;
}

function selectedMovable(){return selectedElements().filter(e=>!e.locked);}
function startElementMove(event,e,frame){if(event.button!==0||editingElementId===e.id||event.target.closest('.resize-handle,.rotation-handle,.crop-handle'))return;if(cropElementId===e.id)return;event.preventDefault();const wasSelected=selectedElementIds.has(e.id);if(!wasSelected)selectElement(e.id,event,false);else if(event.shiftKey||event.metaKey){selectElement(e.id,event,false);return;}if(e.locked)return;const movers=selectedMovable();if(!movers.length)return;checkpoint();const rect=el.slideCanvas.getBoundingClientRect(),sx=event.clientX,sy=event.clientY,orig=movers.map(x=>[x,x.x,x.y]);
  const move=next=>{const dx=(next.clientX-sx)/rect.width*100,dy=(next.clientY-sy)/rect.height*100;for(const [obj,x,y] of orig){obj.x=clamp(x+dx,-300,300);obj.y=clamp(y+dy,-300,300);const n=el.slideCanvas.querySelector(`[data-element-id="${obj.id}"]`);if(n)applyElementGeometry(n,obj);}syncObjectToolbar();};
  const end=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',end);window.removeEventListener('pointercancel',end);persist();renderList();renderEditor();};window.addEventListener('pointermove',move);window.addEventListener('pointerup',end,{once:true});window.addEventListener('pointercancel',end,{once:true});}
function startElementResize(event,e,frame,corner){event.stopPropagation();event.preventDefault();checkpoint();const rect=el.slideCanvas.getBoundingClientRect();const ox=e.x,oy=e.y,ow=e.width,oh=e.height;const east=corner.includes('e'),south=corner.includes('s');const anchorX=east?ox:ox+ow,anchorY=south?oy:oy+oh;const ratio=oh/ow;
  const move=next=>{const px=(next.clientX-rect.left)/rect.width*100,py=(next.clientY-rect.top)/rect.height*100;let w=Math.max(2,Math.abs(px-anchorX)),h=Math.max(2,Math.abs(py-anchorY));if(e.type==='image'||next.shiftKey){const fromH=h/ratio;if(fromH>w)w=fromH;h=w*ratio;}e.width=clamp(w,2,400);e.height=clamp(h,2,400);e.x=east?anchorX:anchorX-e.width;e.y=south?anchorY:anchorY-e.height;applyElementGeometry(frame,e);if(e.type==='image')updateCropGeometry(frame,e);syncObjectToolbar();};
  const end=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',end);persist();renderList();renderEditor();};window.addEventListener('pointermove',move);window.addEventListener('pointerup',end,{once:true});}
function startElementRotation(event,e,frame){event.stopPropagation();event.preventDefault();checkpoint();const rect=el.slideCanvas.getBoundingClientRect();const cx=rect.left+(e.x+e.width/2)/100*rect.width,cy=rect.top+(e.y+e.height/2)/100*rect.height;const initial=Math.atan2(event.clientY-cy,event.clientX-cx)*180/Math.PI,origin=e.rotation;
  const move=next=>{const angle=Math.atan2(next.clientY-cy,next.clientX-cx)*180/Math.PI;e.rotation=(origin+angle-initial+360)%360;applyElementGeometry(frame,e);syncObjectToolbar();};const end=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',end);persist();renderList();renderEditor();};window.addEventListener('pointermove',move);window.addEventListener('pointerup',end,{once:true});}
function startCropEdge(event,e,frame,side){event.stopPropagation();event.preventDefault();checkpoint();const rect=el.slideCanvas.getBoundingClientRect();const fullLeft=e.x/100*rect.width,fullTop=e.y/100*rect.height,fullWidth=e.width/100*rect.width,fullHeight=e.height/100*rect.height;const initial={...e.crop};
  const move=next=>{if(side==='left')e.crop.left=clamp((next.clientX-rect.left-fullLeft)/fullWidth*100,0,95-initial.right);else if(side==='right')e.crop.right=clamp(100-(next.clientX-rect.left-fullLeft)/fullWidth*100,0,95-initial.left);else if(side==='top')e.crop.top=clamp((next.clientY-rect.top-fullTop)/fullHeight*100,0,95-initial.bottom);else e.crop.bottom=clamp(100-(next.clientY-rect.top-fullTop)/fullHeight*100,0,95-initial.top);updateCropGeometry(frame,e);};const end=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',end);persist();renderList();syncObjectToolbar();};window.addEventListener('pointermove',move);window.addEventListener('pointerup',end,{once:true});}

function renderPlaceholder(slide,mode){const text=document.createElement('div');text.className=`${mode==='editor'?'slide':'present'}-text placeholder-layer`;if(slide.layout==='blank')return text;if(mode==='editor'){
    const title=document.createElement('textarea');title.className='slide-title-input';title.value=slide.title;title.placeholder='输入标题';title.rows=slide.layout==='title-body'?2:3;title.addEventListener('focus',beginContinuousEdit);title.addEventListener('input',()=>{markContinuousEdit();slide.title=title.value;persist();renderList();});
    const body=document.createElement('textarea');body.className='slide-body-input';body.value=slide.body;body.placeholder='输入正文；可用换行组织内容';body.rows=slide.layout==='section'?2:8;body.addEventListener('focus',beginContinuousEdit);body.addEventListener('input',()=>{markContinuousEdit();slide.body=body.value;persist();renderList();});text.append(title,body);
  }else{const title=document.createElement('div');title.className='present-title';title.textContent=slide.title||'';text.append(title);if(slide.layout!=='title'&&slide.body){const body=document.createElement('div');body.className='present-body';body.textContent=slide.body;text.append(body);}}
  return text;}
function renderThumbPlaceholders(slide,inner){if(slide.layout==='blank')return;const title=document.createElement('div');title.className='thumb-title';title.textContent=slide.title||'Untitled';const body=document.createElement('div');body.className='thumb-body';body.textContent=slide.body;inner.append(title,body);}

function render(){el.deckTitle.value=state.title;renderList();renderEditor();renderStatus();syncHistoryButtons();}
function renderList(){el.slideList.replaceChildren();state.slides.forEach((slide,index)=>{const row=document.createElement('div');row.className='slide-thumb-row';const number=document.createElement('div');number.className='slide-number';number.textContent=String(index+1);const thumb=document.createElement('button');thumb.className=`slide-thumb${slide.id===state.selectedId?' selected':''}`;thumb.type='button';thumb.draggable=true;thumb.dataset.id=slide.id;const inner=document.createElement('div');inner.className=`thumb-inner ${slide.layout}`;inner.style.background=slide.background;renderThumbPlaceholders(slide,inner);slide.elements.forEach((e,i)=>inner.append(makeElementFrame(e,'thumb',i)));thumb.append(inner);row.append(number,thumb);el.slideList.append(row);thumb.addEventListener('click',()=>selectSlide(slide.id));thumb.addEventListener('dragstart',ev=>{ev.dataTransfer.effectAllowed='move';ev.dataTransfer.setData('text/plain',slide.id);});thumb.addEventListener('dragover',ev=>{ev.preventDefault();thumb.classList.add('drag-over');});thumb.addEventListener('dragleave',()=>thumb.classList.remove('drag-over'));thumb.addEventListener('drop',ev=>{ev.preventDefault();thumb.classList.remove('drag-over');moveSlide(ev.dataTransfer.getData('text/plain'),slide.id);});});}
function renderEditor(){const slide=selectedSlide();if(!slide)return;el.layoutSelect.value=slide.layout;el.slideBackground.value=colorInputValue(slide.background,slide.layout==='section'?'#202124':'#ffffff');el.slideTransition.value=slide.transition.type;el.slideNotes.value=slide.notes;el.notesPanel.hidden=!notesVisible;el.toggleNotes.classList.toggle('active',notesVisible);el.slideCanvas.replaceChildren();const content=document.createElement('div');content.className=`slide-content ${slide.layout}`;content.style.background=slide.background;content.append(renderPlaceholder(slide,'editor'));content.addEventListener('pointerdown',ev=>{if(ev.target===content||ev.target.classList.contains('placeholder-layer'))clearSelection();});slide.elements.forEach((e,i)=>content.append(makeElementFrame(e,'editor',i)));el.slideCanvas.append(content);syncObjectToolbar();if(editingElementId)requestAnimationFrame(()=>el.slideCanvas.querySelector(`[data-element-id="${editingElementId}"] .object-text-content`)?.focus());}
function renderStatus(){el.slidePosition.textContent=`${selectedIndex()+1} / ${state.slides.length}`;el.objectStatus.textContent=selectedElementIds.size?`${selectedElementIds.size} object${selectedElementIds.size>1?'s':''} selected`:`${selectedSlide()?.elements.length||0} objects`;}

function syncObjectToolbar(){const items=selectedElements(),primary=primaryElement();el.selectionCount.textContent=items.length?`${items.length} 个对象`:'未选择对象';const has=items.length>0,textual=items.filter(e=>e.type==='text'||e.type==='shape'),single=items.length===1;for(const node of el.objectToolbar.querySelectorAll('button,input,select'))node.disabled=!has;el.objectAlign.disabled=items.length<2;el.cropToggle.disabled=!(single&&primary?.type==='image');el.cropReset.disabled=!(single&&primary?.type==='image');el.fontFamily.disabled=!textual.length;el.fontSize.disabled=!textual.length;el.textBold.disabled=!textual.length;el.textItalic.disabled=!textual.length;el.textUnderline.disabled=!textual.length;el.textAlign.disabled=!textual.length;el.textColor.disabled=!textual.length;el.objectFill.disabled=!items.some(e=>e.type==='text'||e.type==='shape');el.noFill.disabled=el.objectFill.disabled;el.objectStroke.disabled=el.objectFill.disabled;el.noStroke.disabled=el.objectFill.disabled;el.strokeWidth.disabled=el.objectFill.disabled;if(!primary){renderStatus();return;}
  if(primary.type==='text'||primary.type==='shape'){el.fontFamily.value=[...el.fontFamily.options].some(o=>o.value===primary.fontFamily)?primary.fontFamily:'Inter';el.fontSize.value=String(primary.fontSize);el.textBold.classList.toggle('active',primary.fontWeight>=700);el.textItalic.classList.toggle('active',primary.italic);el.textUnderline.classList.toggle('active',primary.underline);el.textAlign.value=primary.align;el.textColor.value=colorInputValue(primary.color,'#202124');el.objectFill.value=colorInputValue(primary.fill,'#e8e8e4');el.noFill.classList.toggle('active',primary.fill==='transparent');el.objectStroke.value=colorInputValue(primary.stroke,'#4b4d50');el.noStroke.classList.toggle('active',primary.stroke==='transparent');el.strokeWidth.value=String(primary.strokeWidth);}el.rotation.value=String(Math.round(primary.rotation*10)/10);el.opacity.value=String(Math.round(primary.opacity*100));el.cropToggle.classList.toggle('active',cropElementId===primary.id);el.lockObject.classList.toggle('active',primary.locked);el.lockObject.textContent=primary.locked?'解锁':'锁定';renderStatus();}

function selectSlide(id){if(!state.slides.some(s=>s.id===id))return;state.selectedId=id;selectedElementIds.clear();primaryElementId=null;editingElementId=null;cropElementId=null;continuousSnapshot=null;persist();render();}
function selectSlideRef(ref){if(ref==null||ref==='')return;const position=Number(ref);if(Number.isInteger(position)&&position>=1&&position<=state.slides.length)state.selectedId=state.slides[position-1].id;else if(state.slides.some(s=>s.id===ref))state.selectedId=ref;}
function addSlide(){checkpoint();const index=selectedIndex(),slide=emptySlide('title-body');state.slides.splice(index+1,0,slide);state.selectedId=slide.id;selectedElementIds.clear();persist();render();requestAnimationFrame(()=>el.slideCanvas.querySelector('.slide-title-input')?.focus());}
function duplicateSlide(){checkpoint();const index=selectedIndex(),copy=deepClone(selectedSlide());copy.id=uid();copy.elements.forEach(e=>e.id=uid());state.slides.splice(index+1,0,copy);state.selectedId=copy.id;selectedElementIds.clear();persist();render();}
function deleteSlide(){checkpoint();const index=selectedIndex();if(state.slides.length===1){const id=state.slides[0].id;state.slides[0]=emptySlide();state.slides[0].id=id;}else{state.slides.splice(index,1);state.selectedId=state.slides[Math.min(index,state.slides.length-1)].id;}selectedElementIds.clear();persist();render();}
function moveSlide(sourceId,targetId){if(!sourceId||sourceId===targetId)return;const si=state.slides.findIndex(s=>s.id===sourceId),ti=state.slides.findIndex(s=>s.id===targetId);if(si<0||ti<0)return;checkpoint();const [slide]=state.slides.splice(si,1);state.slides.splice(state.slides.findIndex(s=>s.id===targetId),0,slide);persist();renderList();}

function insertText(){checkpoint();const e=normalizeElement({type:'text',text:'文本框',x:15,y:15,width:32,height:14,fontSize:28});selectedSlide().elements.push(e);setSelection([e.id],e.id,false);editingElementId=e.id;persist();render();}
function insertShape(){checkpoint();const shape=el.shapeKind.value;const e=normalizeElement({type:'shape',shape,x:30,y:30,width:25,height:18,fill:'#e8e8e4',stroke:'#4b4d50',strokeWidth:1.5,text:''});selectedSlide().elements.push(e);setSelection([e.id],e.id,false);persist();render();}
function chooseImage(){if(!isNative){alert('图片资产目前需要在 Morrow Presenter Mac App 中添加。');return;}nativePost('chooseImage',{deck:state});}
function deleteSelected(){const ids=new Set(selectedElementIds);if(!ids.size)return;checkpoint();selectedSlide().elements=selectedSlide().elements.filter(e=>!ids.has(e.id));selectedElementIds.clear();primaryElementId=null;editingElementId=null;cropElementId=null;persist();render();}
function duplicateSelected(){const originals=selectedElements();if(!originals.length)return;checkpoint();const copies=[];for(const e of originals){const c=deepClone(e);c.id=uid();c.x+=2;c.y+=2;copies.push(c);selectedSlide().elements.push(c);}setSelection(copies.map(e=>e.id),copies.at(-1).id,false);persist();render();}
function copySelected(){objectClipboard=selectedElements().map(deepClone);}
function cutSelected(){if(!selectedElementIds.size)return;copySelected();deleteSelected();}
function pasteElements(){if(!objectClipboard.length)return;checkpoint();const copies=objectClipboard.map(e=>{const c=deepClone(e);c.id=uid();c.x+=2;c.y+=2;return c;});selectedSlide().elements.push(...copies);objectClipboard=copies.map(deepClone);setSelection(copies.map(e=>e.id),copies.at(-1).id,false);persist();render();}
function applyToSelected(fn,predicate=()=>true){const items=selectedElements().filter(predicate);if(!items.length)return;checkpoint();items.forEach(fn);persist();render();}
function reorderPrimary(mode){const p=primaryElement();if(!p)return;checkpoint();const arr=selectedSlide().elements,idx=arr.findIndex(e=>e.id===p.id);arr.splice(idx,1);let target=idx;if(mode==='front')target=arr.length;else if(mode==='back')target=0;else if(mode==='forward')target=Math.min(arr.length,idx+1);else if(mode==='backward')target=Math.max(0,idx-1);arr.splice(target,0,p);persist();render();}
function alignSelected(mode){const items=selectedElements();if(items.length<2)return;if(mode.startsWith('distribute')&&items.length<3)return;checkpoint();const minX=Math.min(...items.map(e=>e.x)),maxR=Math.max(...items.map(e=>e.x+e.width)),minY=Math.min(...items.map(e=>e.y)),maxB=Math.max(...items.map(e=>e.y+e.height));if(mode==='left')items.forEach(e=>e.x=minX);else if(mode==='center'){const t=(minX+maxR)/2;items.forEach(e=>e.x=t-e.width/2);}else if(mode==='right')items.forEach(e=>e.x=maxR-e.width);else if(mode==='top')items.forEach(e=>e.y=minY);else if(mode==='middle'){const t=(minY+maxB)/2;items.forEach(e=>e.y=t-e.height/2);}else if(mode==='bottom')items.forEach(e=>e.y=maxB-e.height);else if(mode==='distribute-h'){const o=[...items].sort((a,b)=>a.x-b.x),gap=(maxR-minX-o.reduce((s,e)=>s+e.width,0))/(o.length-1);let c=minX;o.forEach(e=>{e.x=c;c+=e.width+gap;});}else if(mode==='distribute-v'){const o=[...items].sort((a,b)=>a.y-b.y),gap=(maxB-minY-o.reduce((s,e)=>s+e.height,0))/(o.length-1);let c=minY;o.forEach(e=>{e.y=c;c+=e.height+gap;});}persist();render();}
function toggleCrop(){const p=primaryElement();if(selectedElementIds.size!==1||p?.type!=='image')return;cropElementId=cropElementId===p.id?null:p.id;editingElementId=null;renderEditor();}
function resetCrop(){const p=primaryElement();if(p?.type!=='image')return;checkpoint();p.crop={left:0,top:0,right:0,bottom:0};persist();render();}
function nudgeSelected(dx,dy){const items=selectedMovable();if(!items.length)return;checkpoint();items.forEach(e=>{e.x+=dx;e.y+=dy;});persist();render();}

function downloadDeck(){const blob=new Blob([`${JSON.stringify(state,null,2)}\n`],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a'),filename=(state.title||'deck').replace(/[\\/:*?"<>|]+/g,'-').trim()||'deck';a.href=url;a.download=`${filename}.morrowdeck`;a.click();URL.revokeObjectURL(url);}
function saveDeck(force=false){clearTimeout(autosaveTimer);if(isNative)nativePost(force?'saveAs':'save',{deck:state});else downloadDeck();}
function newDeck(){if(!confirm('新建演示文稿会关闭当前文稿。继续吗？'))return;checkpoint();state=starterDeck();currentPath=null;selectedElementIds.clear();if(isNative)nativePost('new');else localStorage.removeItem(STORAGE_KEY);persist();render();}
function openDeck(){if(isNative)nativePost('open');else el.importFile.click();}
async function importDeck(file){if(!file)return;try{checkpoint();state=normalizeDeck(JSON.parse(await file.text()));selectedElementIds.clear();persist();render();}catch(error){alert(`无法打开：${error.message}`);}finally{el.importFile.value='';}}

function buildPresentationSlide(slide,animate=true){el.presentationSlide.replaceChildren();const content=document.createElement('div');content.className=`present-content ${slide.layout}`;content.style.background=slide.background;content.append(renderPlaceholder(slide,'present'));slide.elements.forEach((e,i)=>content.append(makeElementFrame(e,'present',i)));if(animate&&slide.transition.type==='fade'){content.classList.add('transition-fade');content.style.animationDuration=`${slide.transition.duration}s`;}el.presentationSlide.append(content);el.presentationCounter.textContent=`${presentationIndex+1} / ${state.slides.length}`;el.presentationProgressBar.style.width=`${((presentationIndex+1)/state.slides.length)*100}%`;}
async function startPresentation(){presentationIndex=selectedIndex();buildPresentationSlide(state.slides[presentationIndex]);el.presentation.hidden=false;document.body.style.overflow='hidden';if(isNative)nativePost('presentStart');else try{await el.presentation.requestFullscreen?.();}catch{}}
async function exitPresentation(){if(el.presentation.hidden)return;el.presentation.hidden=true;document.body.style.overflow='hidden';if(isNative)nativePost('presentEnd');else if(document.fullscreenElement)try{await document.exitFullscreen();}catch{}}
function nextSlide(delta){presentationIndex=clamp(presentationIndex+delta,0,state.slides.length-1);buildPresentationSlide(state.slides[presentationIndex]);}

window.addEventListener('error',event=>nativePost('runtimeError',{message:event.message||'JavaScript error'}));
window.addEventListener('unhandledrejection',event=>nativePost('runtimeError',{message:String(event.reason||'Unhandled promise rejection')}));
window.presenterDiagnosticSelfTest=()=>{
  try{
    state=starterDeck();state.slides[0].layout='blank';state.slides[0].background='#fafafa';selectedElementIds.clear();primaryElementId=null;undoStack.length=0;redoStack.length=0;
    insertText();const text=primaryElement();text.text='Selftest text';editingElementId=null;
    insertShape();const shape=primaryElement();shape.text='Selftest shape';
    setSelection([text.id,shape.id],shape.id,false);alignSelected('top');
    if(Math.abs(text.y-shape.y)>.001)throw new Error('align failed');
    copySelected();pasteElements();const pasted=selectedSlide().elements.length;
    if(pasted!==4)throw new Error(`paste count ${pasted}`);
    undo();if(selectedSlide().elements.length!==2)throw new Error('undo failed');
    redo();if(selectedSlide().elements.length!==4)throw new Error('redo failed');
    setSelection(selectedSlide().elements.map(e=>e.id),selectedSlide().elements.at(-1).id,false);
    const target=true;applyToSelected(e=>{if(e.type!=='image')e.italic=target;},e=>e.type!=='image');
    if(selectedSlide().elements.some(e=>e.type!=='image'&&!e.italic))throw new Error('format failed');
    nativePost('diagnostic',{message:`gui-selftest PASS elements=${selectedSlide().elements.length} undo=${undoStack.length} redo=${redoStack.length}`});
  }catch(error){nativePost('runtimeError',{message:`gui-selftest FAIL ${error.message}`});}
};
window.presenterNativeContext=({path})=>{currentPath=path||null;setSaveStatus(currentPath?`${pathBasename(currentPath)} · 已保存`:'未保存 · ⌘S 保存',true);};
window.presenterNativeSaved=({path})=>{currentPath=path;setSaveStatus(`${pathBasename(path)} · 已保存`,true);};
window.presenterNativeLoad=({json,path,present,slide})=>{try{state=normalizeDeck(JSON.parse(json));currentPath=path;selectSlideRef(slide);undoStack.length=redoStack.length=0;selectedElementIds.clear();render();setSaveStatus(`${pathBasename(path)} · 已保存`,true);if(present)setTimeout(startPresentation,80);}catch(error){alert(`无法打开文稿：${error.message}`);}};
window.presenterNativeExternalLoad=({json,path})=>{try{const oldSlide=state.selectedId,oldSelection=[...selectedElementIds];state=normalizeDeck(JSON.parse(json));if(state.slides.some(s=>s.id===oldSlide))state.selectedId=oldSlide;selectedElementIds=new Set(oldSelection.filter(id=>elementById(id)));currentPath=path;render();setSaveStatus(`${pathBasename(path)} · 已同步 shell 修改`,true);}catch(error){console.warn(error);}};
window.presenterNativeImageChosen=({path,name,width,height})=>{checkpoint();const iw=Math.max(1,numberOr(width,16)),ih=Math.max(1,numberOr(height,9)),w=DEFAULT_IMAGE_WIDTH,h=imageHeightForWidth(w,iw,ih);const e=normalizeElement({type:'image',path,alt:name||'',x:55,y:(100-h)/2,width:w,intrinsicWidth:iw,intrinsicHeight:ih,crop:{left:0,top:0,right:0,bottom:0}});selectedSlide().elements.push(e);setSelection([e.id],e.id,false);persist();render();};
window.presenterNativeAsset=({requestId,path,dataURL,error})=>{const expected=assetRequests.get(requestId)||path;assetRequests.delete(requestId);const waiters=assetWaiters.get(expected)||[];assetWaiters.delete(expected);if(dataURL)assetCache.set(expected,dataURL);waiters.forEach(img=>{img.classList.remove('asset-loading');if(dataURL){img.src=dataURL;img.classList.remove('asset-error');}else{img.classList.add('asset-error');img.title=error||'Unable to load image';}});};
window.presenterNativeFullscreenEnded=()=>{if(!el.presentation.hidden){el.presentation.hidden=true;document.body.style.overflow='hidden';}};
window.presenterMenuAction=action=>{if(action==='new')newDeck();else if(action==='save')saveDeck(false);else if(action==='saveAs')saveDeck(true);else if(action==='present')startPresentation();else if(action==='undo')undo();else if(action==='redo')redo();else if(action==='copy')copySelected();else if(action==='cut')cutSelected();else if(action==='paste')pasteElements();else if(action==='selectAll')setSelection(selectedSlide().elements.map(e=>e.id),selectedSlide().elements.at(-1)?.id);};

el.deckTitle.addEventListener('focus',beginContinuousEdit);el.deckTitle.addEventListener('input',()=>{markContinuousEdit();state.title=el.deckTitle.value;persist();});
el.layoutSelect.addEventListener('change',()=>{checkpoint();selectedSlide().layout=el.layoutSelect.value;if(el.layoutSelect.value==='section'&&selectedSlide().background==='#ffffff')selectedSlide().background='#202124';persist();render();});
el.slideBackground.addEventListener('input',()=>{checkpoint();selectedSlide().background=el.slideBackground.value;persist();renderList();renderEditor();});
el.slideTransition.addEventListener('change',()=>{checkpoint();selectedSlide().transition.type=el.slideTransition.value;persist();});
el.toggleNotes.addEventListener('click',()=>{notesVisible=!notesVisible;renderEditor();if(notesVisible)requestAnimationFrame(()=>el.slideNotes.focus());});
el.slideNotes.addEventListener('focus',beginContinuousEdit);el.slideNotes.addEventListener('input',()=>{markContinuousEdit();selectedSlide().notes=el.slideNotes.value;persist();});
el.insertText.addEventListener('click',insertText);el.insertShape.addEventListener('click',insertShape);el.chooseImage.addEventListener('click',chooseImage);
el.fontFamily.addEventListener('change',()=>applyToSelected(e=>e.fontFamily=el.fontFamily.value,e=>e.type!=='image'));el.fontSize.addEventListener('change',()=>applyToSelected(e=>e.fontSize=clamp(Number(el.fontSize.value)||28,4,300),e=>e.type!=='image'));el.textBold.addEventListener('click',()=>{const p=primaryElement(),target=p?.fontWeight>=700?400:700;applyToSelected(e=>e.fontWeight=target,e=>e.type!=='image');});el.textItalic.addEventListener('click',()=>{const p=primaryElement(),target=!p?.italic;applyToSelected(e=>e.italic=target,e=>e.type!=='image');});el.textUnderline.addEventListener('click',()=>{const p=primaryElement(),target=!p?.underline;applyToSelected(e=>e.underline=target,e=>e.type!=='image');});el.textAlign.addEventListener('change',()=>applyToSelected(e=>e.align=el.textAlign.value,e=>e.type!=='image'));el.textColor.addEventListener('input',()=>applyToSelected(e=>e.color=el.textColor.value,e=>e.type!=='image'));
el.objectFill.addEventListener('input',()=>applyToSelected(e=>e.fill=el.objectFill.value,e=>e.type!=='image'));el.noFill.addEventListener('click',()=>applyToSelected(e=>e.fill='transparent',e=>e.type!=='image'));el.objectStroke.addEventListener('input',()=>applyToSelected(e=>e.stroke=el.objectStroke.value,e=>e.type!=='image'));el.noStroke.addEventListener('click',()=>applyToSelected(e=>e.stroke='transparent',e=>e.type!=='image'));el.strokeWidth.addEventListener('change',()=>applyToSelected(e=>e.strokeWidth=clamp(Number(el.strokeWidth.value)||0,0,20),e=>e.type!=='image'));el.rotation.addEventListener('change',()=>applyToSelected(e=>e.rotation=((Number(el.rotation.value)||0)%360+360)%360));el.opacity.addEventListener('change',()=>applyToSelected(e=>e.opacity=clamp((Number(el.opacity.value)||0)/100,0,1)));el.cropToggle.addEventListener('click',toggleCrop);el.cropReset.addEventListener('click',resetCrop);el.objectOrder.addEventListener('change',()=>{if(el.objectOrder.value)reorderPrimary(el.objectOrder.value);el.objectOrder.value='';});el.objectAlign.addEventListener('change',()=>{if(el.objectAlign.value)alignSelected(el.objectAlign.value);el.objectAlign.value='';});el.lockObject.addEventListener('click',()=>{const p=primaryElement();if(p){const target=!p.locked;applyToSelected(e=>e.locked=target);}});el.duplicateObject.addEventListener('click',duplicateSelected);el.deleteObject.addEventListener('click',deleteSelected);
el.addSlide.addEventListener('click',addSlide);el.duplicateSlide.addEventListener('click',duplicateSlide);el.deleteSlide.addEventListener('click',deleteSlide);el.newDeck.addEventListener('click',newDeck);el.openDeck.addEventListener('click',openDeck);el.saveDeck.addEventListener('click',()=>saveDeck(false));el.saveAs.addEventListener('click',()=>saveDeck(true));el.importFile.addEventListener('change',()=>importDeck(el.importFile.files?.[0]));el.present.addEventListener('click',startPresentation);el.exitPresentation.addEventListener('click',exitPresentation);el.undo.addEventListener('click',undo);el.redo.addEventListener('click',redo);
if(!isNative)document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement&&!el.presentation.hidden)exitPresentation();});

function isTypingTarget(target){return target instanceof HTMLInputElement||target instanceof HTMLTextAreaElement||target instanceof HTMLSelectElement||target?.isContentEditable;}
document.addEventListener('keydown',event=>{
  if(!el.presentation.hidden){if(['ArrowRight','ArrowDown','PageDown',' '].includes(event.key)){event.preventDefault();nextSlide(1);}else if(['ArrowLeft','ArrowUp','PageUp'].includes(event.key)){event.preventDefault();nextSlide(-1);}else if(event.key==='Home'){presentationIndex=0;buildPresentationSlide(state.slides[0]);}else if(event.key==='End'){presentationIndex=state.slides.length-1;buildPresentationSlide(state.slides[presentationIndex]);}else if(event.key==='Escape')exitPresentation();return;}
  const typing=isTypingTarget(event.target);
  if(event.metaKey&&event.key.toLowerCase()==='z'){event.preventDefault();event.shiftKey?redo():undo();return;}
  if(event.metaKey&&event.key.toLowerCase()==='s'){event.preventDefault();saveDeck(event.shiftKey);return;}
  if(event.metaKey&&event.key==='Enter'){event.preventDefault();startPresentation();return;}
  if(typing)return;
  if(event.metaKey&&event.key.toLowerCase()==='a'){event.preventDefault();const all=selectedSlide().elements;setSelection(all.map(e=>e.id),all.at(-1)?.id);}
  else if(event.metaKey&&event.key.toLowerCase()==='c'){event.preventDefault();copySelected();}
  else if(event.metaKey&&event.key.toLowerCase()==='x'){event.preventDefault();cutSelected();}
  else if(event.metaKey&&event.key.toLowerCase()==='v'){event.preventDefault();pasteElements();}
  else if(event.metaKey&&event.key.toLowerCase()==='d'){event.preventDefault();selectedElementIds.size?duplicateSelected():duplicateSlide();}
  else if(event.metaKey&&event.shiftKey&&event.key.toLowerCase()==='n'){event.preventDefault();addSlide();}
  else if((event.key==='Delete'||event.key==='Backspace')&&selectedElementIds.size){event.preventDefault();deleteSelected();}
  else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)&&selectedElementIds.size){event.preventDefault();const step=event.shiftKey?2:0.25;nudgeSelected(event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0,event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0);}
  else if(event.metaKey&&event.key.toLowerCase()==='b'){event.preventDefault();const p=primaryElement(),target=p?.fontWeight>=700?400:700;applyToSelected(e=>e.fontWeight=target,e=>e.type!=='image');}
  else if(event.metaKey&&event.key.toLowerCase()==='i'){event.preventDefault();const p=primaryElement(),target=!p?.italic;applyToSelected(e=>e.italic=target,e=>e.type!=='image');}
  else if(event.metaKey&&event.key.toLowerCase()==='u'){event.preventDefault();const p=primaryElement(),target=!p?.underline;applyToSelected(e=>e.underline=target,e=>e.type!=='image');}
  else if(event.key==='Escape'){if(cropElementId||editingElementId){cropElementId=null;editingElementId=null;renderEditor();}else clearSelection();}
});

render();if(isNative)nativePost('ready');
