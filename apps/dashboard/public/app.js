const TAB_CONFIG = {
  overview: {
    type: null,
    limit: 160,
  },
  errors: {
    type: 'error,promise_rejection',
    limit: 240,
  },
  console: {
    type: 'console',
    limit: 240,
  },
  network: {
    type: 'network',
    limit: 500,
  },
};

const NETWORK_ROW_HEIGHT = 72;
const NETWORK_OVERSCAN = 6;

const refs = {
  status: document.getElementById('status'),
  refresh: document.getElementById('refresh'),
  clearCurrent: document.getElementById('clearCurrent'),
  clearAll: document.getElementById('clearAll'),
  autoRefresh: document.getElementById('autoRefresh'),
  tabs: document.getElementById('tabs'),
  panels: {
    overview: document.getElementById('panel-overview'),
    errors: document.getElementById('panel-errors'),
    console: document.getElementById('panel-console'),
    network: document.getElementById('panel-network'),
  },
  overviewStats: document.getElementById('overviewStats'),
  overviewList: document.getElementById('overviewList'),
  errorsList: document.getElementById('errorsList'),
  consoleList: document.getElementById('consoleList'),
  overviewLoadMore: document.getElementById('overviewLoadMore'),
  errorsLoadMore: document.getElementById('errorsLoadMore'),
  consoleLoadMore: document.getElementById('consoleLoadMore'),
  networkLoadMore: document.getElementById('networkLoadMore'),
  networkViewport: document.getElementById('networkViewport'),
  networkSpacer: document.getElementById('networkSpacer'),
  networkRows: document.getElementById('networkRows'),
  networkDetail: document.getElementById('networkDetail'),
};

const state = {
  activeTab: 'overview',
  autoRefresh: true,
  notice: null,
  isDeleting: false,
  selectedNetworkId: null,
  tabs: {
    overview: createTabState(),
    errors: createTabState(),
    console: createTabState(),
    network: createTabState(),
  },
};

function createTabState() {
  return {
    events: [],
    loading: false,
    loadingMore: false,
    hasMore: true,
    error: null,
  };
}

init();

function init() {
  refs.refresh?.addEventListener('click', () => {
    state.notice = null;
    void loadInitial(state.activeTab, true);
  });

  refs.clearCurrent?.addEventListener('click', () => {
    void clearLogs(false);
  });

  refs.clearAll?.addEventListener('click', () => {
    void clearLogs(true);
  });

  refs.autoRefresh?.addEventListener('change', () => {
    state.autoRefresh = Boolean(refs.autoRefresh.checked);
    renderStatus();
  });

  refs.tabs?.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const button = target.closest('.tab');
    if (!(button instanceof HTMLElement)) {
      return;
    }
    const tab = button.dataset.tab;
    if (!tab || !TAB_CONFIG[tab]) {
      return;
    }
    void switchTab(tab);
  });

  refs.overviewLoadMore?.addEventListener('click', () => void loadOlder('overview'));
  refs.errorsLoadMore?.addEventListener('click', () => void loadOlder('errors'));
  refs.consoleLoadMore?.addEventListener('click', () => void loadOlder('console'));
  refs.networkLoadMore?.addEventListener('click', () => void loadOlder('network'));

  refs.networkViewport?.addEventListener('scroll', () => {
    if (state.activeTab === 'network') {
      renderNetworkRows();
    }
  });

  refs.networkRows?.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const row = target.closest('.network-row-item');
    if (!(row instanceof HTMLElement)) {
      return;
    }
    const eventId = row.dataset.eventId;
    if (!eventId) {
      return;
    }
    state.selectedNetworkId = eventId;
    renderNetworkDetail(findEventById('network', eventId));
    renderNetworkRows();
  });

  void loadInitial('overview');

  setInterval(() => {
    if (!state.autoRefresh) {
      return;
    }
    void loadLatest(state.activeTab);
  }, 2500);
}

async function switchTab(tab) {
  state.activeTab = tab;
  renderShell();
  const tabState = state.tabs[tab];
  if (tabState.events.length === 0 && !tabState.loading) {
    await loadInitial(tab);
    return;
  }
  renderActivePanel();
}

async function loadInitial(tab, force = false) {
  const tabState = state.tabs[tab];
  if (tabState.loading) {
    return;
  }
  if (!force && tabState.events.length > 0) {
    renderActivePanel();
    return;
  }

  tabState.loading = true;
  tabState.error = null;
  renderShell();
  try {
    const incoming = await fetchEvents(tab, {});
    tabState.events = sortEvents(uniqueById(incoming));
    tabState.hasMore = incoming.length >= TAB_CONFIG[tab].limit;
    ensureSelectedNetwork();
  } catch (error) {
    tabState.error = asErrorMessage(error);
  } finally {
    tabState.loading = false;
    renderShell();
    renderActivePanel();
  }
}

async function loadLatest(tab) {
  const tabState = state.tabs[tab];
  if (tabState.loading || tabState.loadingMore) {
    return;
  }
  if (tabState.events.length === 0) {
    await loadInitial(tab);
    return;
  }

  const newestCursor = getEventCursor(tabState.events[0]);
  if (!newestCursor) {
    return;
  }

  try {
    const incoming = await fetchEvents(tab, { after: newestCursor });
    if (incoming.length > 0) {
      tabState.events = sortEvents(uniqueById([...incoming, ...tabState.events]));
      ensureSelectedNetwork();
    }
  } catch (error) {
    tabState.error = asErrorMessage(error);
  }

  renderShell();
  if (state.activeTab === tab) {
    renderActivePanel();
  }
}

async function loadOlder(tab) {
  const tabState = state.tabs[tab];
  if (tabState.loading || tabState.loadingMore || !tabState.hasMore) {
    return;
  }
  const oldest = tabState.events[tabState.events.length - 1];
  const before = getEventCursor(oldest);
  if (!before) {
    tabState.hasMore = false;
    renderShell();
    renderActivePanel();
    return;
  }

  tabState.loadingMore = true;
  tabState.error = null;
  renderShell();
  try {
    const incoming = await fetchEvents(tab, { before });
    tabState.events = sortEvents(uniqueById([...tabState.events, ...incoming]));
    tabState.hasMore = incoming.length >= TAB_CONFIG[tab].limit;
    ensureSelectedNetwork();
  } catch (error) {
    tabState.error = asErrorMessage(error);
  } finally {
    tabState.loadingMore = false;
    renderShell();
    if (state.activeTab === tab) {
      renderActivePanel();
    }
  }
}

async function clearLogs(clearAll) {
  const active = state.activeTab;
  const type = clearAll ? null : getTypeFilterForTab(active);
  const label = clearAll ? 'all logs' : `${active} logs`;
  const ok = window.confirm(`Delete ${label}?`);
  if (!ok) {
    return;
  }

  const tabState = state.tabs[active];
  tabState.error = null;
  state.isDeleting = true;
  state.notice = null;
  renderShell();

  try {
    const result = await deleteEventsRequest(type);
    applyDeleteToLocalState(type);
    state.notice = `deleted ${result.removed} logs`;
    await loadInitial('overview', true);
    if (active !== 'overview') {
      await loadInitial(active, true);
    }
  } catch (error) {
    tabState.error = asErrorMessage(error);
    state.notice = null;
  } finally {
    state.isDeleting = false;
    renderShell();
    renderActivePanel();
  }
}

async function fetchEvents(tab, opts) {
  const cfg = TAB_CONFIG[tab];
  const query = new URLSearchParams();
  query.set('limit', String(cfg.limit));
  if (cfg.type) {
    query.set('type', cfg.type);
  }
  if (opts.before) {
    query.set('before', opts.before);
  }
  if (opts.after) {
    query.set('after', opts.after);
  }

  const res = await fetch(`/api/events?${query.toString()}`);
  if (!res.ok) {
    throw new Error(`failed to fetch events (${res.status})`);
  }
  const data = await res.json();
  if (!Array.isArray(data)) {
    return [];
  }
  return data.filter((item) => item && typeof item === 'object');
}

async function deleteEventsRequest(type) {
  const query = new URLSearchParams();
  if (type) {
    query.set('type', type);
  }
  const endpoint = query.size > 0 ? `/api/events?${query.toString()}` : '/api/events';
  const res = await fetch(endpoint, { method: 'DELETE' });
  if (!res.ok) {
    throw new Error(`failed to delete logs (${res.status})`);
  }
  const data = await res.json();
  return {
    removed: Number(data.removed || 0),
    remaining: Number(data.remaining || 0),
  };
}

function renderShell() {
  renderStatus();
  updateTabButtons();
  updatePanelsVisibility();
  updateLoadMoreButtons();
}

function renderStatus() {
  if (!refs.status) {
    return;
  }
  const tabState = state.tabs[state.activeTab];
  const parts = [
    `tab: ${state.activeTab}`,
    `events: ${tabState.events.length}`,
    `auto: ${state.autoRefresh ? 'on' : 'off'}`,
  ];
  if (tabState.loading) {
    parts.push('loading');
  } else if (tabState.loadingMore) {
    parts.push('loading older');
  }
  if (state.isDeleting) {
    parts.push('deleting');
  }
  if (tabState.error) {
    parts.push(`error: ${tabState.error}`);
  }
  if (state.notice) {
    parts.push(state.notice);
  }
  refs.status.textContent = parts.join(' | ');
}

function updateTabButtons() {
  if (!refs.tabs) {
    return;
  }
  const buttons = refs.tabs.querySelectorAll('.tab');
  buttons.forEach((button) => {
    if (!(button instanceof HTMLElement)) {
      return;
    }
    const tab = button.dataset.tab;
    if (tab === state.activeTab) {
      button.classList.add('is-active');
    } else {
      button.classList.remove('is-active');
    }
  });
}

function updatePanelsVisibility() {
  Object.keys(refs.panels).forEach((tab) => {
    const panel = refs.panels[tab];
    if (!panel) {
      return;
    }
    if (tab === state.activeTab) {
      panel.classList.add('is-active');
    } else {
      panel.classList.remove('is-active');
    }
  });
}

function updateLoadMoreButtons() {
  setButtonState(refs.overviewLoadMore, state.tabs.overview);
  setButtonState(refs.errorsLoadMore, state.tabs.errors);
  setButtonState(refs.consoleLoadMore, state.tabs.console);
  setButtonState(refs.networkLoadMore, state.tabs.network);
  const active = state.tabs[state.activeTab];
  const disabled = active.loading || active.loadingMore || state.isDeleting;
  if (refs.clearCurrent) {
    refs.clearCurrent.disabled = disabled;
  }
  if (refs.clearAll) {
    refs.clearAll.disabled = disabled;
  }
}

function setButtonState(button, tabState) {
  if (!button) {
    return;
  }
  button.disabled = tabState.loading || tabState.loadingMore || !tabState.hasMore;
}

function renderActivePanel() {
  if (state.activeTab === 'overview') {
    renderOverviewPanel();
    return;
  }
  if (state.activeTab === 'errors') {
    renderSimplePanel('errors', refs.errorsList, 'No error events yet.');
    return;
  }
  if (state.activeTab === 'console') {
    renderSimplePanel('console', refs.consoleList, 'No console events yet.');
    return;
  }
  renderNetworkPanel();
}

function renderOverviewPanel() {
  const events = state.tabs.overview.events;
  renderStats(events);
  renderSimpleList(refs.overviewList, events, 'No events yet.');
}

function renderStats(events) {
  if (!refs.overviewStats) {
    return;
  }
  const total = events.length;
  const errors = events.filter((event) => event.type === 'error' || event.type === 'promise_rejection').length;
  const consoleCount = events.filter((event) => event.type === 'console').length;
  const network = events.filter((event) => event.type === 'network').length;

  refs.overviewStats.innerHTML = '';
  const cards = [
    { label: 'Total', value: total },
    { label: 'Errors', value: errors },
    { label: 'Console', value: consoleCount },
    { label: 'Network', value: network },
  ];

  cards.forEach((item) => {
    const card = document.createElement('article');
    card.className = 'stat';

    const label = document.createElement('div');
    label.className = 'stat-label';
    label.textContent = item.label;

    const value = document.createElement('div');
    value.className = 'stat-value';
    value.textContent = String(item.value);

    card.appendChild(label);
    card.appendChild(value);
    refs.overviewStats.appendChild(card);
  });
}

function renderSimplePanel(tab, listNode, emptyText) {
  renderSimpleList(listNode, state.tabs[tab].events, emptyText);
}

function renderSimpleList(listNode, events, emptyText) {
  if (!listNode) {
    return;
  }
  listNode.innerHTML = '';
  if (!events.length) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = emptyText;
    listNode.appendChild(empty);
    return;
  }

  const maxItems = Math.min(events.length, 140);
  for (let i = 0; i < maxItems; i += 1) {
    const event = events[i];
    const item = document.createElement('li');
    item.className = 'simple-item';

    const header = document.createElement('div');
    header.className = 'simple-item-header';

    header.appendChild(createPill('pill pill-type', String(event.type || 'unknown')));

    const severityClass = getSeverityClass(event.severity);
    header.appendChild(createPill(`pill pill-severity ${severityClass}`, String(event.severity || 'info')));

    const time = document.createElement('span');
    time.className = 'simple-time';
    time.textContent = formatTime(getEventCursor(event));
    header.appendChild(time);

    const message = document.createElement('div');
    message.className = 'simple-message';
    message.textContent = getEventMessage(event);

    item.appendChild(header);
    item.appendChild(message);
    listNode.appendChild(item);
  }
}

function createPill(className, text) {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  return span;
}

function renderNetworkPanel() {
  const tabState = state.tabs.network;
  const events = tabState.events;

  if (events.length === 0) {
    state.selectedNetworkId = null;
    if (refs.networkRows) {
      refs.networkRows.innerHTML = '';
    }
    if (refs.networkSpacer) {
      refs.networkSpacer.style.height = '0px';
    }
    renderNetworkDetail(null);
    return;
  }

  ensureSelectedNetwork();
  renderNetworkRows();
  renderNetworkDetail(findEventById('network', state.selectedNetworkId));
}

function renderNetworkRows() {
  const tabState = state.tabs.network;
  const events = tabState.events;
  if (!refs.networkViewport || !refs.networkSpacer || !refs.networkRows) {
    return;
  }

  const total = events.length;
  refs.networkSpacer.style.height = `${total * NETWORK_ROW_HEIGHT}px`;
  const viewportHeight = refs.networkViewport.clientHeight || 520;
  const scrollTop = refs.networkViewport.scrollTop || 0;
  const start = Math.max(Math.floor(scrollTop / NETWORK_ROW_HEIGHT) - NETWORK_OVERSCAN, 0);
  const visibleCount = Math.ceil(viewportHeight / NETWORK_ROW_HEIGHT) + NETWORK_OVERSCAN * 2;
  const end = Math.min(start + visibleCount, total);

  refs.networkRows.innerHTML = '';
  for (let i = start; i < end; i += 1) {
    const event = events[i];
    const payload = getPayload(event);
    const method = String(payload.method || 'GET').toUpperCase();
    const url = String(payload.url || event.message || '(unknown)');
    const status = payload.status !== undefined ? String(payload.status) : '-';
    const duration = payload.durationMs !== undefined ? `${payload.durationMs} ms` : '-';
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'network-row-item';
    if (String(event.id) === String(state.selectedNetworkId)) {
      row.classList.add('is-selected');
    }
    row.dataset.eventId = String(event.id);
    row.style.transform = `translateY(${i * NETWORK_ROW_HEIGHT}px)`;

    row.innerHTML = `
      <div class="network-row-top">
        <span class="pill pill-type">${escapeHtml(method)}</span>
        <span class="pill pill-severity ${getStatusClass(payload.status)}">${escapeHtml(status)}</span>
      </div>
      <div class="network-url" title="${escapeHtml(url)}">${escapeHtml(url)}</div>
      <div class="network-meta">
        <span>${escapeHtml(duration)}</span>
        <span>${escapeHtml(formatTime(getEventCursor(event)))}</span>
      </div>
    `;
    refs.networkRows.appendChild(row);
  }
}

function renderNetworkDetail(event) {
  if (!refs.networkDetail) {
    return;
  }
  refs.networkDetail.innerHTML = '';

  if (!event) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Select a network event to inspect request and response details.';
    refs.networkDetail.appendChild(empty);
    return;
  }

  const payload = getPayload(event);
  const title = document.createElement('h2');
  title.className = 'network-detail-title';
  title.textContent = getEventMessage(event);
  refs.networkDetail.appendChild(title);

  const metaGrid = document.createElement('div');
  metaGrid.className = 'network-grid';
  appendMetaRow(metaGrid, 'Method', payload.method);
  appendMetaRow(metaGrid, 'URL', payload.url);
  appendMetaRow(metaGrid, 'Status', payload.status);
  appendMetaRow(metaGrid, 'Duration', payload.durationMs != null ? `${payload.durationMs} ms` : undefined);
  appendMetaRow(metaGrid, 'When', formatTime(getEventCursor(event)));
  appendMetaRow(metaGrid, 'Error', payload.error);
  refs.networkDetail.appendChild(metaGrid);

  appendDataBlock(refs.networkDetail, 'Request Headers', payload.requestHeaders);
  appendDataBlock(
    refs.networkDetail,
    payload.requestBodyTruncated ? 'Request Body (truncated)' : 'Request Body',
    payload.requestBody
  );
  appendDataBlock(refs.networkDetail, 'Response Headers', payload.responseHeaders);
  appendDataBlock(
    refs.networkDetail,
    payload.responseBodyTruncated ? 'Response Body (truncated)' : 'Response Body',
    payload.responseBody
  );
}

function appendMetaRow(container, label, value) {
  if (value === undefined || value === null || value === '') {
    return;
  }
  const row = document.createElement('div');
  row.className = 'network-row';

  const key = document.createElement('span');
  key.className = 'network-key';
  key.textContent = label;

  const val = document.createElement('span');
  val.className = 'network-value';
  val.textContent = toText(value);

  row.appendChild(key);
  row.appendChild(val);
  container.appendChild(row);
}

function appendDataBlock(container, title, value) {
  if (value === undefined || value === null || value === '') {
    return;
  }
  const block = document.createElement('section');
  block.className = 'network-block';

  const heading = document.createElement('p');
  heading.className = 'network-block-title';
  heading.textContent = title;

  const pre = document.createElement('pre');
  pre.className = 'network-pre';
  pre.textContent = toPrettyText(value);

  block.appendChild(heading);
  block.appendChild(pre);
  container.appendChild(block);
}

function ensureSelectedNetwork() {
  const events = state.tabs.network.events;
  if (!events.length) {
    state.selectedNetworkId = null;
    return;
  }
  if (!state.selectedNetworkId || !findEventById('network', state.selectedNetworkId)) {
    state.selectedNetworkId = String(events[0].id);
  }
}

function findEventById(tab, id) {
  if (!id) {
    return null;
  }
  return state.tabs[tab].events.find((event) => String(event.id) === String(id)) || null;
}

function getTypeFilterForTab(tab) {
  const cfg = TAB_CONFIG[tab];
  if (!cfg || !cfg.type) {
    return null;
  }
  return cfg.type;
}

function applyDeleteToLocalState(typeFilter) {
  if (!typeFilter) {
    Object.keys(state.tabs).forEach((tab) => {
      state.tabs[tab].events = [];
      state.tabs[tab].hasMore = true;
      state.tabs[tab].loadingMore = false;
    });
    state.selectedNetworkId = null;
    return;
  }

  const typeSet = toTypeSet(typeFilter);
  Object.keys(state.tabs).forEach((tab) => {
    const tabState = state.tabs[tab];
    tabState.events = tabState.events.filter((event) => !typeSet.has(String(event.type || '')));
    tabState.hasMore = true;
  });
  ensureSelectedNetwork();
}

function getEventCursor(event) {
  if (!event || typeof event !== 'object') {
    return null;
  }
  if (typeof event.receivedAt === 'string') {
    return event.receivedAt;
  }
  if (typeof event.occurredAt === 'string') {
    return event.occurredAt;
  }
  return null;
}

function getEventMessage(event) {
  if (event.type === 'network') {
    const payload = getPayload(event);
    const method = payload.method ? String(payload.method).toUpperCase() : 'REQ';
    const url = payload.url ? String(payload.url) : String(event.message || '(unknown)');
    return `${method} ${url}`;
  }
  return String(event.message || '(no message)');
}

function getPayload(event) {
  if (!event || typeof event !== 'object' || !event.payload || typeof event.payload !== 'object') {
    return {};
  }
  return event.payload;
}

function sortEvents(events) {
  return events.sort((a, b) => toEpoch(getEventCursor(b)) - toEpoch(getEventCursor(a)));
}

function uniqueById(events) {
  const seen = new Set();
  const out = [];
  for (const event of events) {
    const id = String(event.id ?? '');
    const key = id || `${event.type ?? ''}|${event.message ?? ''}|${getEventCursor(event) ?? ''}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(event);
  }
  return out;
}

function toTypeSet(value) {
  return new Set(
    String(value)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function toEpoch(value) {
  if (!value) {
    return 0;
  }
  const ts = Date.parse(String(value));
  return Number.isFinite(ts) ? ts : 0;
}

function formatTime(value) {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleString();
}

function getSeverityClass(severity) {
  if (!severity) {
    return '';
  }
  const normalized = String(severity).toLowerCase();
  if (normalized === 'warning' || normalized === 'warn') {
    return 'is-warning';
  }
  if (normalized === 'error' || normalized === 'fatal') {
    return 'is-error';
  }
  return '';
}

function getStatusClass(status) {
  const code = Number(status);
  if (!Number.isFinite(code)) {
    return '';
  }
  if (code >= 500) {
    return 'is-error';
  }
  if (code >= 400) {
    return 'is-warning';
  }
  return '';
}

function toText(value) {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function toPrettyText(value) {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function asErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
