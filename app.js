const STORAGE_KEY = 'morrow-presenter.deck.v1';
const VALID_LAYOUTS = new Set(['title-body', 'title', 'section', 'blank']);
const VALID_SHAPES = new Set(['rect', 'rounded-rect', 'ellipse', 'line', 'arrow']);
const VALID_TRANSITIONS = new Set(['none', 'fade']);
const VALID_CONNECTOR_ARROWS = new Set(['none','end','both']);
const VALID_CONNECTOR_ANCHORS = new Set(['auto','top','right','bottom','left','center']);
const VALID_TEXT_ROLES = new Set(['title','body']);
const THEME_PRESETS = {
  default:{name:'default',fontFamily:'Inter',titleFontFamily:'Inter',background:'#ffffff',text:'#202124',accent:'#2563eb'},
  dark:{name:'dark',fontFamily:'Inter',titleFontFamily:'Inter',background:'#202124',text:'#f5f5f4',accent:'#60a5fa'},
  warm:{name:'warm',fontFamily:'Georgia',titleFontFamily:'Georgia',background:'#f7f0e5',text:'#362f2a',accent:'#a44a3f'},
  blue:{name:'blue',fontFamily:'Inter',titleFontFamily:'Inter',background:'#f5f8ff',text:'#14213d',accent:'#2563eb'},
};
const SLIDE_ASPECT = 16 / 9;
const DEFAULT_IMAGE_WIDTH = 40;
const isNative = Boolean(window.webkit?.messageHandlers?.presenter);

const el = Object.fromEntries([
  'deck-title','slide-list','slide-canvas','layout-select','insert-text','shape-kind','insert-shape','choose-image','insert-table','connect-selected',
  'theme-preset','toggle-snap','toggle-grid','toggle-guides','toggle-element-labels','slide-background','slide-transition','toggle-notes','notes-panel','slide-notes','object-toolbar','selection-count',
  'text-role','font-family','font-size','text-bold','text-italic','text-underline','text-align','text-color','object-fill','no-fill',
  'object-stroke','no-stroke','stroke-width','rotation','opacity','crop-toggle','crop-reset','connector-arrow','connector-dash','object-order','object-align',
  'table-row-add','table-row-delete','table-col-add','table-col-delete','group-objects','ungroup-objects','lock-object','duplicate-object','delete-object','add-slide','duplicate-slide','delete-slide','new-deck','open-deck',
  'save-deck','save-as','export-pdf','export-pptx','import-file','present','save-status','object-status','slide-position','presentation','presentation-slide',
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
    groupId: typeof candidate.groupId === 'string' && candidate.groupId ? candidate.groupId : null,
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
function normalizeTheme(candidate){candidate=candidate&&typeof candidate==='object'?candidate:{};const name=THEME_PRESETS[candidate.name]?candidate.name:'default';const base={...THEME_PRESETS[name]};for(const key of ['fontFamily','titleFontFamily','background','text','accent'])if(typeof candidate[key]==='string'&&candidate[key])base[key]=candidate[key];return base;}
function normalizeView(candidate){candidate=candidate&&typeof candidate==='object'?candidate:{};const nums=(name,def)=>Array.isArray(candidate[name])?candidate[name].slice(0,20).map(v=>clamp(numberOr(v,50),-300,300)):[...def];return{snapToObjects:typeof candidate.snapToObjects==='boolean'?candidate.snapToObjects:true,snapToGrid:typeof candidate.snapToGrid==='boolean'?candidate.snapToGrid:false,showGrid:typeof candidate.showGrid==='boolean'?candidate.showGrid:false,showGuides:typeof candidate.showGuides==='boolean'?candidate.showGuides:true,showElementLabels:typeof candidate.showElementLabels==='boolean'?candidate.showElementLabels:false,gridSize:clamp(numberOr(candidate.gridSize,2.5),.25,25),guideX:nums('guideX',[50]),guideY:nums('guideY',[50])};}
function normalizeConnectorEndpoint(candidate){candidate=candidate&&typeof candidate==='object'?candidate:{};const elementId=typeof candidate.elementId==='string'&&candidate.elementId?candidate.elementId:null,anchor=VALID_CONNECTOR_ANCHORS.has(candidate.anchor)?candidate.anchor:'auto';const out={elementId,anchor};if(!elementId){out.x=clamp(numberOr(candidate.x,10),-300,300);out.y=clamp(numberOr(candidate.y,10),-300,300);}return out;}
function normalizeTableElement(candidate){const rows=clamp(Math.round(numberOr(candidate.rows,3)),1,50),cols=clamp(Math.round(numberOr(candidate.cols,3)),1,30),source=Array.isArray(candidate.cells)?candidate.cells:[],cells=[];for(let r=0;r<rows;r++){const row=Array.isArray(source[r])?source[r]:[];cells.push(Array.from({length:cols},(_,c)=>typeof row[c]==='string'?row[c]:''));}const c=commonElement(candidate,55,Math.max(12,rows*8));return{id:c.id,type:'table',rows,cols,cells,x:c.x,y:c.y,width:c.width,height:c.height,rotation:c.rotation,opacity:c.opacity,locked:c.locked,groupId:c.groupId,fill:typeof candidate.fill==='string'?candidate.fill:'#ffffff',headerFill:typeof candidate.headerFill==='string'?candidate.headerFill:'#e8e8e4',stroke:typeof candidate.stroke==='string'?candidate.stroke:'#777777',strokeWidth:clamp(numberOr(candidate.strokeWidth,1),0,20),...textStyle(candidate,{fontSize:18,verticalAlign:'middle'})};}
function normalizeConnectorElement(candidate){const c=commonElement(candidate,100,100);return{id:c.id,type:'connector',from:normalizeConnectorEndpoint(candidate.from),to:normalizeConnectorEndpoint(candidate.to),arrow:VALID_CONNECTOR_ARROWS.has(candidate.arrow)?candidate.arrow:'end',stroke:typeof candidate.stroke==='string'?candidate.stroke:'#4b4d50',strokeWidth:clamp(numberOr(candidate.strokeWidth,2),.5,20),dash:Boolean(candidate.dash),opacity:c.opacity,locked:c.locked,groupId:c.groupId,x:0,y:0,width:100,height:100,rotation:0};}

function normalizeElement(candidate) {
  if (!candidate || typeof candidate !== 'object') throw new Error('Invalid slide element');
  let type = candidate.type;
  if (!type && candidate.path) type = 'image';
  if (type === 'image') {
    const path = safeAssetPath(candidate.path);
    const iw = Math.max(1, numberOr(candidate.intrinsicWidth, 16)); const ih = Math.max(1, numberOr(candidate.intrinsicHeight, 9));
    const width = clamp(numberOr(candidate.width, DEFAULT_IMAGE_WIDTH), 1, 400); const height = imageHeightForWidth(width, iw, ih);
    const c = commonElement({ ...candidate, width, height }, width, height);
    return { id: c.id, type:'image', path, alt: typeof candidate.alt === 'string' ? candidate.alt : '', x:c.x,y:c.y,width,height,intrinsicWidth:iw,intrinsicHeight:ih,crop:normalizeCrop(candidate.crop),rotation:c.rotation,opacity:c.opacity,locked:c.locked,groupId:c.groupId };
  }
  if (type === 'text') {
    const c = commonElement(candidate, 35, 18);
    const role=VALID_TEXT_ROLES.has(candidate.role)?candidate.role:null;
    return { id:c.id,type:'text',role,text:typeof candidate.text==='string'?candidate.text:'',x:c.x,y:c.y,width:c.width,height:c.height,rotation:c.rotation,opacity:c.opacity,locked:c.locked,groupId:c.groupId,fill:typeof candidate.fill==='string'?candidate.fill:'transparent',stroke:typeof candidate.stroke==='string'?candidate.stroke:'transparent',strokeWidth:clamp(numberOr(candidate.strokeWidth,0),0,20),padding:clamp(numberOr(candidate.padding,1.2),0,20),...textStyle(candidate) };
  }
  if (type === 'shape') {
    const c = commonElement(candidate, 25, 18); const shape = VALID_SHAPES.has(candidate.shape) ? candidate.shape : 'rect';
    return { id:c.id,type:'shape',shape,text:typeof candidate.text==='string'?candidate.text:'',x:c.x,y:c.y,width:c.width,height:c.height,rotation:c.rotation,opacity:c.opacity,locked:c.locked,groupId:c.groupId,fill:typeof candidate.fill==='string'?candidate.fill:'#e8e8e4',stroke:typeof candidate.stroke==='string'?candidate.stroke:'#4b4d50',strokeWidth:clamp(numberOr(candidate.strokeWidth,1.5),0,20),...textStyle(candidate,{fontSize:20,align:'center',verticalAlign:'middle'}) };
  }
  if(type==='table')return normalizeTableElement(candidate);
  if(type==='connector')return normalizeConnectorElement(candidate);
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
function roleTemplate(role,layout,theme,text=''){
  const title=role==='title', section=layout==='section';
  if(title){
    const geom=layout==='title-body'?{x:8.5,y:8.5,width:83,height:16,fontSize:42,align:'left'}:{x:10,y:section?29:31,width:80,height:section?24:38,fontSize:54,align:'center'};
    return normalizeElement({type:'text',role:'title',text,...geom,fontFamily:theme.titleFontFamily,fontWeight:700,color:section?'#f5f5f4':theme.text,verticalAlign:'middle',fill:'transparent',stroke:'transparent'});
  }
  const geom=section?{x:15,y:57,width:70,height:18,fontSize:24,align:'center',verticalAlign:'middle'}:{x:8.5,y:30,width:83,height:56,fontSize:24,align:'left',verticalAlign:'top'};
  return normalizeElement({type:'text',role:'body',text,...geom,fontFamily:theme.fontFamily,fontWeight:400,color:section?'#d7d7d4':theme.text,fill:'transparent',stroke:'transparent'});
}
function roleElement(slide,role){return slide.elements.find(e=>e.type==='text'&&e.role===role)||null;}
function expectedRoles(layout){return layout==='title'?['title']:layout==='title-body'||layout==='section'?['title','body']:[];}
function ensureRole(slide,role,theme,text=undefined){let e=roleElement(slide,role);if(!e){e=roleTemplate(role,slide.layout,theme,text||'');if(role==='title')slide.elements.unshift(e);else slide.elements.push(e);}else if(text!==undefined)e.text=text;return e;}
function applyLayoutTemplate(slide,layout,theme){
  const previous=slide.layout;slide.layout=layout;const expected=new Set(expectedRoles(layout));
  if(layout==='section'&&(slide.background===theme.background||slide.background==='#ffffff'))slide.background='#202124';
  else if(previous==='section'&&layout!=='section'&&slide.background==='#202124')slide.background=theme.background;
  slide.elements=slide.elements.filter(e=>!(e.type==='text'&&e.role&&!expected.has(e.role)&&!String(e.text||'').trim()));
  for(const role of expectedRoles(layout)){let e=roleElement(slide,role);const text=e?.text||'';const template=roleTemplate(role,layout,theme,text);if(e){const id=e.id,groupId=e.groupId,locked=e.locked,opacity=e.opacity;Object.assign(e,template,{id,groupId,locked,opacity});}else if(role==='title')slide.elements.unshift(template);else slide.elements.push(template);}
}
function emptySlide(layout='title-body',theme=normalizeTheme(null)) {
  const slide={id:uid(),layout,background:layout==='section'?'#202124':theme.background,notes:'',transition:{type:'none',duration:.35},elements:[]};
  for(const role of expectedRoles(layout))slide.elements.push(roleTemplate(role,layout,theme,''));return slide;
}
function starterDeck(){const theme=normalizeTheme(null),first=emptySlide('title',theme);return{version:1,title:'Untitled deck',selectedId:first.id,theme,view:normalizeView(null),slides:[first]};}
function normalizeDeck(candidate) {
  if (!candidate || !Array.isArray(candidate.slides) || !candidate.slides.length) throw new Error('Invalid deck: slides are missing');
  const theme=normalizeTheme(candidate.theme),seenSlides=new Set();
  const slides=candidate.slides.map(raw=>{
    let id=typeof raw.id==='string'&&raw.id?raw.id:uid();if(seenSlides.has(id))id=uid();seenSlides.add(id);
    const layout=VALID_LAYOUTS.has(raw.layout)?raw.layout:'title-body',seenElements=new Set(),elements=[],seenRoles=new Set();
    for(const input of Array.isArray(raw.elements)?raw.elements:[]){const e=normalizeElement(input);if(e.type==='text'&&e.role){if(seenRoles.has(e.role))e.role=null;else seenRoles.add(e.role);}if(seenElements.has(e.id))e.id=uid();seenElements.add(e.id);elements.push(e);}
    const slide={id,layout,background:typeof raw.background==='string'?raw.background:(layout==='section'?'#202124':theme.background),notes:typeof raw.notes==='string'?raw.notes:'',transition:normalizeTransition(raw.transition),elements};
    const legacyTitle=typeof raw.title==='string'?raw.title:undefined,legacyBody=typeof raw.body==='string'?raw.body:undefined;
    if(!roleElement(slide,'title')&&((legacyTitle!==undefined&&legacyTitle!=='')||expectedRoles(layout).includes('title')))slide.elements.unshift(roleTemplate('title',layout,theme,legacyTitle||''));
    if(!roleElement(slide,'body')&&((legacyBody!==undefined&&legacyBody!=='')||expectedRoles(layout).includes('body')))slide.elements.push(roleTemplate('body',layout,theme,legacyBody||''));
    const legacy=migrateLegacyImage(raw.image);if(legacy&&!slide.elements.some(e=>e.type==='image'&&e.path===legacy.path&&Math.abs(e.x-legacy.x)<.001&&Math.abs(e.y-legacy.y)<.001)){if(seenElements.has(legacy.id))legacy.id=uid();slide.elements.push(legacy);}
    const validIds=new Set(slide.elements.map(e=>e.id));for(const e of slide.elements)if(e.type==='connector')for(const endpoint of [e.from,e.to])if(endpoint.elementId&&!validIds.has(endpoint.elementId)){endpoint.elementId=null;endpoint.x=10;endpoint.y=10;}
    return slide;
  });
  const selectedId=slides.some(s=>s.id===candidate.selectedId)?candidate.selectedId:slides[0].id;
  return {version:1,title:typeof candidate.title==='string'&&candidate.title.trim()?candidate.title:'Untitled deck',selectedId,theme,view:normalizeView(candidate.view),slides};
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
function groupMemberIds(id){const e=elementById(id);if(!e?.groupId)return[id];return selectedSlide().elements.filter(x=>x.groupId===e.groupId).map(x=>x.id);}
function selectElement(id,event,rerender=true){const modifier=Boolean(event?.shiftKey||event?.metaKey),members=groupMemberIds(id);if(modifier){const next=new Set(selectedElementIds),all=members.every(x=>next.has(x));for(const x of members)all?next.delete(x):next.add(x);setSelection([...next],next.has(id)?id:[...next].at(-1),rerender);}else if(!(members.length===selectedElementIds.size&&members.every(x=>selectedElementIds.has(x)))){setSelection(members,id,rerender);}else{primaryElementId=id;syncObjectToolbar();}}
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
function makeTextContent(e,editable=false){const node=document.createElement('div');node.className=`object-text-content${e.text?'':' empty'}`;node.dataset.placeholder=e.role==='title'?'输入标题':e.role==='body'?'输入正文':'输入文本';node.textContent=e.text;applyTextStyle(node,e);if(editable){node.contentEditable='true';node.classList.add('editing');node.spellcheck=true;node.addEventListener('pointerdown',ev=>ev.stopPropagation());node.addEventListener('focus',beginContinuousEdit);node.addEventListener('input',()=>{markContinuousEdit();e.text=node.innerText;node.classList.toggle('empty',!e.text);persist();renderList();updateElementLabels();});node.addEventListener('blur',()=>{editingElementId=null;continuousSnapshot=null;persist();renderList();});node.addEventListener('keydown',ev=>{if(ev.key==='Escape'){ev.preventDefault();node.blur();renderEditor();}});}return node;}

function elementCenter(e){return{x:e.x+e.width/2,y:e.y+e.height/2};}
function connectorPoint(endpoint,other){if(endpoint.elementId){const e=elementById(endpoint.elementId)||selectedSlide()?.elements.find(x=>x.id===endpoint.elementId);if(e){const c=elementCenter(e),anchor=endpoint.anchor==='auto'?(Math.abs(other.x-c.x)>Math.abs(other.y-c.y)?(other.x>=c.x?'right':'left'):(other.y>=c.y?'bottom':'top')):endpoint.anchor;if(anchor==='top')return{x:c.x,y:e.y};if(anchor==='right')return{x:e.x+e.width,y:c.y};if(anchor==='bottom')return{x:c.x,y:e.y+e.height};if(anchor==='left')return{x:e.x,y:c.y};return c;}}return{x:numberOr(endpoint.x,10),y:numberOr(endpoint.y,10)};}
function connectorPoints(e){let a=e.from.elementId?elementCenter(elementById(e.from.elementId)||{x:10,y:10,width:0,height:0}):{x:numberOr(e.from.x,10),y:numberOr(e.from.y,10)},b=e.to.elementId?elementCenter(elementById(e.to.elementId)||{x:80,y:80,width:0,height:0}):{x:numberOr(e.to.x,80),y:numberOr(e.to.y,80)};a=connectorPoint(e.from,b);b=connectorPoint(e.to,a);return[a,b];}
function connectorSVG(e,interactive=false){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.classList.add('connector-svg');svg.setAttribute('viewBox','0 0 100 100');svg.setAttribute('preserveAspectRatio','none');const [a,b]=connectorPoints(e);const line=document.createElementNS(svg.namespaceURI,'line');line.classList.add('connector-line');for(const [k,v] of Object.entries({x1:a.x,y1:a.y,x2:b.x,y2:b.y,stroke:e.stroke,'stroke-width':Math.max(.3,e.strokeWidth*.18),'stroke-dasharray':e.dash?'1.5 1.2':'none'}))line.setAttribute(k,String(v));line.setAttribute('vector-effect','non-scaling-stroke');if(e.arrow!=='none'){const id=`marker-${e.id.replace(/[^a-z0-9]/gi,'')}`;const defs=document.createElementNS(svg.namespaceURI,'defs'),marker=document.createElementNS(svg.namespaceURI,'marker');marker.setAttribute('id',id);marker.setAttribute('viewBox','0 0 10 10');marker.setAttribute('refX','9');marker.setAttribute('refY','5');marker.setAttribute('markerWidth','5');marker.setAttribute('markerHeight','5');marker.setAttribute('orient','auto-start-reverse');const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d','M 0 0 L 10 5 L 0 10 z');path.setAttribute('fill',e.stroke);marker.append(path);defs.append(marker);svg.append(defs);if(e.arrow==='end'||e.arrow==='both')line.setAttribute('marker-end',`url(#${id})`);if(e.arrow==='both')line.setAttribute('marker-start',`url(#${id})`);}if(interactive){line.classList.add('connector-hit');line.addEventListener('pointerdown',ev=>{ev.stopPropagation();selectElement(e.id,ev);});}svg.append(line);return svg;}
function tableVisual(e,editable=false){const table=document.createElement('div');table.className='table-grid';table.style.gridTemplateColumns=`repeat(${e.cols},1fr)`;for(let r=0;r<e.rows;r++)for(let c=0;c<e.cols;c++){const cell=document.createElement('div');cell.className=`table-cell${r===0?' table-header':''}`;cell.textContent=e.cells[r][c];cell.style.background=r===0?e.headerFill:e.fill;cell.style.borderColor=e.stroke;cell.style.borderWidth=`${e.strokeWidth}px`;applyTextStyle(cell,e);cell.dataset.row=String(r);cell.dataset.col=String(c);if(editable){cell.addEventListener('dblclick',ev=>{ev.stopPropagation();cell.contentEditable='true';cell.classList.add('editing');cell.focus();document.execCommand?.('selectAll',false,null);});cell.addEventListener('pointerdown',ev=>{if(cell.isContentEditable)ev.stopPropagation();});cell.addEventListener('input',()=>{e.cells[r][c]=cell.innerText;persist();renderList();updateElementLabels();});cell.addEventListener('blur',()=>{cell.contentEditable='false';cell.classList.remove('editing');persist();});}table.append(cell);}return table;}
function updateConnectorFrames(){el.slideCanvas.querySelectorAll('.element-connector').forEach(frame=>{const e=elementById(frame.dataset.elementId);if(!e)return;const old=frame.querySelector('.connector-svg'),fresh=connectorSVG(e,true);old?.replaceWith(fresh);});}
function snapValue(value,candidates,threshold){let best=value,dist=threshold;for(const c of candidates){const d=Math.abs(value-c);if(d<dist){best=c;dist=d;}}return best;}
function snapPosition(e,x,y,movers){const view=state.view;if(!view)return{x,y};let sx=x,sy=y;if(view.snapToGrid){const g=view.gridSize;sx=Math.round(sx/g)*g;sy=Math.round(sy/g)*g;}const xs=[],ys=[];if(view.showGuides||view.snapToObjects){xs.push(...view.guideX);ys.push(...view.guideY);}if(view.snapToObjects){for(const o of selectedSlide().elements){if(movers.some(m=>m.id===o.id)||o.type==='connector')continue;xs.push(o.x,o.x+o.width/2,o.x+o.width);ys.push(o.y,o.y+o.height/2,o.y+o.height);}}const threshold=0.9;if(view.snapToObjects||view.showGuides){const wx=[sx,sx+e.width/2,sx+e.width],wy=[sy,sy+e.height/2,sy+e.height];for(const px of wx){const snapped=snapValue(px,xs,threshold);if(snapped!==px){sx+=snapped-px;break;}}for(const py of wy){const snapped=snapValue(py,ys,threshold);if(snapped!==py){sy+=snapped-py;break;}}}return{x:sx,y:sy};}

function elementLabelName(e,slide){
  const clean=value=>String(value||'').replace(/\s+/g,' ').trim();
  const short=value=>{const t=clean(value);return t.length>22?`${t.slice(0,21)}…`:t;};
  if(e.type==='text')return `text${e.role?`:${e.role}`:''}${clean(e.text)?` “${short(e.text)}”`:''}`;
  if(e.type==='shape')return `shape:${e.shape}${clean(e.text)?` “${short(e.text)}”`:''}`;
  if(e.type==='image'){const source=clean(e.alt)||e.path.split('/').pop()||'image';return `image “${short(source)}”`;}
  if(e.type==='table')return `table ${e.rows}×${e.cols}`;
  if(e.type==='connector'){const position=id=>{const i=slide.elements.findIndex(x=>x.id===id);return i>=0?`#${i+1}`:'point';};return `connector ${position(e.from.elementId)}→${position(e.to.elementId)}`;}
  return e.type;
}
function makeElementLabel(e,index,slide){
  const label=document.createElement('div');label.className='element-id-label';label.dataset.elementId=e.id;
  label.textContent=`${e.type==='text'&&e.role?`@${e.role} · `:''}#${index+1} · ${elementLabelName(e,slide)} · ${e.id.slice(0,8)}`;
  let x=e.x+.6,y=e.y+.8;if(e.type==='connector'){const [a,b]=connectorPoints(e);x=(a.x+b.x)/2;y=(a.y+b.y)/2;}
  label.style.left=`${clamp(x,.5,92)}%`;label.style.top=`${clamp(y,.8,96)}%`;return label;
}
function updateElementLabels(){if(!state.view.showElementLabels)return;const slide=selectedSlide();if(!slide)return;for(const [index,e] of slide.elements.entries()){const current=el.slideCanvas.querySelector(`.element-id-label[data-element-id="${e.id}"]`);if(!current)continue;const fresh=makeElementLabel(e,index,slide);current.textContent=fresh.textContent;current.style.left=fresh.style.left;current.style.top=fresh.style.top;}}

function makeElementFrame(e,mode='editor',index=0){const interactive=mode==='editor';const frame=document.createElement('div');frame.className=`slide-element element-${e.type}${selectedElementIds.has(e.id)&&interactive?' selected':''}${e.locked?' locked':''}`;frame.dataset.elementId=e.id;frame.style.zIndex=String(10+index);if(e.type==='connector'){frame.style.inset='0';frame.style.opacity=String(e.opacity);frame.append(connectorSVG(e,interactive));return frame;}applyElementGeometry(frame,e);
  if(e.type==='image'){
    if(interactive&&cropElementId===e.id){const ghost=document.createElement('img');ghost.className='element-image crop-ghost';ghost.draggable=false;loadAssetInto(ghost,e.path);frame.append(ghost);}
    const img=document.createElement('img');img.className='element-image image-main';img.alt=e.alt||'';img.draggable=false;img.style.clipPath=cropClipPath(e);img.addEventListener('load',()=>nativePost('assetRendered',{path:e.path}),{once:true});loadAssetInto(img,e.path);frame.append(img);
  }else if(e.type==='text'){
    frame.style.background=e.fill;frame.style.borderColor=e.stroke;frame.style.borderWidth=`${e.strokeWidth}px`;frame.style.padding=`${e.padding||0}%`;frame.append(makeTextContent(e,interactive&&editingElementId===e.id));
  }else if(e.type==='shape'){
    frame.append(shapeVisual(e));if(e.text||interactive){const text=makeTextContent(e,interactive&&editingElementId===e.id);text.classList.add('shape-text-content');frame.append(text);}
  }else if(e.type==='table')frame.append(tableVisual(e,interactive));
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
  const move=next=>{const dx=(next.clientX-sx)/rect.width*100,dy=(next.clientY-sy)/rect.height*100;const anchor=orig.find(([obj])=>obj.id===e.id)||orig[0],rawX=clamp(anchor[1]+dx,-300,300),rawY=clamp(anchor[2]+dy,-300,300),snapped=snapPosition(anchor[0],rawX,rawY,movers),cx=snapped.x-rawX,cy=snapped.y-rawY;for(const [obj,x,y] of orig){obj.x=clamp(x+dx+cx,-300,300);obj.y=clamp(y+dy+cy,-300,300);const n=el.slideCanvas.querySelector(`[data-element-id="${obj.id}"]`);if(n)applyElementGeometry(n,obj);}updateConnectorFrames();updateElementLabels();syncObjectToolbar();};
  const end=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',end);window.removeEventListener('pointercancel',end);persist();renderList();renderEditor();};window.addEventListener('pointermove',move);window.addEventListener('pointerup',end,{once:true});window.addEventListener('pointercancel',end,{once:true});}
function startElementResize(event,e,frame,corner){event.stopPropagation();event.preventDefault();checkpoint();const rect=el.slideCanvas.getBoundingClientRect();const ox=e.x,oy=e.y,ow=e.width,oh=e.height;const east=corner.includes('e'),south=corner.includes('s');const anchorX=east?ox:ox+ow,anchorY=south?oy:oy+oh;const ratio=oh/ow;
  const move=next=>{const px=(next.clientX-rect.left)/rect.width*100,py=(next.clientY-rect.top)/rect.height*100;let w=Math.max(2,Math.abs(px-anchorX)),h=Math.max(2,Math.abs(py-anchorY));if(e.type==='image'||next.shiftKey){const fromH=h/ratio;if(fromH>w)w=fromH;h=w*ratio;}e.width=clamp(w,2,400);e.height=clamp(h,2,400);e.x=east?anchorX:anchorX-e.width;e.y=south?anchorY:anchorY-e.height;applyElementGeometry(frame,e);if(e.type==='image')updateCropGeometry(frame,e);updateConnectorFrames();updateElementLabels();syncObjectToolbar();};
  const end=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',end);persist();renderList();renderEditor();};window.addEventListener('pointermove',move);window.addEventListener('pointerup',end,{once:true});}
function startElementRotation(event,e,frame){event.stopPropagation();event.preventDefault();checkpoint();const rect=el.slideCanvas.getBoundingClientRect();const cx=rect.left+(e.x+e.width/2)/100*rect.width,cy=rect.top+(e.y+e.height/2)/100*rect.height;const initial=Math.atan2(event.clientY-cy,event.clientX-cx)*180/Math.PI,origin=e.rotation;
  const move=next=>{const angle=Math.atan2(next.clientY-cy,next.clientX-cx)*180/Math.PI;e.rotation=(origin+angle-initial+360)%360;applyElementGeometry(frame,e);syncObjectToolbar();};const end=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',end);persist();renderList();renderEditor();};window.addEventListener('pointermove',move);window.addEventListener('pointerup',end,{once:true});}
function startCropEdge(event,e,frame,side){event.stopPropagation();event.preventDefault();checkpoint();const rect=el.slideCanvas.getBoundingClientRect();const fullLeft=e.x/100*rect.width,fullTop=e.y/100*rect.height,fullWidth=e.width/100*rect.width,fullHeight=e.height/100*rect.height;const initial={...e.crop};
  const move=next=>{if(side==='left')e.crop.left=clamp((next.clientX-rect.left-fullLeft)/fullWidth*100,0,95-initial.right);else if(side==='right')e.crop.right=clamp(100-(next.clientX-rect.left-fullLeft)/fullWidth*100,0,95-initial.left);else if(side==='top')e.crop.top=clamp((next.clientY-rect.top-fullTop)/fullHeight*100,0,95-initial.bottom);else e.crop.bottom=clamp(100-(next.clientY-rect.top-fullTop)/fullHeight*100,0,95-initial.top);updateCropGeometry(frame,e);};const end=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',end);persist();renderList();syncObjectToolbar();};window.addEventListener('pointermove',move);window.addEventListener('pointerup',end,{once:true});}

function selectionBounds(items){const list=items.filter(e=>e.type!=='connector');if(!list.length)return null;const minX=Math.min(...list.map(e=>e.x)),minY=Math.min(...list.map(e=>e.y)),maxR=Math.max(...list.map(e=>e.x+e.width)),maxB=Math.max(...list.map(e=>e.y+e.height));return{x:minX,y:minY,width:maxR-minX,height:maxB-minY};}
function updateMultiOverlay(overlay,items){const b=selectionBounds(items);if(!b)return;overlay.style.left=`${b.x}%`;overlay.style.top=`${b.y}%`;overlay.style.width=`${b.width}%`;overlay.style.height=`${b.height}%`;}
function startMultiResize(event,corner,overlay){event.preventDefault();event.stopPropagation();const items=selectedMovable().filter(e=>e.type!=='connector');if(items.length<2)return;checkpoint();const b=selectionBounds(items),rect=el.slideCanvas.getBoundingClientRect(),east=corner.includes('e'),south=corner.includes('s'),anchorX=east?b.x:b.x+b.width,anchorY=south?b.y:b.y+b.height,orig=items.map(e=>({e,x:e.x,y:e.y,w:e.width,h:e.height,fontSize:e.fontSize}));
 const move=next=>{const px=(next.clientX-rect.left)/rect.width*100,py=(next.clientY-rect.top)/rect.height*100,rawW=Math.max(2,Math.abs(px-anchorX)),rawH=Math.max(2,Math.abs(py-anchorY)),factor=Math.max(rawW/b.width,rawH/b.height),nw=b.width*factor,nh=b.height*factor,newX=east?anchorX:anchorX-nw,newY=south?anchorY:anchorY-nh;for(const o of orig){const rx=(o.x-b.x)/b.width,ry=(o.y-b.y)/b.height;o.e.x=newX+rx*nw;o.e.y=newY+ry*nh;o.e.width=o.w*factor;o.e.height=o.h*factor;if(typeof o.fontSize==='number'&&['text','shape','table'].includes(o.e.type))o.e.fontSize=clamp(o.fontSize*factor,4,300);const node=el.slideCanvas.querySelector(`[data-element-id="${o.e.id}"]`);if(node)applyElementGeometry(node,o.e);}updateConnectorFrames();updateElementLabels();updateMultiOverlay(overlay,items);};
 const end=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',end);persist();render();};window.addEventListener('pointermove',move);window.addEventListener('pointerup',end,{once:true});}
function startMultiRotation(event,overlay){event.preventDefault();event.stopPropagation();const items=selectedMovable().filter(e=>e.type!=='connector');if(items.length<2)return;checkpoint();const b=selectionBounds(items),rect=el.slideCanvas.getBoundingClientRect(),cx=rect.left+(b.x+b.width/2)/100*rect.width,cy=rect.top+(b.y+b.height/2)/100*rect.height,initial=Math.atan2(event.clientY-cy,event.clientX-cx),cent={x:b.x+b.width/2,y:b.y+b.height/2},orig=items.map(e=>({e,c:elementCenter(e),rotation:e.rotation}));
 const move=next=>{const angle=Math.atan2(next.clientY-cy,next.clientX-cx),delta=angle-initial,deg=delta*180/Math.PI,cos=Math.cos(delta),sin=Math.sin(delta);for(const o of orig){const dx=o.c.x-cent.x,dy=o.c.y-cent.y,ncx=cent.x+dx*cos-dy*sin,ncy=cent.y+dx*sin+dy*cos;o.e.x=ncx-o.e.width/2;o.e.y=ncy-o.e.height/2;o.e.rotation=(o.rotation+deg+360)%360;const node=el.slideCanvas.querySelector(`[data-element-id="${o.e.id}"]`);if(node)applyElementGeometry(node,o.e);}updateConnectorFrames();updateElementLabels();updateMultiOverlay(overlay,items);};
 const end=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',end);persist();render();};window.addEventListener('pointermove',move);window.addEventListener('pointerup',end,{once:true});}
function multiSelectionOverlay(){const items=selectedElements().filter(e=>e.type!=='connector');if(items.length<2)return null;const box=document.createElement('div');box.className='multi-selection-box';updateMultiOverlay(box,items);for(const corner of ['nw','ne','se','sw']){const h=document.createElement('div');h.className=`resize-handle resize-${corner}`;h.addEventListener('pointerdown',ev=>startMultiResize(ev,corner,box));box.append(h);}const rot=document.createElement('div');rot.className='rotation-handle';rot.addEventListener('pointerdown',ev=>startMultiRotation(ev,box));box.append(rot);return box;}
function startMarqueeSelection(event,content){if(event.button!==0)return;event.preventDefault();const rect=content.getBoundingClientRect(),sx=(event.clientX-rect.left)/rect.width*100,sy=(event.clientY-rect.top)/rect.height*100,base=(event.shiftKey||event.metaKey)?new Set(selectedElementIds):new Set();const box=document.createElement('div');box.className='marquee-box';content.append(box);
 const move=next=>{const x=(next.clientX-rect.left)/rect.width*100,y=(next.clientY-rect.top)/rect.height*100,l=Math.min(sx,x),t=Math.min(sy,y),r=Math.max(sx,x),b=Math.max(sy,y);box.style.left=`${l}%`;box.style.top=`${t}%`;box.style.width=`${r-l}%`;box.style.height=`${b-t}%`;const ids=new Set(base);for(const e of selectedSlide().elements){if(e.type==='connector')continue;if(e.x<r&&e.x+e.width>l&&e.y<b&&e.y+e.height>t){for(const id of groupMemberIds(e.id))ids.add(id);}}selectedElementIds=ids;primaryElementId=[...ids].at(-1)||null;syncSelectionClasses();syncObjectToolbar();};
 const end=()=>{box.remove();window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',end);renderEditor();};window.addEventListener('pointermove',move);window.addEventListener('pointerup',end,{once:true});}

function render(){el.deckTitle.value=state.title;renderList();renderEditor();renderStatus();syncHistoryButtons();}
function renderList(){el.slideList.replaceChildren();state.slides.forEach((slide,index)=>{const row=document.createElement('div');row.className='slide-thumb-row';const number=document.createElement('div');number.className='slide-number';number.textContent=String(index+1);const thumb=document.createElement('button');thumb.className=`slide-thumb${slide.id===state.selectedId?' selected':''}`;thumb.type='button';thumb.draggable=true;thumb.dataset.id=slide.id;const inner=document.createElement('div');inner.className=`thumb-inner ${slide.layout}`;inner.style.background=slide.background;slide.elements.forEach((e,i)=>inner.append(makeElementFrame(e,'thumb',i)));thumb.append(inner);row.append(number,thumb);el.slideList.append(row);thumb.addEventListener('click',()=>selectSlide(slide.id));thumb.addEventListener('dragstart',ev=>{ev.dataTransfer.effectAllowed='move';ev.dataTransfer.setData('text/plain',slide.id);});thumb.addEventListener('dragover',ev=>{ev.preventDefault();thumb.classList.add('drag-over');});thumb.addEventListener('dragleave',()=>thumb.classList.remove('drag-over'));thumb.addEventListener('drop',ev=>{ev.preventDefault();thumb.classList.remove('drag-over');moveSlide(ev.dataTransfer.getData('text/plain'),slide.id);});});}
function renderEditor(){const slide=selectedSlide();if(!slide)return;el.layoutSelect.value=slide.layout;el.slideBackground.value=colorInputValue(slide.background,slide.layout==='section'?'#202124':'#ffffff');el.slideTransition.value=slide.transition.type;el.slideNotes.value=slide.notes;el.notesPanel.hidden=!notesVisible;el.toggleNotes.classList.toggle('active',notesVisible);el.themePreset.value=state.theme.name;el.toggleSnap.classList.toggle('active',state.view.snapToObjects);el.toggleGrid.classList.toggle('active',state.view.showGrid||state.view.snapToGrid);el.toggleGuides.classList.toggle('active',state.view.showGuides);el.toggleElementLabels.classList.toggle('active',state.view.showElementLabels);el.slideCanvas.replaceChildren();const content=document.createElement('div');content.className=`slide-content ${slide.layout}`;content.style.background=slide.background;if(state.view.showGrid){const g=state.view.gridSize;content.style.backgroundImage=`linear-gradient(to right,rgba(80,90,110,.12) 1px,transparent 1px),linear-gradient(to bottom,rgba(80,90,110,.12) 1px,transparent 1px)`;content.style.backgroundSize=`${g}% ${g}%`;}if(state.view.showGuides){for(const x of state.view.guideX){const guide=document.createElement('div');guide.className='guide guide-v';guide.style.left=`${x}%`;content.append(guide);}for(const y of state.view.guideY){const guide=document.createElement('div');guide.className='guide guide-h';guide.style.top=`${y}%`;content.append(guide);}}content.addEventListener('pointerdown',ev=>{if(ev.target===content||ev.target.classList.contains('placeholder-layer'))startMarqueeSelection(ev,content);});slide.elements.forEach((e,i)=>content.append(makeElementFrame(e,'editor',i)));if(state.view.showElementLabels)slide.elements.forEach((e,i)=>content.append(makeElementLabel(e,i,slide)));const multi=multiSelectionOverlay();if(multi)content.append(multi);el.slideCanvas.append(content);syncObjectToolbar();if(editingElementId)requestAnimationFrame(()=>el.slideCanvas.querySelector(`[data-element-id="${editingElementId}"] .object-text-content`)?.focus());}
function renderStatus(){el.slidePosition.textContent=`${selectedIndex()+1} / ${state.slides.length}`;el.objectStatus.textContent=selectedElementIds.size?`${selectedElementIds.size} object${selectedElementIds.size>1?'s':''} selected`:`${selectedSlide()?.elements.length||0} objects`;}

function syncObjectToolbar(){const items=selectedElements(),primary=primaryElement();el.selectionCount.textContent=items.length?`${items.length} 个对象`:'未选择对象';const has=items.length>0,textual=items.filter(e=>e.type==='text'||e.type==='shape'||e.type==='table'||e.type==='table'),single=items.length===1;for(const node of el.objectToolbar.querySelectorAll('button,input,select'))node.disabled=!has;el.objectAlign.disabled=items.length<2;el.cropToggle.disabled=!(single&&primary?.type==='image');el.cropReset.disabled=!(single&&primary?.type==='image');el.groupObjects.disabled=items.filter(e=>e.type!=='connector').length<2;el.ungroupObjects.disabled=!items.some(e=>e.groupId);el.connectSelected.disabled=items.filter(e=>e.type!=='connector').length!==2;const tableSingle=single&&primary?.type==='table';el.tableRowAdd.disabled=!tableSingle;el.tableRowDelete.disabled=!tableSingle||primary.rows<=1;el.tableColAdd.disabled=!tableSingle;el.tableColDelete.disabled=!tableSingle||primary.cols<=1;el.textRole.disabled=!(single&&primary?.type==='text');el.fontFamily.disabled=!textual.length;el.fontSize.disabled=!textual.length;el.textBold.disabled=!textual.length;el.textItalic.disabled=!textual.length;el.textUnderline.disabled=!textual.length;el.textAlign.disabled=!textual.length;el.textColor.disabled=!textual.length;el.objectFill.disabled=!items.some(e=>['text','shape','table'].includes(e.type));el.noFill.disabled=el.objectFill.disabled;const strokeable=items.some(e=>e.type!=='image');el.objectStroke.disabled=!strokeable;el.noStroke.disabled=!items.some(e=>['text','shape','table'].includes(e.type));el.strokeWidth.disabled=!strokeable;el.rotation.disabled=items.every(e=>e.type==='connector');el.connectorArrow.disabled=!(single&&primary?.type==='connector');el.connectorDash.disabled=!(single&&primary?.type==='connector');if(!primary){renderStatus();return;}
  if(primary.type==='text')el.textRole.value=primary.role||'none';else el.textRole.value='none';if(primary.type==='text'||primary.type==='shape'||primary.type==='table'){el.fontFamily.value=[...el.fontFamily.options].some(o=>o.value===primary.fontFamily)?primary.fontFamily:'Inter';el.fontSize.value=String(primary.fontSize);el.textBold.classList.toggle('active',primary.fontWeight>=700);el.textItalic.classList.toggle('active',primary.italic);el.textUnderline.classList.toggle('active',primary.underline);el.textAlign.value=primary.align;el.textColor.value=colorInputValue(primary.color,'#202124');el.objectFill.value=colorInputValue(primary.fill,'#e8e8e4');el.noFill.classList.toggle('active',primary.fill==='transparent');el.objectStroke.value=colorInputValue(primary.stroke,'#4b4d50');el.noStroke.classList.toggle('active',primary.stroke==='transparent');el.strokeWidth.value=String(primary.strokeWidth);}el.rotation.value=String(Math.round(primary.rotation*10)/10);el.opacity.value=String(Math.round(primary.opacity*100));if(primary.type==='connector'){el.connectorArrow.value=primary.arrow;el.connectorDash.classList.toggle('active',primary.dash);}else el.connectorDash.classList.remove('active');el.cropToggle.classList.toggle('active',cropElementId===primary.id);el.lockObject.classList.toggle('active',primary.locked);el.lockObject.textContent=primary.locked?'解锁':'锁定';renderStatus();}

function selectSlide(id){if(!state.slides.some(s=>s.id===id))return;state.selectedId=id;selectedElementIds.clear();primaryElementId=null;editingElementId=null;cropElementId=null;continuousSnapshot=null;persist();render();}
function selectSlideRef(ref){if(ref==null||ref==='')return;const position=Number(ref);if(Number.isInteger(position)&&position>=1&&position<=state.slides.length)state.selectedId=state.slides[position-1].id;else if(state.slides.some(s=>s.id===ref))state.selectedId=ref;}
function addSlide(){checkpoint();const index=selectedIndex(),slide=emptySlide('title-body',state.theme);state.slides.splice(index+1,0,slide);state.selectedId=slide.id;const title=roleElement(slide,'title');selectedElementIds=new Set(title?[title.id]:[]);primaryElementId=title?.id||null;editingElementId=title?.id||null;persist();render();}
function remapElements(elements){const copies=deepClone(elements),idmap=new Map(copies.map(e=>[e.id,uid()])),groupmap=new Map();for(const e of copies){const old=e.id;e.id=idmap.get(old);if(e.groupId){if(!groupmap.has(e.groupId))groupmap.set(e.groupId,uid());e.groupId=groupmap.get(e.groupId);}if(e.type==='connector')for(const ep of [e.from,e.to])if(idmap.has(ep.elementId))ep.elementId=idmap.get(ep.elementId);}return copies;}
function duplicateSlide(){checkpoint();const index=selectedIndex(),copy=deepClone(selectedSlide());copy.id=uid();copy.elements=remapElements(selectedSlide().elements);state.slides.splice(index+1,0,copy);state.selectedId=copy.id;selectedElementIds.clear();persist();render();}
function deleteSlide(){checkpoint();const index=selectedIndex();if(state.slides.length===1){const id=state.slides[0].id;state.slides[0]=emptySlide('title-body',state.theme);state.slides[0].id=id;}else{state.slides.splice(index,1);state.selectedId=state.slides[Math.min(index,state.slides.length-1)].id;}selectedElementIds.clear();persist();render();}
function moveSlide(sourceId,targetId){if(!sourceId||sourceId===targetId)return;const si=state.slides.findIndex(s=>s.id===sourceId),ti=state.slides.findIndex(s=>s.id===targetId);if(si<0||ti<0)return;checkpoint();const [slide]=state.slides.splice(si,1);state.slides.splice(state.slides.findIndex(s=>s.id===targetId),0,slide);persist();renderList();}

function setTextRole(role){const e=primaryElement();if(selectedElementIds.size!==1||e?.type!=='text')return;checkpoint();const next=VALID_TEXT_ROLES.has(role)?role:null;if(next)for(const other of selectedSlide().elements)if(other!==e&&other.type==='text'&&other.role===next)other.role=null;e.role=next;persist();render();}
function insertText(){checkpoint();const e=normalizeElement({type:'text',text:'文本框',x:15,y:15,width:32,height:14,fontSize:28});selectedSlide().elements.push(e);setSelection([e.id],e.id,false);editingElementId=e.id;persist();render();}
function insertShape(){checkpoint();const shape=el.shapeKind.value,t=state.theme;const e=normalizeElement({type:'shape',shape,x:30,y:30,width:25,height:18,fill:'#e8e8e4',stroke:t.accent,strokeWidth:1.5,text:'',fontFamily:t.fontFamily,color:t.text});selectedSlide().elements.push(e);setSelection([e.id],e.id,false);persist();render();}
function insertTable(){checkpoint();const t=state.theme,e=normalizeElement({type:'table',rows:3,cols:3,x:20,y:25,width:60,height:30,fontFamily:t.fontFamily,color:t.text,headerFill:'#e8e8e4',stroke:t.accent});selectedSlide().elements.push(e);setSelection([e.id],e.id,false);persist();render();}
function connectSelected(){const items=selectedElements().filter(e=>e.type!=='connector');if(items.length!==2)return;checkpoint();const e=normalizeElement({type:'connector',from:{elementId:items[0].id,anchor:'auto'},to:{elementId:items[1].id,anchor:'auto'},arrow:'end',stroke:state.theme.accent,strokeWidth:2});selectedSlide().elements.push(e);setSelection([e.id],e.id,false);persist();render();}
function groupSelected(){const items=selectedElements().filter(e=>e.type!=='connector');if(items.length<2)return;checkpoint();const gid=uid();items.forEach(e=>e.groupId=gid);setSelection(items.map(e=>e.id),items.at(-1).id,false);persist();render();}
function ungroupSelected(){const groups=new Set(selectedElements().map(e=>e.groupId).filter(Boolean));if(!groups.size)return;checkpoint();for(const e of selectedSlide().elements)if(groups.has(e.groupId))e.groupId=null;persist();render();}
function tableStructure(action){const e=primaryElement();if(selectedElementIds.size!==1||e?.type!=='table')return;checkpoint();if(action==='row-add'){e.cells.push(Array.from({length:e.cols},()=>''));e.rows++;}else if(action==='row-delete'&&e.rows>1){e.cells.pop();e.rows--;}else if(action==='col-add'){e.cells.forEach(r=>r.push(''));e.cols++;}else if(action==='col-delete'&&e.cols>1){e.cells.forEach(r=>r.pop());e.cols--;}e.height=Math.max(e.height,e.rows*6);persist();render();}
function applyTheme(name,applyAll=true){if(!THEME_PRESETS[name])return;checkpoint();state.theme={...THEME_PRESETS[name]};if(applyAll){for(const slide of state.slides){slide.background=state.theme.background;for(const e of slide.elements){if(['text','shape','table'].includes(e.type)){e.fontFamily=e.type==='text'&&e.role==='title'?state.theme.titleFontFamily:state.theme.fontFamily;e.color=state.theme.text;}}}}persist();render();}
function chooseImage(){if(!isNative){alert('图片资产目前需要在 Morrow Presenter Mac App 中添加。');return;}nativePost('chooseImage',{deck:state});}
function deleteSelected(){const ids=new Set(selectedElementIds);if(!ids.size)return;checkpoint();selectedSlide().elements=selectedSlide().elements.filter(e=>!ids.has(e.id)&&!(e.type==='connector'&&(ids.has(e.from.elementId)||ids.has(e.to.elementId))));selectedElementIds.clear();primaryElementId=null;editingElementId=null;cropElementId=null;persist();render();}
function duplicateSelected(){const originals=selectedElements();if(!originals.length)return;checkpoint();const copies=[];for(const e of originals){const c=deepClone(e);c.id=uid();if(c.type==='text')c.role=null;c.x+=2;c.y+=2;copies.push(c);selectedSlide().elements.push(c);}setSelection(copies.map(e=>e.id),copies.at(-1).id,false);persist();render();}
function copySelected(){objectClipboard=selectedElements().map(deepClone);}
function cutSelected(){if(!selectedElementIds.size)return;copySelected();deleteSelected();}
function pasteElements(){if(!objectClipboard.length)return;checkpoint();const copies=objectClipboard.map(e=>{const c=deepClone(e);c.id=uid();if(c.type==='text')c.role=null;c.x+=2;c.y+=2;return c;});selectedSlide().elements.push(...copies);objectClipboard=copies.map(deepClone);setSelection(copies.map(e=>e.id),copies.at(-1).id,false);persist();render();}
function applyToSelected(fn,predicate=()=>true){const items=selectedElements().filter(predicate);if(!items.length)return;checkpoint();items.forEach(fn);persist();render();}
function reorderPrimary(mode){const p=primaryElement();if(!p)return;checkpoint();const arr=selectedSlide().elements,idx=arr.findIndex(e=>e.id===p.id);arr.splice(idx,1);let target=idx;if(mode==='front')target=arr.length;else if(mode==='back')target=0;else if(mode==='forward')target=Math.min(arr.length,idx+1);else if(mode==='backward')target=Math.max(0,idx-1);arr.splice(target,0,p);persist();render();}
function alignSelected(mode){const items=selectedElements();if(items.length<2)return;if(mode.startsWith('distribute')&&items.length<3)return;checkpoint();const minX=Math.min(...items.map(e=>e.x)),maxR=Math.max(...items.map(e=>e.x+e.width)),minY=Math.min(...items.map(e=>e.y)),maxB=Math.max(...items.map(e=>e.y+e.height));if(mode==='left')items.forEach(e=>e.x=minX);else if(mode==='center'){const t=(minX+maxR)/2;items.forEach(e=>e.x=t-e.width/2);}else if(mode==='right')items.forEach(e=>e.x=maxR-e.width);else if(mode==='top')items.forEach(e=>e.y=minY);else if(mode==='middle'){const t=(minY+maxB)/2;items.forEach(e=>e.y=t-e.height/2);}else if(mode==='bottom')items.forEach(e=>e.y=maxB-e.height);else if(mode==='distribute-h'){const o=[...items].sort((a,b)=>a.x-b.x),gap=(maxR-minX-o.reduce((s,e)=>s+e.width,0))/(o.length-1);let c=minX;o.forEach(e=>{e.x=c;c+=e.width+gap;});}else if(mode==='distribute-v'){const o=[...items].sort((a,b)=>a.y-b.y),gap=(maxB-minY-o.reduce((s,e)=>s+e.height,0))/(o.length-1);let c=minY;o.forEach(e=>{e.y=c;c+=e.height+gap;});}persist();render();}
function toggleCrop(){const p=primaryElement();if(selectedElementIds.size!==1||p?.type!=='image')return;cropElementId=cropElementId===p.id?null:p.id;editingElementId=null;renderEditor();}
function resetCrop(){const p=primaryElement();if(p?.type!=='image')return;checkpoint();p.crop={left:0,top:0,right:0,bottom:0};persist();render();}
function nudgeSelected(dx,dy){const items=selectedMovable();if(!items.length)return;checkpoint();items.forEach(e=>{e.x+=dx;e.y+=dy;});persist();render();}

function downloadDeck(){const blob=new Blob([`${JSON.stringify(state,null,2)}\n`],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a'),filename=(state.title||'deck').replace(/[\\/:*?"<>|]+/g,'-').trim()||'deck';a.href=url;a.download=`${filename}.morrowdeck`;a.click();URL.revokeObjectURL(url);}
function saveDeck(force=false){clearTimeout(autosaveTimer);if(isNative)nativePost(force?'saveAs':'save',{deck:state});else downloadDeck();}
function exportRich(format){if(!isNative){alert('PDF/PPTX 导出需要 Morrow Presenter Mac App。');return;}clearTimeout(autosaveTimer);setSaveStatus(`正在导出 ${format.toUpperCase()}…`);nativePost(format==='pdf'?'exportPdf':'exportPptx',{deck:state});}
function newDeck(){if(!confirm('新建演示文稿会关闭当前文稿。继续吗？'))return;checkpoint();state=starterDeck();currentPath=null;selectedElementIds.clear();if(isNative)nativePost('new');else localStorage.removeItem(STORAGE_KEY);persist();render();}
function openDeck(){if(isNative)nativePost('open');else el.importFile.click();}
async function importDeck(file){if(!file)return;try{checkpoint();state=normalizeDeck(JSON.parse(await file.text()));selectedElementIds.clear();persist();render();}catch(error){alert(`无法打开：${error.message}`);}finally{el.importFile.value='';}}

function buildPresentationSlide(slide,animate=true){el.presentationSlide.replaceChildren();const content=document.createElement('div');content.className=`present-content ${slide.layout}`;content.style.background=slide.background;slide.elements.forEach((e,i)=>content.append(makeElementFrame(e,'present',i)));if(animate&&slide.transition.type==='fade'){content.classList.add('transition-fade');content.style.animationDuration=`${slide.transition.duration}s`;}el.presentationSlide.append(content);el.presentationCounter.textContent=`${presentationIndex+1} / ${state.slides.length}`;el.presentationProgressBar.style.width=`${((presentationIndex+1)/state.slides.length)*100}%`;}
async function startPresentation(){presentationIndex=selectedIndex();buildPresentationSlide(state.slides[presentationIndex]);el.presentation.hidden=false;document.body.style.overflow='hidden';if(isNative)nativePost('presentStart');else try{await el.presentation.requestFullscreen?.();}catch{}}
async function exitPresentation(){if(el.presentation.hidden)return;el.presentation.hidden=true;document.body.style.overflow='hidden';if(isNative)nativePost('presentEnd');else if(document.fullscreenElement)try{await document.exitFullscreen();}catch{}}
function nextSlide(delta){presentationIndex=clamp(presentationIndex+delta,0,state.slides.length-1);buildPresentationSlide(state.slides[presentationIndex]);}

window.addEventListener('error',event=>nativePost('runtimeError',{message:event.message||'JavaScript error'}));
window.addEventListener('unhandledrejection',event=>nativePost('runtimeError',{message:String(event.reason||'Unhandled promise rejection')}));
window.presenterDiagnosticSelfTest=()=>{
  try{
    state=starterDeck();state.slides=[emptySlide('blank',state.theme)];state.selectedId=state.slides[0].id;state.slides[0].background='#fafafa';selectedElementIds.clear();primaryElementId=null;undoStack.length=0;redoStack.length=0;
    insertText();const text=primaryElement();text.text='Selftest text';editingElementId=null;
    insertShape();const shape=primaryElement();shape.text='Selftest shape';
    setSelection([text.id,shape.id],shape.id,false);groupSelected();if(!text.groupId||text.groupId!==shape.groupId)throw new Error('group failed');connectSelected();const connector=primaryElement();if(connector.type!=='connector')throw new Error('connector failed');setSelection([text.id,shape.id],shape.id,false);alignSelected('top');
    if(Math.abs(text.y-shape.y)>.001)throw new Error('align failed');
    copySelected();pasteElements();const pasted=selectedSlide().elements.length;
    if(pasted!==5)throw new Error(`paste count ${pasted}`);
    undo();if(selectedSlide().elements.length!==3)throw new Error('undo failed');
    redo();if(selectedSlide().elements.length!==5)throw new Error('redo failed');
    setSelection(selectedSlide().elements.map(e=>e.id),selectedSlide().elements.at(-1).id,false);
    const target=true;applyToSelected(e=>{if(e.type!=='image')e.italic=target;},e=>e.type!=='image'&&e.type!=='connector');
    if(selectedSlide().elements.some(e=>e.type!=='image'&&e.type!=='connector'&&!e.italic))throw new Error('format failed');
    insertTable();const table=primaryElement();if(table.type!=='table'||table.rows!==3||table.cols!==3)throw new Error('table failed');
    applyTheme('dark',true);if(state.theme.name!=='dark'||selectedSlide().background!==state.theme.background)throw new Error('theme failed');
    state.view.snapToGrid=true;state.view.showGrid=true;state.view.showGuides=true;state.view.showElementLabels=true;state.view.guideX=[25,75];state.view.guideY=[40];renderEditor();
    if(!state.view.snapToGrid||state.view.guideX.length!==2||state.view.guideY[0]!==40)throw new Error('view settings failed');
    const labels=[...el.slideCanvas.querySelectorAll('.element-id-label')];if(labels.length!==selectedSlide().elements.length||!labels[0]?.textContent.includes('#1 ·')||!labels[0]?.textContent.includes(selectedSlide().elements[0].id.slice(0,8)))throw new Error('element labels failed');
    const roleSlide=emptySlide('title-body',state.theme),titleRole=roleElement(roleSlide,'title'),bodyRole=roleElement(roleSlide,'body');if(!titleRole||!bodyRole||titleRole.type!=='text'||bodyRole.type!=='text')throw new Error('role text creation failed');
    state.slides=[roleSlide];state.selectedId=roleSlide.id;state.view.showElementLabels=true;setSelection([titleRole.id],titleRole.id,false);renderEditor();let titleFrame=el.slideCanvas.querySelector(`[data-element-id="${titleRole.id}"]`);if(!titleFrame?.querySelector('.resize-handle')||!el.slideCanvas.querySelector('.element-id-label')?.textContent.includes('@title'))throw new Error('role text interaction failed');
    const canvasRect=el.slideCanvas.getBoundingClientRect(),moveX=canvasRect.left+(titleRole.x+titleRole.width/2)/100*canvasRect.width,moveY=canvasRect.top+(titleRole.y+titleRole.height/2)/100*canvasRect.height,oldX=titleRole.x,oldY=titleRole.y;titleFrame.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,clientX:moveX,clientY:moveY}));window.dispatchEvent(new PointerEvent('pointermove',{clientX:moveX+canvasRect.width*.04,clientY:moveY+canvasRect.height*.03}));window.dispatchEvent(new PointerEvent('pointerup',{clientX:moveX+canvasRect.width*.04,clientY:moveY+canvasRect.height*.03}));if(titleRole.x===oldX&&titleRole.y===oldY)throw new Error('title move failed');
    setSelection([titleRole.id],titleRole.id,false);renderEditor();titleFrame=el.slideCanvas.querySelector(`[data-element-id="${titleRole.id}"]`);const handle=titleFrame?.querySelector('.resize-se'),oldW=titleRole.width,oldH=titleRole.height;if(!handle)throw new Error('title resize handle missing');const hRect=handle.getBoundingClientRect();handle.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,clientX:hRect.left+hRect.width/2,clientY:hRect.top+hRect.height/2}));window.dispatchEvent(new PointerEvent('pointermove',{clientX:hRect.left+hRect.width/2+canvasRect.width*.05,clientY:hRect.top+hRect.height/2+canvasRect.height*.04}));window.dispatchEvent(new PointerEvent('pointerup',{clientX:hRect.left+hRect.width/2+canvasRect.width*.05,clientY:hRect.top+hRect.height/2+canvasRect.height*.04}));if(titleRole.width===oldW&&titleRole.height===oldH)throw new Error('title resize failed');
    nativePost('diagnostic',{message:`gui-selftest PASS roleText=2 titleMove=1 titleResize=1 labels=${state.view.showElementLabels}`});
  }catch(error){nativePost('runtimeError',{message:`gui-selftest FAIL ${error.message}`});}
};
window.presenterNativeContext=({path})=>{currentPath=path||null;setSaveStatus(currentPath?`${pathBasename(currentPath)} · 已保存`:'未保存 · ⌘S 保存',true);};
window.presenterNativeSaved=({path})=>{currentPath=path;setSaveStatus(`${pathBasename(path)} · 已保存`,true);};
window.presenterNativeExported=({path,format})=>setSaveStatus(`${format.toUpperCase()} 已导出 · ${pathBasename(path)}`,true);
window.presenterNativeLoad=({json,path,present,slide})=>{try{state=normalizeDeck(JSON.parse(json));currentPath=path;selectSlideRef(slide);undoStack.length=redoStack.length=0;selectedElementIds.clear();render();setSaveStatus(`${pathBasename(path)} · 已保存`,true);if(present)setTimeout(startPresentation,80);}catch(error){alert(`无法打开文稿：${error.message}`);}};
window.presenterNativeExternalLoad=({json,path})=>{try{const oldSlide=state.selectedId,oldSelection=[...selectedElementIds];state=normalizeDeck(JSON.parse(json));if(state.slides.some(s=>s.id===oldSlide))state.selectedId=oldSlide;selectedElementIds=new Set(oldSelection.filter(id=>elementById(id)));currentPath=path;render();setSaveStatus(`${pathBasename(path)} · 已同步 shell 修改`,true);}catch(error){console.warn(error);}};
window.presenterNativeImageChosen=({path,name,width,height})=>{checkpoint();const iw=Math.max(1,numberOr(width,16)),ih=Math.max(1,numberOr(height,9)),w=DEFAULT_IMAGE_WIDTH,h=imageHeightForWidth(w,iw,ih);const e=normalizeElement({type:'image',path,alt:name||'',x:55,y:(100-h)/2,width:w,intrinsicWidth:iw,intrinsicHeight:ih,crop:{left:0,top:0,right:0,bottom:0}});selectedSlide().elements.push(e);setSelection([e.id],e.id,false);persist();render();};
window.presenterNativeAsset=({requestId,path,dataURL,error})=>{const expected=assetRequests.get(requestId)||path;assetRequests.delete(requestId);const waiters=assetWaiters.get(expected)||[];assetWaiters.delete(expected);if(dataURL)assetCache.set(expected,dataURL);waiters.forEach(img=>{img.classList.remove('asset-loading');if(dataURL){img.src=dataURL;img.classList.remove('asset-error');}else{img.classList.add('asset-error');img.title=error||'Unable to load image';}});};
window.presenterNativeFullscreenEnded=()=>{if(!el.presentation.hidden){el.presentation.hidden=true;document.body.style.overflow='hidden';}};
window.presenterMenuAction=action=>{if(action==='new')newDeck();else if(action==='save')saveDeck(false);else if(action==='saveAs')saveDeck(true);else if(action==='present')startPresentation();else if(action==='exportPdf')exportRich('pdf');else if(action==='exportPptx')exportRich('pptx');else if(action==='undo')undo();else if(action==='redo')redo();else if(action==='copy')copySelected();else if(action==='cut')cutSelected();else if(action==='paste')pasteElements();else if(action==='selectAll')setSelection(selectedSlide().elements.map(e=>e.id),selectedSlide().elements.at(-1)?.id);};

el.deckTitle.addEventListener('focus',beginContinuousEdit);el.deckTitle.addEventListener('input',()=>{markContinuousEdit();state.title=el.deckTitle.value;persist();});
el.layoutSelect.addEventListener('change',()=>{checkpoint();const slide=selectedSlide(),layout=el.layoutSelect.value;applyLayoutTemplate(slide,layout,state.theme);persist();render();});
el.slideBackground.addEventListener('input',()=>{checkpoint();selectedSlide().background=el.slideBackground.value;persist();renderList();renderEditor();});
el.slideTransition.addEventListener('change',()=>{checkpoint();selectedSlide().transition.type=el.slideTransition.value;persist();});
el.toggleNotes.addEventListener('click',()=>{notesVisible=!notesVisible;renderEditor();if(notesVisible)requestAnimationFrame(()=>el.slideNotes.focus());});
el.slideNotes.addEventListener('focus',beginContinuousEdit);el.slideNotes.addEventListener('input',()=>{markContinuousEdit();selectedSlide().notes=el.slideNotes.value;persist();});
el.tableRowAdd.addEventListener('click',()=>tableStructure('row-add'));el.tableRowDelete.addEventListener('click',()=>tableStructure('row-delete'));el.tableColAdd.addEventListener('click',()=>tableStructure('col-add'));el.tableColDelete.addEventListener('click',()=>tableStructure('col-delete'));el.insertText.addEventListener('click',insertText);el.insertShape.addEventListener('click',insertShape);el.chooseImage.addEventListener('click',chooseImage);el.insertTable.addEventListener('click',insertTable);el.connectSelected.addEventListener('click',connectSelected);el.groupObjects.addEventListener('click',groupSelected);el.ungroupObjects.addEventListener('click',ungroupSelected);el.themePreset.addEventListener('change',()=>applyTheme(el.themePreset.value,true));el.toggleSnap.addEventListener('click',()=>{checkpoint();state.view.snapToObjects=!state.view.snapToObjects;persist();render();});el.toggleGrid.addEventListener('click',()=>{checkpoint();const on=!(state.view.showGrid||state.view.snapToGrid);state.view.showGrid=on;state.view.snapToGrid=on;persist();render();});el.toggleGuides.addEventListener('click',()=>{checkpoint();state.view.showGuides=!state.view.showGuides;persist();render();});el.toggleElementLabels.addEventListener('click',()=>{checkpoint();state.view.showElementLabels=!state.view.showElementLabels;persist();renderEditor();});
el.textRole.addEventListener('change',()=>setTextRole(el.textRole.value));el.fontFamily.addEventListener('change',()=>applyToSelected(e=>e.fontFamily=el.fontFamily.value,e=>e.type!=='image'&&e.type!=='connector'));el.fontSize.addEventListener('change',()=>applyToSelected(e=>e.fontSize=clamp(Number(el.fontSize.value)||28,4,300),e=>e.type!=='image'&&e.type!=='connector'));el.textBold.addEventListener('click',()=>{const p=primaryElement(),target=p?.fontWeight>=700?400:700;applyToSelected(e=>e.fontWeight=target,e=>e.type!=='image'&&e.type!=='connector');});el.textItalic.addEventListener('click',()=>{const p=primaryElement(),target=!p?.italic;applyToSelected(e=>e.italic=target,e=>e.type!=='image'&&e.type!=='connector');});el.textUnderline.addEventListener('click',()=>{const p=primaryElement(),target=!p?.underline;applyToSelected(e=>e.underline=target,e=>e.type!=='image'&&e.type!=='connector');});el.textAlign.addEventListener('change',()=>applyToSelected(e=>e.align=el.textAlign.value,e=>e.type!=='image'&&e.type!=='connector'));el.textColor.addEventListener('input',()=>applyToSelected(e=>e.color=el.textColor.value,e=>e.type!=='image'&&e.type!=='connector'));
el.objectFill.addEventListener('input',()=>applyToSelected(e=>e.fill=el.objectFill.value,e=>e.type!=='image'&&e.type!=='connector'));el.noFill.addEventListener('click',()=>applyToSelected(e=>e.fill='transparent',e=>e.type!=='image'&&e.type!=='connector'));el.objectStroke.addEventListener('input',()=>applyToSelected(e=>e.stroke=el.objectStroke.value,e=>e.type!=='image'));el.noStroke.addEventListener('click',()=>applyToSelected(e=>e.stroke='transparent',e=>e.type!=='image'&&e.type!=='connector'));el.strokeWidth.addEventListener('change',()=>applyToSelected(e=>e.strokeWidth=clamp(Number(el.strokeWidth.value)||0,0,20),e=>e.type!=='image'));el.rotation.addEventListener('change',()=>applyToSelected(e=>e.rotation=((Number(el.rotation.value)||0)%360+360)%360,e=>e.type!=='connector'));el.opacity.addEventListener('change',()=>applyToSelected(e=>e.opacity=clamp((Number(el.opacity.value)||0)/100,0,1)));el.cropToggle.addEventListener('click',toggleCrop);el.cropReset.addEventListener('click',resetCrop);el.connectorArrow.addEventListener('change',()=>applyToSelected(e=>e.arrow=el.connectorArrow.value,e=>e.type==='connector'));el.connectorDash.addEventListener('click',()=>{const p=primaryElement();if(p?.type==='connector'){const target=!p.dash;applyToSelected(e=>e.dash=target,e=>e.type==='connector');}});el.objectOrder.addEventListener('change',()=>{if(el.objectOrder.value)reorderPrimary(el.objectOrder.value);el.objectOrder.value='';});el.objectAlign.addEventListener('change',()=>{if(el.objectAlign.value)alignSelected(el.objectAlign.value);el.objectAlign.value='';});el.lockObject.addEventListener('click',()=>{const p=primaryElement();if(p){const target=!p.locked;applyToSelected(e=>e.locked=target);}});el.duplicateObject.addEventListener('click',duplicateSelected);el.deleteObject.addEventListener('click',deleteSelected);
el.exportPdf.addEventListener('click',()=>exportRich('pdf'));el.exportPptx.addEventListener('click',()=>exportRich('pptx'));el.addSlide.addEventListener('click',addSlide);el.duplicateSlide.addEventListener('click',duplicateSlide);el.deleteSlide.addEventListener('click',deleteSlide);el.newDeck.addEventListener('click',newDeck);el.openDeck.addEventListener('click',openDeck);el.saveDeck.addEventListener('click',()=>saveDeck(false));el.saveAs.addEventListener('click',()=>saveDeck(true));el.importFile.addEventListener('change',()=>importDeck(el.importFile.files?.[0]));el.present.addEventListener('click',startPresentation);el.exitPresentation.addEventListener('click',exitPresentation);el.undo.addEventListener('click',undo);el.redo.addEventListener('click',redo);
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
  else if(event.metaKey&&event.key.toLowerCase()==='g'){event.preventDefault();event.shiftKey?ungroupSelected():groupSelected();}
  else if(event.metaKey&&event.shiftKey&&event.key.toLowerCase()==='n'){event.preventDefault();addSlide();}
  else if((event.key==='Delete'||event.key==='Backspace')&&selectedElementIds.size){event.preventDefault();deleteSelected();}
  else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)&&selectedElementIds.size){event.preventDefault();const step=event.shiftKey?2:0.25;nudgeSelected(event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0,event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0);}
  else if(event.metaKey&&event.key.toLowerCase()==='b'){event.preventDefault();const p=primaryElement(),target=p?.fontWeight>=700?400:700;applyToSelected(e=>e.fontWeight=target,e=>e.type!=='image'&&e.type!=='connector');}
  else if(event.metaKey&&event.key.toLowerCase()==='i'){event.preventDefault();const p=primaryElement(),target=!p?.italic;applyToSelected(e=>e.italic=target,e=>e.type!=='image'&&e.type!=='connector');}
  else if(event.metaKey&&event.key.toLowerCase()==='u'){event.preventDefault();const p=primaryElement(),target=!p?.underline;applyToSelected(e=>e.underline=target,e=>e.type!=='image'&&e.type!=='connector');}
  else if(event.key==='Escape'){if(cropElementId||editingElementId){cropElementId=null;editingElementId=null;renderEditor();}else clearSelection();}
});

render();if(isNative)nativePost('ready');
