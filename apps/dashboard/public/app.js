const eventList = document.getElementById('eventList');
const statusNode = document.getElementById('status');
const refreshButton = document.getElementById('refresh');

async function loadEvents() {
  try {
    const res = await fetch('/api/events');
    if (!res.ok) {
      throw new Error(`failed ${res.status}`);
    }
    const events = await res.json();
    statusNode.textContent = `events: ${events.length}`;
    render(events);
  } catch {
    statusNode.textContent = 'agent not ready';
  }
}

function render(events) {
  if (!eventList) return;
  eventList.innerHTML = '';

  if (!Array.isArray(events) || events.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = 'No events yet. Trigger a console error or network request in your app.';
    eventList.appendChild(empty);
    return;
  }

  events.forEach((event) => {
    const item = document.createElement('li');
    item.className = `event-card event-${event.type || 'unknown'}`;

    const header = document.createElement('div');
    header.className = 'event-header';

    const when = document.createElement('span');
    when.className = 'event-time';
    when.textContent = formatTime(event.occurredAt || event.receivedAt);
    header.appendChild(when);

    const type = document.createElement('span');
    type.className = 'event-type';
    type.textContent = String(event.type || 'unknown');
    header.appendChild(type);

    const severity = document.createElement('span');
    severity.className = 'event-severity';
    severity.textContent = String(event.severity || 'info');
    header.appendChild(severity);

    const message = document.createElement('div');
    message.className = 'event-message';
    message.textContent = String(event.message || '(no message)');

    item.appendChild(header);
    item.appendChild(message);

    const networkDetails = createNetworkDetails(event);
    if (networkDetails) {
      item.appendChild(networkDetails);
    }

    eventList.appendChild(item);
  });
}

function createNetworkDetails(event) {
  if (!event || event.type !== 'network' || !event.payload || typeof event.payload !== 'object') {
    return null;
  }

  const payload = event.payload;
  const details = document.createElement('details');
  details.className = 'network-details';

  const summary = document.createElement('summary');
  summary.textContent = 'Network Details';
  details.appendChild(summary);

  const grid = document.createElement('div');
  grid.className = 'network-grid';
  appendMetaRow(grid, 'Method', payload.method);
  appendMetaRow(grid, 'URL', payload.url);
  appendMetaRow(grid, 'Status', payload.status);
  appendMetaRow(grid, 'Duration', payload.durationMs != null ? `${payload.durationMs} ms` : undefined);
  appendMetaRow(grid, 'Error', payload.error);
  details.appendChild(grid);

  const reqHeaders = createDataBlock('Request Headers', payload.requestHeaders);
  if (reqHeaders) details.appendChild(reqHeaders);

  const reqBody = createDataBlock(
    payload.requestBodyTruncated ? 'Request Body (truncated)' : 'Request Body',
    payload.requestBody
  );
  if (reqBody) details.appendChild(reqBody);

  const resHeaders = createDataBlock('Response Headers', payload.responseHeaders);
  if (resHeaders) details.appendChild(resHeaders);

  const resBody = createDataBlock(
    payload.responseBodyTruncated ? 'Response Body (truncated)' : 'Response Body',
    payload.responseBody
  );
  if (resBody) details.appendChild(resBody);

  return details;
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

function createDataBlock(title, value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const wrapper = document.createElement('div');
  wrapper.className = 'network-block';

  const heading = document.createElement('p');
  heading.className = 'network-block-title';
  heading.textContent = title;

  const pre = document.createElement('pre');
  pre.className = 'network-pre';
  pre.textContent = toPrettyText(value);

  wrapper.appendChild(heading);
  wrapper.appendChild(pre);
  return wrapper;
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

if (refreshButton) {
  refreshButton.addEventListener('click', loadEvents);
}

loadEvents();
setInterval(loadEvents, 3000);
