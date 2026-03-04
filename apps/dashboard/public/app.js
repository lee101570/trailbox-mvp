const eventList = document.getElementById('eventList');
const statusNode = document.getElementById('status');
const refreshButton = document.getElementById('refresh');

async function loadEvents() {
  try {
    const res = await fetch('/api/events');
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
  events.forEach((event) => {
    const item = document.createElement('li');
    item.textContent = `${event.occurredAt} [${event.type}] ${event.message}`;
    eventList.appendChild(item);
  });
}

if (refreshButton) {
  refreshButton.addEventListener('click', loadEvents);
}

loadEvents();
setInterval(loadEvents, 3000);

