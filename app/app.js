// The atlas is deliberately dependency-free: one local JSON fetch, one DOM render, and all progress in localStorage.
const DATA_URL = 'data/trophies.json';
const STORAGE_KEY = 'vice-city-trophy-atlas:progress:v1';
const SPOILER_KEY = 'vice-city-trophy-atlas:spoilers';
const LEGACY_KEY = 'gta6-trophy-checklist';
const VALID_KINDS = new Set(['story', 'stranger', 'collectible', 'activity', 'crime', 'exploration', 'misc']);
const VALID_GRADES = new Set(['platinum', 'gold', 'silver', 'bronze']);
const KIND_LABELS = { story: 'Story', stranger: 'Strangers', collectible: 'Collectible', activity: 'Activity', crime: 'Crime', exploration: 'Exploration', misc: 'Misc' };
const GRADE_ORDER = ['platinum', 'gold', 'silver', 'bronze'];
const SHORT_GRADE = { platinum: 'P', gold: 'G', silver: 'S', bronze: 'B' };
const params = new URLSearchParams(window.location.search);

const dom = {
  progressFraction: document.getElementById('progress-fraction'),
  progressPercent: document.getElementById('progress-percent'),
  progressCaption: document.getElementById('progress-caption'),
  progressTrack: document.getElementById('progress-track'),
  progressBar: document.getElementById('progress-bar'),
  navCount: document.getElementById('nav-count'),
  listFraction: document.getElementById('list-fraction'),
  listPercent: document.getElementById('list-percent'),
  listProgressTrack: document.getElementById('list-progress-track'),
  listProgressBar: document.getElementById('list-progress-bar'),
  navSpoiler: document.getElementById('nav-spoiler-toggle'),
  navSpoilerLabel: document.getElementById('nav-spoiler-label'),
  search: document.getElementById('search'),
  kindFilter: document.getElementById('kind-filter'),
  gradeFilter: document.getElementById('grade-filter'),
  statusFilter: document.getElementById('status-filter'),
  missableOnly: document.getElementById('missable-only'),
  spoilerToggle: document.getElementById('spoiler-toggle'),
  exportProgress: document.getElementById('export-progress'),
  importProgress: document.getElementById('import-progress'),
  visibleCount: document.getElementById('visible-count'),
  filterDescription: document.getElementById('filter-description'),
  resetFilters: document.getElementById('reset-filters'),
  spoilerNote: document.getElementById('spoiler-note'),
  trophyList: document.getElementById('trophy-list'),
  emptyState: document.getElementById('empty-state'),
  emptyReset: document.getElementById('empty-reset'),
  toast: document.getElementById('toast'),
};

const state = {
  earned: new Set(),
  kind: 'all',
  grade: 'all',
  status: 'all',
  missableOnly: false,
  search: '',
  hideSpoilers: true,
  openGuideId: null,
};

let documentData;
let trophies;
let trophyById;
let toastTimer;
const gradeTotals = Object.fromEntries(GRADE_ORDER.map((grade) => [grade, 0]));

function readStoredJson(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStoredJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    showToast('Progress could not be saved in this browser.', true);
    return false;
  }
}

function normalizeEarned(raw) {
  const values = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object'
      ? raw.earned ?? raw.earnedIds ?? raw.earnedNames ?? raw.trophies ?? []
      : [];
  if (!Array.isArray(values)) return new Set();
  const result = new Set();
  for (const value of values) {
    const candidate = value && typeof value === 'object' ? value.id ?? value.name : value;
    if (typeof candidate === 'number' && trophyById.has(candidate)) {
      result.add(candidate);
    } else if (typeof candidate === 'string') {
      const byName = trophies.find((trophy) => trophy.name === candidate);
      const numeric = Number(candidate);
      if (byName) result.add(byName.id);
      else if (Number.isInteger(numeric) && trophyById.has(numeric)) result.add(numeric);
    }
  }
  return result;
}

function loadProgress() {
  const stored = readStoredJson(STORAGE_KEY);
  if (stored) return normalizeEarned(stored);
  const legacy = readStoredJson(LEGACY_KEY);
  return legacy ? normalizeEarned(legacy) : new Set();
}

function saveProgress() {
  writeStoredJson(STORAGE_KEY, {
    format: 'vice-city-trophy-atlas-progress',
    version: 1,
    updatedAt: new Date().toISOString(),
    earned: [...state.earned].sort((a, b) => a - b),
  });
}

function isRevealed(trophy) {
  return !trophy.hidden || !state.hideSpoilers || state.earned.has(trophy.id);
}

function formatCount(trophy) {
  if (trophy.count === null || trophy.count === undefined) return '';
  const value = Number(trophy.count).toLocaleString('en-US');
  const label = trophy.countLabel ?? '';
  if (label.startsWith('$')) return `$${value} ${label.slice(1).trim()}`.trim();
  return `${value}${label ? ` ${label}` : ''}`;
}

function makeElement(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function applyUrlState() {
  const spoilerParam = params.get('spoiler');
  if (spoilerParam === 'off') state.hideSpoilers = false;
  if (spoilerParam === 'on') state.hideSpoilers = true;

  const filter = params.get('filter');
  if (filter && VALID_KINDS.has(filter)) state.kind = filter;

  const grade = params.get('grade');
  if (grade && VALID_GRADES.has(grade)) state.grade = grade;

  const requestedGuide = Number(params.get('guide'));
  if (Number.isInteger(requestedGuide) && trophyById.has(requestedGuide)) {
    state.kind = 'all';
    state.grade = 'all';
    state.status = 'all';
    state.missableOnly = false;
    state.search = '';
    state.openGuideId = requestedGuide;
    const trophy = trophyById.get(requestedGuide);
    if (trophy.hidden && spoilerParam !== 'on') state.hideSpoilers = false;
  }
}

function syncControls() {
  dom.kindFilter.value = state.kind;
  dom.gradeFilter.value = state.grade;
  dom.search.value = state.search;
  dom.missableOnly.checked = state.missableOnly;
  dom.spoilerToggle.checked = state.hideSpoilers;
  dom.navSpoiler.setAttribute('aria-pressed', String(state.hideSpoilers));
  dom.navSpoilerLabel.textContent = `Hide spoilers: ${state.hideSpoilers ? 'ON' : 'OFF'}`;
  dom.spoilerNote.hidden = !state.hideSpoilers;
  for (const button of dom.statusFilter.querySelectorAll('button[data-status]')) {
    const active = button.dataset.status === state.status;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  }
}

function renderProgress() {
  const count = state.earned.size;
  const total = trophies.length;
  const percent = Math.round((count / total) * 100);
  dom.progressFraction.replaceChildren(document.createTextNode(String(count)), makeElement('span', '', `/${total}`));
  dom.progressPercent.textContent = `${percent}%`;
  dom.progressBar.style.width = `${percent}%`;
  dom.progressTrack.setAttribute('aria-valuenow', String(count));
  dom.navCount.textContent = `${count}/${total}`;
  dom.listFraction.textContent = `${count}/${total}`;
  dom.listPercent.textContent = `${percent}%`;
  dom.listProgressBar.style.width = `${percent}%`;
  dom.listProgressTrack.setAttribute('aria-valuenow', String(count));

  const remaining = total - count;
  if (count === 0) dom.progressCaption.textContent = 'No trophies marked yet. The first marker is yours.';
  else if (remaining === 0) dom.progressCaption.textContent = 'Leonida Legend. Every trophy is locked in.';
  else if (remaining === 1) dom.progressCaption.textContent = 'One trophy left between you and the Platinum.';
  else dom.progressCaption.textContent = `${remaining} trophies remain. Keep the route moving.`;

  for (const grade of GRADE_ORDER) {
    const earned = trophies.filter((trophy) => trophy.grade === grade && state.earned.has(trophy.id)).length;
    const target = document.querySelector(`[data-grade-earned="${grade}"]`);
    if (target) target.textContent = String(earned);
  }
}

function matchesFilters(trophy) {
  if (state.kind !== 'all' && trophy.kind !== state.kind) return false;
  if (state.grade !== 'all' && trophy.grade !== state.grade) return false;
  if (state.missableOnly && !trophy.missable) return false;
  if (state.status === 'earned' && !state.earned.has(trophy.id)) return false;
  if (state.status === 'unearned' && state.earned.has(trophy.id)) return false;

  if (state.search) {
    const query = state.search.toLowerCase();
    const revealed = isRevealed(trophy);
    const haystack = revealed
      ? [trophy.name, trophy.description, trophy.guide, trophy.countLabel ?? '', trophy.sources.join(' ')].join(' ').toLowerCase()
      : `hidden trophy ${trophy.grade} ${trophy.kind}`;
    if (!haystack.includes(query)) return false;
  }
  return true;
}

function renderFilterSummary(visibleCount) {
  const descriptions = [];
  descriptions.push(state.kind === 'all' ? 'all kinds' : KIND_LABELS[state.kind]);
  descriptions.push(state.grade === 'all' ? 'every grade' : `${state.grade} grade`);
  if (state.status !== 'all') descriptions.push(`${state.status} only`);
  if (state.missableOnly) descriptions.push('missable only');
  if (state.search) descriptions.push(`search “${state.search}”`);
  dom.visibleCount.textContent = `Showing ${visibleCount} of ${trophies.length}`;
  dom.filterDescription.textContent = descriptions.join(' · ');
}

function buildBadge(text, className = 'badge') {
  return makeElement('span', className, text);
}

function buildTrophyCard(trophy, revealed, isOpen) {
  const card = makeElement('article', 'trophy-card');
  card.dataset.trophyId = String(trophy.id);
  card.classList.toggle('is-earned', state.earned.has(trophy.id));
  card.classList.toggle('is-locked', !revealed);
  card.classList.toggle('is-guide-open', isOpen);

  const checkCell = makeElement('div', 'check-cell');
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'earned-toggle';
  checkbox.id = `earn-${trophy.id}`;
  checkbox.checked = state.earned.has(trophy.id);
  checkbox.dataset.earnId = String(trophy.id);
  checkbox.setAttribute('aria-label', revealed ? `Mark ${trophy.name} as earned` : 'Mark hidden trophy as earned and reveal it');
  checkCell.append(checkbox);

  const medal = makeElement('div', `medal grade-${trophy.grade}`);
  medal.setAttribute('aria-hidden', 'true');
  medal.append(makeElement('span', '', SHORT_GRADE[trophy.grade]));

  const content = makeElement('div', 'card-content');
  const topline = makeElement('div', 'card-topline');
  const titleWrap = makeElement('div', 'trophy-title');
  titleWrap.append(makeElement('h3', '', revealed ? trophy.name : 'Hidden trophy — earn it to reveal'));

  const description = makeElement(
    'p',
    'trophy-description',
    revealed ? trophy.description : 'This is a hidden PlayStation trophy. Tick it once earned to reveal the official name, description, route and sources.',
  );
  titleWrap.append(description);

  const badges = makeElement('div', 'badge-row');
  badges.append(buildBadge(trophy.grade, `badge badge-grade grade-${trophy.grade}`));
  if (revealed) badges.append(buildBadge(KIND_LABELS[trophy.kind], `badge badge-kind-${trophy.kind}`));
  if (trophy.hidden) badges.append(buildBadge('Hidden', 'badge badge-hidden'));
  if (revealed && trophy.missable) badges.append(buildBadge('Missable', 'badge badge-missable'));
  if (revealed && formatCount(trophy)) badges.append(buildBadge(formatCount(trophy), 'badge badge-count'));

  topline.append(titleWrap, badges);
  content.append(topline);

  const actions = makeElement('div', 'card-actions');
  if (revealed) {
    const toggle = makeElement('button', 'guide-toggle');
    toggle.type = 'button';
    toggle.dataset.guideToggle = String(trophy.id);
    toggle.setAttribute('aria-expanded', String(isOpen));
    toggle.setAttribute('aria-controls', `guide-${trophy.id}`);
    toggle.append(makeElement('span', 'chevron'));
    toggle.append(document.createTextNode(isOpen ? 'Close route' : 'Read route'));
    actions.append(toggle);
    const saved = makeElement('span', `saved-flag${state.earned.has(trophy.id) ? ' is-on' : ''}`, state.earned.has(trophy.id) ? 'Earned · saved' : 'Not earned');
    actions.append(saved);
  } else {
    actions.append(makeElement('span', 'locked-copy', 'Route sealed by the spoiler guard.'));
  }
  content.append(actions);

  card.append(checkCell, medal, content);

  if (isOpen && revealed) {
    const drawer = makeElement('div', 'guide-drawer');
    drawer.id = `guide-${trophy.id}`;
    const copy = makeElement('div', 'guide-copy');
    copy.append(makeElement('h4', '', 'Trophy route'));
    copy.append(makeElement('p', '', trophy.guide));
    const sources = makeElement('aside', 'guide-sources');
    sources.append(makeElement('h4', '', 'Sources cited'));
    const list = makeElement('ul');
    for (const source of trophy.sources) list.append(makeElement('li', '', source));
    sources.append(list);
    drawer.append(copy, sources);
    card.append(drawer);
  }

  return card;
}

function renderTrophies({ preserveFocus = false } = {}) {
  const visible = trophies.filter(matchesFilters);
  const visibleIds = new Set(visible.map((trophy) => trophy.id));
  if (state.openGuideId !== null && !visibleIds.has(state.openGuideId)) state.openGuideId = null;

  const fragment = document.createDocumentFragment();
  for (const trophy of visible) {
    const revealed = isRevealed(trophy);
    fragment.append(buildTrophyCard(trophy, revealed, state.openGuideId === trophy.id && revealed));
  }
  dom.trophyList.replaceChildren(fragment);
  dom.emptyState.hidden = visible.length !== 0;
  dom.trophyList.hidden = visible.length === 0;
  renderFilterSummary(visible.length);

  if (preserveFocus) {
    const active = document.activeElement;
    if (active?.matches?.('.earned-toggle')) {
      const replacement = document.getElementById(active.id);
      replacement?.focus({ preventScroll: true });
    }
  }
}

function renderAll() {
  renderProgress();
  renderTrophies();
}

function resetFilters({ render = true } = {}) {
  state.kind = 'all';
  state.grade = 'all';
  state.status = 'all';
  state.missableOnly = false;
  state.search = '';
  syncControls();
  if (render) renderTrophies();
}

function setHideSpoilers(value, persist = true) {
  state.hideSpoilers = value;
  if (persist) writeStoredJson(SPOILER_KEY, value ? 'on' : 'off');
  syncControls();
  renderTrophies();
}

function showGuide(id, { reset = false, scroll = true } = {}) {
  const trophy = trophyById.get(id);
  if (!trophy) return;
  if (reset) resetFilters({ render: false });
  if (trophy.hidden && state.hideSpoilers) setHideSpoilers(false, false);
  state.openGuideId = id;
  renderAll();
  if (scroll) {
    requestAnimationFrame(() => {
      document.querySelector(`[data-trophy-id="${id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }
}

function toggleGuide(id) {
  const next = state.openGuideId === id ? null : id;
  state.openGuideId = next;
  renderTrophies();
  if (next !== null) {
    requestAnimationFrame(() => {
      document.querySelector(`[data-trophy-id="${id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }
}

function showToast(message, isError = false) {
  clearTimeout(toastTimer);
  dom.toast.textContent = message;
  dom.toast.classList.toggle('is-error', isError);
  dom.toast.classList.add('is-visible');
  toastTimer = setTimeout(() => dom.toast.classList.remove('is-visible'), 2800);
}

function exportProgress() {
  const payload = {
    format: 'vice-city-trophy-atlas-progress',
    version: 1,
    exportedAt: new Date().toISOString(),
    earned: [...state.earned].sort((a, b) => a - b),
    earnedNames: trophies.filter((trophy) => state.earned.has(trophy.id)).map((trophy) => trophy.name),
  };
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `gta6-trophy-progress-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(`Exported ${state.earned.size} earned trophies.`);
}

async function importProgress(file) {
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const imported = normalizeEarned(parsed);
    const supplied = Array.isArray(parsed)
      ? parsed.length
      : Array.isArray(parsed?.earned)
        ? parsed.earned.length
        : 0;
    if (supplied > 0 && imported.size === 0) throw new Error('No recognised trophy ids or names.');
    state.earned = imported;
    saveProgress();
    renderAll();
    showToast(`Imported ${imported.size} earned trophies.`);
  } catch (error) {
    showToast(`Import failed: ${error instanceof Error ? error.message : 'invalid JSON'}`, true);
  }
}

function scrollToRequestedView() {
  const view = params.get('view');
  const requestedFilter = params.get('filter');
  const guideId = Number(params.get('guide'));
  requestAnimationFrame(() => {
    if (Number.isInteger(guideId) && trophyById.has(guideId)) {
      document.querySelector(`[data-trophy-id="${guideId}"]`)?.scrollIntoView({ block: 'center' });
      return;
    }
    if (view === 'roadmap') {
      document.getElementById('roadmap')?.scrollIntoView({ block: 'start' });
      return;
    }
    if (view === 'checklist' || view === 'trophies' || requestedFilter) {
      document.getElementById('checklist')?.scrollIntoView({ block: 'start' });
    }
  });
}

function wireEvents() {
  dom.search.addEventListener('input', () => {
    state.search = dom.search.value.trim();
    renderTrophies();
  });
  dom.kindFilter.addEventListener('change', () => {
    state.kind = VALID_KINDS.has(dom.kindFilter.value) ? dom.kindFilter.value : 'all';
    renderTrophies();
  });
  dom.gradeFilter.addEventListener('change', () => {
    state.grade = VALID_GRADES.has(dom.gradeFilter.value) ? dom.gradeFilter.value : 'all';
    renderTrophies();
  });
  dom.statusFilter.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-status]');
    if (!button) return;
    state.status = button.dataset.status;
    syncControls();
    renderTrophies();
  });
  dom.missableOnly.addEventListener('change', () => {
    state.missableOnly = dom.missableOnly.checked;
    renderTrophies();
  });
  dom.spoilerToggle.addEventListener('change', () => setHideSpoilers(dom.spoilerToggle.checked));
  dom.navSpoiler.addEventListener('click', () => setHideSpoilers(!state.hideSpoilers));
  dom.resetFilters.addEventListener('click', () => resetFilters());
  dom.emptyReset.addEventListener('click', () => resetFilters());
  dom.exportProgress.addEventListener('click', exportProgress);
  dom.importProgress.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    await importProgress(file);
    event.target.value = '';
  });
  dom.trophyList.addEventListener('change', (event) => {
    const checkbox = event.target.closest('.earned-toggle');
    if (!checkbox) return;
    const id = Number(checkbox.dataset.earnId);
    const trophy = trophyById.get(id);
    if (!trophy) return;
    checkbox.checked ? state.earned.add(id) : state.earned.delete(id);
    saveProgress();
    renderProgress();
    renderTrophies();
    document.getElementById(`earn-${id}`)?.focus({ preventScroll: true });
    const label = isRevealed(trophy) ? trophy.name : 'hidden trophy';
    showToast(`${checkbox.checked ? 'Earned' : 'Unmarked'}: ${label}`);
  });
  dom.trophyList.addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-guide-toggle]');
    if (toggle) toggleGuide(Number(toggle.dataset.guideToggle));
  });
  document.addEventListener('click', (event) => {
    const opener = event.target.closest('[data-open-guide]');
    if (opener) showGuide(Number(opener.dataset.openGuide), { reset: true });
  });
}

async function boot() {
  try {
    const response = await fetch(DATA_URL);
    if (!response.ok) throw new Error(`trophy data returned ${response.status}`);
    documentData = await response.json();
    trophies = documentData.trophies ?? documentData;
    trophyById = new Map(trophies.map((trophy) => [trophy.id, trophy]));
    for (const trophy of trophies) gradeTotals[trophy.grade] += 1;

    const savedSpoiler = localStorage.getItem(SPOILER_KEY);
    state.hideSpoilers = savedSpoiler === null ? true : savedSpoiler !== 'off';
    state.earned = loadProgress();
    applyUrlState();
    wireEvents();
    syncControls();
    renderAll();
    scrollToRequestedView();
  } catch (error) {
    dom.trophyList.replaceChildren(makeElement('p', 'empty-state', `The trophy data could not be loaded: ${error.message}`));
  }
}

boot();
