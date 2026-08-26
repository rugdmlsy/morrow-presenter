const STORAGE_KEY = 'morrow-presenter.deck.v1';
const VALID_LAYOUTS = new Set(['title-body', 'title', 'section']);
const isNative = Boolean(window.webkit?.messageHandlers?.presenter);

const el = {
  deckTitle: document.querySelector('#deck-title'),
  slideList: document.querySelector('#slide-list'),
  slideCanvas: document.querySelector('#slide-canvas'),
  layoutSelect: document.querySelector('#layout-select'),
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
    return {
      id,
      layout: VALID_LAYOUTS.has(slide.layout) ? slide.layout : 'title-body',
      title: typeof slide.title === 'string' ? slide.title : '',
      body: typeof slide.body === 'string' ? slide.body : '',
    };
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
    inner.className = `thumb-inner ${slide.layout}`;
    const title = document.createElement('div');
    title.className = 'thumb-title';
    title.textContent = slide.title || 'Untitled';
    const body = document.createElement('div');
    body.className = 'thumb-body';
    body.textContent = slide.body;
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
  content.className = `slide-content ${slide.layout}`;

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

  content.append(title, body);
  el.slideCanvas.append(content);
}

function renderStatus() {
  el.slidePosition.textContent = `${selectedIndex() + 1} / ${state.slides.length}`;
}

function selectSlide(id) {
  if (!state.slides.some((slide) => slide.id === id)) return;
  state.selectedId = id;
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
  const copy = { ...source, id: uid() };
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
  content.className = `present-content ${slide.layout}`;
  const title = document.createElement('div');
  title.className = 'present-title';
  title.textContent = slide.title || '';
  content.append(title);
  if (slide.layout !== 'title' && slide.body) {
    const body = document.createElement('div');
    body.className = 'present-body';
    body.textContent = slide.body;
    content.append(body);
  }
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
