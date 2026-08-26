const STORAGE_KEY = 'morrow-presenter.deck.v1';
const VALID_LAYOUTS = new Set(['title-body', 'title', 'section']);
const SLIDE_ASPECT = 16 / 9;
const DEFAULT_IMAGE_WIDTH = 40;
const isNative = Boolean(window.webkit?.messageHandlers?.presenter);

const el = {
  deckTitle: document.querySelector('#deck-title'),
  slideList: document.querySelector('#slide-list'),
  slideCanvas: document.querySelector('#slide-canvas'),
  layoutSelect: document.querySelector('#layout-select'),
  chooseImage: document.querySelector('#choose-image'),
  imageControls: document.querySelector('#image-controls'),
  imageCropToggle: document.querySelector('#image-crop-toggle'),
  imageCropReset: document.querySelector('#image-crop-reset'),
  imageGeometry: document.querySelector('#image-geometry'),
  imageAlt: document.querySelector('#image-alt'),
  removeImage: document.querySelector('#remove-image'),
  addSlide: document.querySelector('#add-slide'),
  duplicateSlide: document.querySelector('#duplicate-slide'),
  deleteSlide: document.querySelector('#delete-slide'),
  newDeck: document.querySelector('#new-deck'),
  openDeck: document.querySelector('#open-deck'),
  saveDeck: document.querySelector('#save-deck'),
  saveAs: document.querySelector('#save-as'),
  importFile: document.querySelector('#import-file'),
  present: document.querySelector('#present'),
  saveStatus: document.querySelector('#save-status'),
  slidePosition: document.querySelector('#slide-position'),
  presentation: document.querySelector('#presentation'),
  presentationSlide: document.querySelector('#presentation-slide'),
  presentationCounter: document.querySelector('#presentation-counter'),
  presentationProgress: document.querySelector('#presentation-progress-bar'),
  exitPresentation: document.querySelector('#exit-presentation'),
};

function uid() {
  return crypto.randomUUID?.() ?? `slide-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function numberOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

function imageHeightForWidth(width, intrinsicWidth, intrinsicHeight) {
  const aspect = intrinsicWidth > 0 && intrinsicHeight > 0 ? intrinsicWidth / intrinsicHeight : SLIDE_ASPECT;
  return width * SLIDE_ASPECT / aspect;
}

function normalizeCrop(candidate) {
  const crop = candidate && typeof candidate === 'object' ? candidate : {};
  const normalized = {
    left: clamp(numberOr(crop.left, 0), 0, 95),
    top: clamp(numberOr(crop.top, 0), 0, 95),
    right: clamp(numberOr(crop.right, 0), 0, 95),
    bottom: clamp(numberOr(crop.bottom, 0), 0, 95),
  };
  if (normalized.left + normalized.right > 95) normalized.right = Math.max(0, 95 - normalized.left);
  if (normalized.top + normalized.bottom > 95) normalized.bottom = Math.max(0, 95 - normalized.top);
  return normalized;
}

function normalizeImage(candidate) {
  if (candidate == null) return null;
  if (typeof candidate !== 'object' || typeof candidate.path !== 'string' || !candidate.path.trim()) {
    throw new Error('Invalid slide image');
  }
  const path = candidate.path.replace(/\\/g, '/');
  const parts = path.split('/');
  if (path.startsWith('/') || parts.includes('..')) throw new Error('Image path must stay inside the deck directory');

  const intrinsicWidth = Math.max(1, numberOr(candidate.intrinsicWidth, 16));
  const intrinsicHeight = Math.max(1, numberOr(candidate.intrinsicHeight, 9));
  let width;
  let x;
  let y;
  if (candidate.x == null && ['right', 'left', 'background', 'full'].includes(candidate.placement)) {
    if (candidate.placement === 'right') { width = 40; x = 55; }
    else if (candidate.placement === 'left') { width = 40; x = 5; }
    else { width = 100; x = 0; }
    const legacyHeight = imageHeightForWidth(width, intrinsicWidth, intrinsicHeight);
    y = (100 - legacyHeight) / 2;
  } else {
    width = clamp(numberOr(candidate.width, DEFAULT_IMAGE_WIDTH), 1, 400);
    const height = imageHeightForWidth(width, intrinsicWidth, intrinsicHeight);
    x = clamp(numberOr(candidate.x, 50), -300, 300);
    y = clamp(numberOr(candidate.y, (100 - height) / 2), -300, 300);
  }
  const height = imageHeightForWidth(width, intrinsicWidth, intrinsicHeight);
  return {
    path,
    alt: typeof candidate.alt === 'string' ? candidate.alt : '',
    x,
    y,
    width,
    height,
    intrinsicWidth,
    intrinsicHeight,
    crop: normalizeCrop(candidate.crop),
  };
}

function starterDeck() {
  const first = uid();
  return {
    version: 1,
    title: 'Untitled deck',
    selectedId: first,
    slides: [{ id: first, layout: 'title', title: '', body: '' }],
  };
}

function normalizeDeck(candidate) {
  if (!candidate || !Array.isArray(candidate.slides) || candidate.slides.length === 0) {
    throw new Error('Invalid deck: slides are missing');
  }
  const seen = new Set();
  const slides = candidate.slides.map((slide) => {
    let id = typeof slide.id === 'string' && slide.id ? slide.id : uid();
    if (seen.has(id)) id = uid();
    seen.add(id);
    const normalized = {
      id,
      layout: VALID_LAYOUTS.has(slide.layout) ? slide.layout : 'title-body',
      title: typeof slide.title === 'string' ? slide.title : '',
      body: typeof slide.body === 'string' ? slide.body : '',
    };
    const image = normalizeImage(slide.image);
    if (image) normalized.image = image;
    return normalized;
  });
  const selectedId = slides.some((s) => s.id === candidate.selectedId)
    ? candidate.selectedId
    : slides[0].id;
  return {
    version: 1,
    title: typeof candidate.title === 'string' && candidate.title.trim() ? candidate.title : 'Untitled deck',
    selectedId,
    slides,
  };
}

function loadBrowserDeck() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeDeck(JSON.parse(raw)) : starterDeck();
  } catch (error) {
    console.warn('Failed to load saved deck:', error);
    return starterDeck();
  }
}

let state = isNative ? starterDeck() : loadBrowserDeck();
let currentPath = null;
let presentationIndex = 0;
let savePulse;
let autosaveTimer;
let cropMode = false;
const assetCache = new Map();
const assetWaiters = new Map();
const assetRequests = new Map();

function selectedIndex() {
  return Math.max(0, state.slides.findIndex((slide) => slide.id === state.selectedId));
}

function selectedSlide() {
  return state.slides[selectedIndex()];
}

function pathBasename(path) {
  return path?.split('/').filter(Boolean).pop() || 'Untitled.morrowdeck';
}

function nativePost(action, payload = {}) {
  if (!isNative) return;
  window.webkit.messageHandlers.presenter.postMessage({ action, ...payload });
}

function loadAssetInto(imageElement, path) {
  if (!path) return;
  if (assetCache.has(path)) {
    imageElement.src = assetCache.get(path);
    imageElement.classList.remove('asset-loading', 'asset-error');
    return;
  }
  imageElement.classList.add('asset-loading');
  if (!isNative) {
    imageElement.classList.add('asset-error');
    return;
  }
  if (assetWaiters.has(path)) {
    assetWaiters.get(path).push(imageElement);
    return;
  }
  assetWaiters.set(path, [imageElement]);
  const requestId = uid();
  assetRequests.set(requestId, path);
  nativePost('loadAsset', { requestId, path });
}

function cropClipPath(image) {
  const { top, right, bottom, left } = image.crop;
  return `inset(${top}% ${right}% ${bottom}% ${left}%)`;
}

function applyImageFrameGeometry(frame, image) {
  frame.style.left = `${image.x}%`;
  frame.style.top = `${image.y}%`;
  frame.style.width = `${image.width}%`;
  frame.style.height = `${image.height}%`;
  frame.querySelectorAll('.image-main').forEach((img) => { img.style.clipPath = cropClipPath(image); });

  const { left, top, right, bottom } = image.crop;
  const visibleWidth = 100 - left - right;
  const visibleHeight = 100 - top - bottom;
  const outline = frame.querySelector('.image-crop-outline');
  if (outline) {
    outline.style.left = `${left}%`;
    outline.style.top = `${top}%`;
    outline.style.width = `${visibleWidth}%`;
    outline.style.height = `${visibleHeight}%`;
  }
  const resize = frame.querySelector('.image-resize-handle');
  if (resize) {
    resize.style.left = `${100 - right}%`;
    resize.style.top = `${100 - bottom}%`;
  }
  const handles = {
    left: frame.querySelector('.crop-handle-left'),
    right: frame.querySelector('.crop-handle-right'),
    top: frame.querySelector('.crop-handle-top'),
    bottom: frame.querySelector('.crop-handle-bottom'),
  };
  if (handles.left) { handles.left.style.left = `${left}%`; handles.left.style.top = `${top}%`; handles.left.style.height = `${visibleHeight}%`; }
  if (handles.right) { handles.right.style.left = `${100 - right}%`; handles.right.style.top = `${top}%`; handles.right.style.height = `${visibleHeight}%`; }
  if (handles.top) { handles.top.style.left = `${left}%`; handles.top.style.top = `${top}%`; handles.top.style.width = `${visibleWidth}%`; }
  if (handles.bottom) { handles.bottom.style.left = `${left}%`; handles.bottom.style.top = `${100 - bottom}%`; handles.bottom.style.width = `${visibleWidth}%`; }
}

function finishImageInteraction() {
  persist();
  renderList();
  syncImageControls();
}

function startImageMove(event, frame, image) {
  if (event.button !== 0) return;
  event.preventDefault();
  const rect = el.slideCanvas.getBoundingClientRect();
  const startX = event.clientX;
  const startY = event.clientY;
  const originX = image.x;
  const originY = image.y;
  const crop = image.crop;
  const minX = 2 - image.width * (1 - crop.right / 100);
  const maxX = 98 - image.width * (crop.left / 100);
  const minY = 2 - image.height * (1 - crop.bottom / 100);
  const maxY = 98 - image.height * (crop.top / 100);

  const move = (next) => {
    image.x = clamp(originX + ((next.clientX - startX) / rect.width) * 100, minX, maxX);
    image.y = clamp(originY + ((next.clientY - startY) / rect.height) * 100, minY, maxY);
    applyImageFrameGeometry(frame, image);
    syncImageControls();
  };
  const end = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    finishImageInteraction();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end, { once: true });
  window.addEventListener('pointercancel', end, { once: true });
}

function startImageResize(event, frame, image) {
  event.stopPropagation();
  event.preventDefault();
  const rect = el.slideCanvas.getBoundingClientRect();
  const fullWidthPx = image.width / 100 * rect.width;
  const fullHeightPx = image.height / 100 * rect.height;
  const left = image.crop.left / 100;
  const top = image.crop.top / 100;
  const right = image.crop.right / 100;
  const bottom = image.crop.bottom / 100;
  const visibleWidthPx = fullWidthPx * (1 - left - right);
  const visibleHeightPx = fullHeightPx * (1 - top - bottom);
  const anchorX = image.x / 100 * rect.width + fullWidthPx * left;
  const anchorY = image.y / 100 * rect.height + fullHeightPx * top;
  const denominator = visibleWidthPx * visibleWidthPx + visibleHeightPx * visibleHeightPx;
  const originalWidth = image.width;
  const originalHeight = image.height;

  const move = (next) => {
    const targetX = next.clientX - rect.left - anchorX;
    const targetY = next.clientY - rect.top - anchorY;
    let scale = denominator > 0 ? (targetX * visibleWidthPx + targetY * visibleHeightPx) / denominator : 1;
    scale = clamp(scale, 3 / originalWidth, 400 / originalWidth);
    image.width = originalWidth * scale;
    image.height = originalHeight * scale;
    const newFullWidthPx = image.width / 100 * rect.width;
    const newFullHeightPx = image.height / 100 * rect.height;
    image.x = (anchorX - newFullWidthPx * left) / rect.width * 100;
    image.y = (anchorY - newFullHeightPx * top) / rect.height * 100;
    applyImageFrameGeometry(frame, image);
    syncImageControls();
  };
  const end = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    finishImageInteraction();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end, { once: true });
  window.addEventListener('pointercancel', end, { once: true });
}

function startCropEdge(event, frame, image, side) {
  event.stopPropagation();
  event.preventDefault();
  const rect = el.slideCanvas.getBoundingClientRect();
  const fullLeft = image.x / 100 * rect.width;
  const fullTop = image.y / 100 * rect.height;
  const fullWidth = image.width / 100 * rect.width;
  const fullHeight = image.height / 100 * rect.height;
  const initial = { ...image.crop };

  const move = (next) => {
    if (side === 'left') {
      const value = ((next.clientX - rect.left - fullLeft) / fullWidth) * 100;
      image.crop.left = clamp(value, 0, 95 - initial.right);
    } else if (side === 'right') {
      const value = 100 - ((next.clientX - rect.left - fullLeft) / fullWidth) * 100;
      image.crop.right = clamp(value, 0, 95 - initial.left);
    } else if (side === 'top') {
      const value = ((next.clientY - rect.top - fullTop) / fullHeight) * 100;
      image.crop.top = clamp(value, 0, 95 - initial.bottom);
    } else if (side === 'bottom') {
      const value = 100 - ((next.clientY - rect.top - fullTop) / fullHeight) * 100;
      image.crop.bottom = clamp(value, 0, 95 - initial.top);
    }
    applyImageFrameGeometry(frame, image);
    syncImageControls();
  };
  const end = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    finishImageInteraction();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end, { once: true });
  window.addEventListener('pointercancel', end, { once: true });
}

function makeImageFrame(image, wrapClass, imageClass, options = {}) {
  const interactive = Boolean(options.interactive);
  const frame = document.createElement('div');
  frame.className = `${wrapClass} free-image-frame${interactive ? ' image-editor-frame' : ''}${interactive && cropMode ? ' crop-mode' : ''}`;

  if (interactive) {
    const ghost = document.createElement('img');
    ghost.className = `${imageClass} image-crop-ghost`;
    ghost.alt = '';
    ghost.draggable = false;
    frame.append(ghost);
    loadAssetInto(ghost, image.path);
  }

  const img = document.createElement('img');
  img.className = `${imageClass} image-main`;
  img.alt = image.alt || '';
  img.draggable = false;
  img.addEventListener('load', () => nativePost('assetRendered', { path: image.path }), { once: true });
  frame.append(img);
  loadAssetInto(img, image.path);

  if (interactive) {
    const outline = document.createElement('div');
    outline.className = 'image-crop-outline';
    frame.append(outline);

    const resize = document.createElement('div');
    resize.className = 'image-resize-handle';
    resize.title = '拖动以等比缩放';
    resize.addEventListener('pointerdown', (event) => startImageResize(event, frame, image));
    frame.append(resize);

    for (const side of ['left', 'right', 'top', 'bottom']) {
      const handle = document.createElement('div');
      handle.className = `image-crop-handle crop-handle-${side}`;
      handle.title = `裁切 ${side}`;
      handle.addEventListener('pointerdown', (event) => startCropEdge(event, frame, image, side));
      frame.append(handle);
    }
    img.addEventListener('pointerdown', (event) => startImageMove(event, frame, image));
  }

  applyImageFrameGeometry(frame, image);
  return frame;
}

function imageClassSuffix(slide) {
  return slide.image ? ' has-image' : '';
}

window.addEventListener('error', (event) => {
  nativePost('runtimeError', { message: event.message || 'JavaScript error' });
});
window.addEventListener('unhandledrejection', (event) => {
  nativePost('runtimeError', { message: String(event.reason || 'Unhandled promise rejection') });
});

function setSaveStatus(text, pulse = false) {
  el.saveStatus.textContent = text;
  clearTimeout(savePulse);
  el.saveStatus.style.opacity = '1';
  if (pulse) savePulse = setTimeout(() => { el.saveStatus.style.opacity = '.72'; }, 700);
}

function scheduleAutosave() {
  if (!isNative || !currentPath) return;
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => nativePost('autosave', { deck: state }), 180);
}

function persist() {
  if (isNative) {
    if (currentPath) {
      setSaveStatus(`${pathBasename(currentPath)} · 正在保存…`);
      scheduleAutosave();
    } else {
      setSaveStatus('未保存 · ⌘S 保存');
    }
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  setSaveStatus('已保存到浏览器', true);
}

function updateSelected(patch) {
  const index = selectedIndex();
  state.slides[index] = { ...state.slides[index], ...patch };
  persist();
  renderList();
  renderStatus();
}

function render() {
  el.deckTitle.value = state.title;
  renderList();
  renderEditor();
  renderStatus();
}

function renderList() {
  el.slideList.replaceChildren();
  state.slides.forEach((slide, index) => {
    const row = document.createElement('div');
    row.className = 'slide-thumb-row';
    row.dataset.id = slide.id;

    const number = document.createElement('div');
    number.className = 'slide-number';
    number.textContent = String(index + 1);

    const thumb = document.createElement('button');
    thumb.className = `slide-thumb${slide.id === state.selectedId ? ' selected' : ''}`;
    thumb.type = 'button';
    thumb.draggable = true;
    thumb.dataset.id = slide.id;
    thumb.title = `Slide ${index + 1}: ${slide.title || 'Untitled'}`;

    const inner = document.createElement('div');
    inner.className = `thumb-inner ${slide.layout}${imageClassSuffix(slide)}`;
    const title = document.createElement('div');
    title.className = 'thumb-title';
    title.textContent = slide.title || 'Untitled';
    const body = document.createElement('div');
    body.className = 'thumb-body';
    body.textContent = slide.body;
    if (slide.image) inner.append(makeImageFrame(slide.image, 'thumb-image-wrap', 'thumb-image'));
    inner.append(title, body);
    thumb.append(inner);
    row.append(number, thumb);
    el.slideList.append(row);

    thumb.addEventListener('click', () => selectSlide(slide.id));
    thumb.addEventListener('dragstart', (event) => {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', slide.id);
    });
    thumb.addEventListener('dragover', (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      thumb.classList.add('drag-over');
    });
    thumb.addEventListener('dragleave', () => thumb.classList.remove('drag-over'));
    thumb.addEventListener('drop', (event) => {
      event.preventDefault();
      thumb.classList.remove('drag-over');
      moveSlide(event.dataTransfer.getData('text/plain'), slide.id);
    });
  });
}

function renderEditor() {
  const slide = selectedSlide();
  if (!slide) return;
  el.layoutSelect.value = slide.layout;
  el.slideCanvas.replaceChildren();

  const content = document.createElement('div');
  content.className = `slide-content ${slide.layout}${imageClassSuffix(slide)}`;
  const text = document.createElement('div');
  text.className = 'slide-text';

  const title = document.createElement('textarea');
  title.className = 'slide-title-input';
  title.value = slide.title;
  title.placeholder = '输入标题';
  title.rows = slide.layout === 'title-body' ? 2 : 3;
  title.setAttribute('aria-label', 'Slide title');

  const body = document.createElement('textarea');
  body.className = 'slide-body-input';
  body.value = slide.body;
  body.placeholder = '输入正文；可用换行组织内容';
  body.rows = slide.layout === 'section' ? 2 : 8;
  body.setAttribute('aria-label', 'Slide body');

  title.addEventListener('input', () => {
    state.slides[selectedIndex()].title = title.value;
    persist();
    renderList();
  });
  body.addEventListener('input', () => {
    state.slides[selectedIndex()].body = body.value;
    persist();
    renderList();
  });

  text.append(title, body);
  content.append(text);
  if (slide.image) content.append(makeImageFrame(slide.image, 'slide-image-wrap', 'slide-image', { interactive: true }));
  el.slideCanvas.append(content);
  syncImageControls();
}

function syncImageControls() {
  const image = selectedSlide()?.image || null;
  el.chooseImage.textContent = image ? '替换图片' : '添加图片';
  el.imageControls.hidden = !image;
  if (!image) return;
  el.imageCropToggle.classList.toggle('active', cropMode);
  el.imageCropToggle.textContent = cropMode ? '完成裁切' : '裁切';
  const crop = image.crop;
  el.imageCropReset.disabled = crop.left === 0 && crop.top === 0 && crop.right === 0 && crop.bottom === 0;
  el.imageGeometry.textContent = `x ${image.x.toFixed(1)} · y ${image.y.toFixed(1)} · w ${image.width.toFixed(1)}%`;
  el.imageAlt.value = image.alt;
}

function chooseImage() {
  if (!isNative) {
    alert('图片资产目前需要在 Morrow Presenter Mac App 中添加。');
    return;
  }
  nativePost('chooseImage', { deck: state });
}

function toggleCropMode() {
  if (!selectedSlide()?.image) return;
  cropMode = !cropMode;
  renderEditor();
}

function resetImageCrop() {
  const slide = selectedSlide();
  if (!slide?.image) return;
  slide.image.crop = { left: 0, top: 0, right: 0, bottom: 0 };
  persist();
  render();
}

function removeImage() {
  const slide = selectedSlide();
  if (!slide?.image) return;
  delete slide.image;
  cropMode = false;
  persist();
  render();
}

function renderStatus() {
  el.slidePosition.textContent = `${selectedIndex() + 1} / ${state.slides.length}`;
}

function selectSlide(id) {
  if (!state.slides.some((slide) => slide.id === id)) return;
  state.selectedId = id;
  cropMode = false;
  persist();
  renderList();
  renderEditor();
  renderStatus();
}

function selectSlideRef(ref) {
  if (ref == null || ref === '') return;
  const position = Number(ref);
  if (Number.isInteger(position) && position >= 1 && position <= state.slides.length) {
    state.selectedId = state.slides[position - 1].id;
    return;
  }
  if (state.slides.some((slide) => slide.id === ref)) state.selectedId = ref;
}

function addSlide() {
  const index = selectedIndex();
  const slide = { id: uid(), layout: 'title-body', title: '', body: '' };
  state.slides.splice(index + 1, 0, slide);
  state.selectedId = slide.id;
  persist();
  render();
  requestAnimationFrame(() => el.slideCanvas.querySelector('.slide-title-input')?.focus());
}

function duplicateSlide() {
  const index = selectedIndex();
  const source = selectedSlide();
  const copy = { ...source, id: uid(), ...(source.image ? { image: { ...source.image } } : {}) };
  state.slides.splice(index + 1, 0, copy);
  state.selectedId = copy.id;
  persist();
  render();
}

function deleteSlide() {
  const index = selectedIndex();
  if (state.slides.length === 1) {
    state.slides[0] = { id: state.slides[0].id, layout: 'title-body', title: '', body: '' };
  } else {
    state.slides.splice(index, 1);
    state.selectedId = state.slides[Math.min(index, state.slides.length - 1)].id;
  }
  persist();
  render();
}

function moveSlide(sourceId, targetId) {
  if (!sourceId || sourceId === targetId) return;
  const sourceIndex = state.slides.findIndex((s) => s.id === sourceId);
  const targetIndex = state.slides.findIndex((s) => s.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) return;
  const [slide] = state.slides.splice(sourceIndex, 1);
  const adjustedTarget = state.slides.findIndex((s) => s.id === targetId);
  state.slides.splice(adjustedTarget, 0, slide);
  persist();
  renderList();
  renderStatus();
}

function newDeck() {
  if (!confirm('新建演示文稿会关闭当前文稿。继续吗？')) return;
  state = starterDeck();
  currentPath = null;
  if (isNative) nativePost('new');
  else localStorage.removeItem(STORAGE_KEY);
  persist();
  render();
}

function openDeck() {
  if (isNative) nativePost('open');
  else el.importFile.click();
}

function downloadDeck() {
  const blob = new Blob([`${JSON.stringify(state, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  const filename = (state.title || 'deck').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'deck';
  anchor.href = url;
  anchor.download = `${filename}.morrowdeck`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function saveDeck(forceSaveAs = false) {
  clearTimeout(autosaveTimer);
  if (isNative) nativePost(forceSaveAs ? 'saveAs' : 'save', { deck: state });
  else downloadDeck();
}

async function importDeck(file) {
  if (!file) return;
  try {
    state = normalizeDeck(JSON.parse(await file.text()));
    persist();
    render();
  } catch (error) {
    alert(`无法打开：${error.message}`);
  } finally {
    el.importFile.value = '';
  }
}

function buildPresentationSlide(slide) {
  el.presentationSlide.replaceChildren();
  const content = document.createElement('div');
  content.className = `present-content ${slide.layout}${imageClassSuffix(slide)}`;
  const text = document.createElement('div');
  text.className = 'present-text';
  const title = document.createElement('div');
  title.className = 'present-title';
  title.textContent = slide.title || '';
  text.append(title);
  if (slide.layout !== 'title' && slide.body) {
    const body = document.createElement('div');
    body.className = 'present-body';
    body.textContent = slide.body;
    text.append(body);
  }
  content.append(text);
  if (slide.image) content.append(makeImageFrame(slide.image, 'present-image-wrap', 'present-image'));
  el.presentationSlide.append(content);
  el.presentationCounter.textContent = `${presentationIndex + 1} / ${state.slides.length}`;
  el.presentationProgress.style.width = `${((presentationIndex + 1) / state.slides.length) * 100}%`;
}

async function startPresentation() {
  presentationIndex = selectedIndex();
  buildPresentationSlide(state.slides[presentationIndex]);
  el.presentation.hidden = false;
  document.body.style.overflow = 'hidden';
  if (isNative) {
    nativePost('presentStart');
  } else {
    try { await el.presentation.requestFullscreen?.(); } catch (error) { console.info('Fullscreen was not entered:', error); }
  }
}

async function exitPresentation() {
  if (el.presentation.hidden) return;
  el.presentation.hidden = true;
  document.body.style.overflow = 'hidden';
  if (isNative) {
    nativePost('presentEnd');
  } else if (document.fullscreenElement) {
    try { await document.exitFullscreen(); } catch (_) {}
  }
}

function nextSlide(delta) {
  presentationIndex = Math.max(0, Math.min(state.slides.length - 1, presentationIndex + delta));
  buildPresentationSlide(state.slides[presentationIndex]);
}

window.presenterNativeContext = ({ path }) => {
  currentPath = path || null;
  setSaveStatus(currentPath ? `${pathBasename(currentPath)} · 已保存` : '未保存 · ⌘S 保存', true);
};

window.presenterNativeSaved = ({ path }) => {
  currentPath = path;
  setSaveStatus(`${pathBasename(currentPath)} · 已保存`, true);
};

window.presenterNativeLoad = ({ json, path, present, slide }) => {
  try {
    state = normalizeDeck(JSON.parse(json));
    currentPath = path;
    selectSlideRef(slide);
    render();
    setSaveStatus(`${pathBasename(path)} · 已保存`, true);
    if (present) setTimeout(startPresentation, 80);
  } catch (error) {
    alert(`无法打开文稿：${error.message}`);
  }
};

window.presenterNativeExternalLoad = ({ json, path }) => {
  try {
    const previousSelected = state.selectedId;
    state = normalizeDeck(JSON.parse(json));
    if (state.slides.some((slide) => slide.id === previousSelected)) state.selectedId = previousSelected;
    currentPath = path;
    render();
    setSaveStatus(`${pathBasename(path)} · 已同步 shell 修改`, true);
  } catch (error) {
    console.warn('External deck update ignored:', error);
  }
};

window.presenterNativeImageChosen = ({ path, name, width, height }) => {
  const slide = selectedSlide();
  if (!slide) return;
  const intrinsicWidth = Math.max(1, numberOr(width, 16));
  const intrinsicHeight = Math.max(1, numberOr(height, 9));
  const imageWidth = DEFAULT_IMAGE_WIDTH;
  const imageHeight = imageHeightForWidth(imageWidth, intrinsicWidth, intrinsicHeight);
  slide.image = {
    path,
    alt: name || '',
    x: 55,
    y: (100 - imageHeight) / 2,
    width: imageWidth,
    height: imageHeight,
    intrinsicWidth,
    intrinsicHeight,
    crop: { left: 0, top: 0, right: 0, bottom: 0 },
  };
  cropMode = false;
  persist();
  render();
};

window.presenterNativeAsset = ({ requestId, path, dataURL, error }) => {
  const expectedPath = assetRequests.get(requestId) || path;
  assetRequests.delete(requestId);
  const waiters = assetWaiters.get(expectedPath) || [];
  assetWaiters.delete(expectedPath);
  if (dataURL) assetCache.set(expectedPath, dataURL);
  waiters.forEach((img) => {
    img.classList.remove('asset-loading');
    if (dataURL) {
      img.src = dataURL;
      img.classList.remove('asset-error');
    } else {
      img.classList.add('asset-error');
      img.title = error || 'Unable to load image';
    }
  });
};

window.presenterNativeFullscreenEnded = () => {
  if (!el.presentation.hidden) {
    el.presentation.hidden = true;
    document.body.style.overflow = 'hidden';
  }
};

window.presenterMenuAction = (action) => {
  if (action === 'new') newDeck();
  else if (action === 'save') saveDeck(false);
  else if (action === 'saveAs') saveDeck(true);
  else if (action === 'present') startPresentation();
};

el.deckTitle.addEventListener('input', () => {
  state.title = el.deckTitle.value;
  persist();
});
el.layoutSelect.addEventListener('change', () => {
  updateSelected({ layout: el.layoutSelect.value });
  renderEditor();
});
el.chooseImage.addEventListener('click', chooseImage);
el.removeImage.addEventListener('click', removeImage);
el.imageCropToggle.addEventListener('click', toggleCropMode);
el.imageCropReset.addEventListener('click', resetImageCrop);
el.imageAlt.addEventListener('input', () => {
  const slide = selectedSlide();
  if (!slide?.image) return;
  slide.image = { ...slide.image, alt: el.imageAlt.value };
  persist();
});
el.addSlide.addEventListener('click', addSlide);
el.duplicateSlide.addEventListener('click', duplicateSlide);
el.deleteSlide.addEventListener('click', deleteSlide);
el.newDeck.addEventListener('click', newDeck);
el.openDeck.addEventListener('click', openDeck);
el.saveDeck.addEventListener('click', () => saveDeck(false));
el.saveAs.addEventListener('click', () => saveDeck(true));
el.importFile.addEventListener('change', () => importDeck(el.importFile.files?.[0]));
el.present.addEventListener('click', startPresentation);
el.exitPresentation.addEventListener('click', exitPresentation);

if (!isNative) {
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && !el.presentation.hidden) exitPresentation();
  });
}

document.addEventListener('keydown', (event) => {
  if (!el.presentation.hidden) {
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(event.key)) {
      event.preventDefault();
      nextSlide(1);
    } else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key)) {
      event.preventDefault();
      nextSlide(-1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      presentationIndex = 0;
      buildPresentationSlide(state.slides[presentationIndex]);
    } else if (event.key === 'End') {
      event.preventDefault();
      presentationIndex = state.slides.length - 1;
      buildPresentationSlide(state.slides[presentationIndex]);
    } else if (event.key === 'Escape') {
      exitPresentation();
    }
    return;
  }

  if (event.metaKey && event.shiftKey && event.key.toLowerCase() === 'n') {
    event.preventDefault();
    addSlide();
  } else if (event.metaKey && event.key.toLowerCase() === 'd') {
    event.preventDefault();
    duplicateSlide();
  } else if (event.metaKey && event.key === 'Enter') {
    event.preventDefault();
    startPresentation();
  }
});

render();
if (isNative) nativePost('ready');
