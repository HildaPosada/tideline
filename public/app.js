// Tideline — frontend logic
// Fetches merged events from /api/events and renders the hero + agenda.

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const RANGE_STORAGE_KEY = 'tidelineRangeDays';
const ALLOWED_RANGES = [0, 3];
let currentRangeDays = 3;

// Ambient line rotates by day-of-week to keep the wall display feeling alive
// without needing a live weather API. Tulum / coastal wellness register.
const AMBIENT_LINES = [
  'Low tide at dawn, high tide by evening.',
  'A slow start makes for a steady day.',
  'Salt air, soft light, an open afternoon.',
  'The week settles into its own rhythm.',
  'Almost the weekend — ease into it.',
  'Wide open hours, make them count.',
  'A quiet day to rest and reset.',
];

function renderClockAndDate() {
  const now = new Date();
  document.getElementById('dayName').textContent = DAY_NAMES[now.getDay()];
  document.getElementById('dayNumber').textContent = now.getDate();
  document.getElementById('monthYear').textContent = `${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`;
  document.getElementById('ambientLine').textContent = AMBIENT_LINES[now.getDay()];

  const hours = now.getHours();
  const minutes = now.getMinutes().toString().padStart(2, '0');
  const displayHour = ((hours + 11) % 12) + 1;
  const ampm = hours >= 12 ? 'PM' : 'AM';
  document.getElementById('clock').textContent = `${displayHour}:${minutes} ${ampm}`;
}

function formatTime(iso, allDay) {
  if (allDay) return 'All day';
  const d = new Date(iso);
  const hours = d.getHours();
  const minutes = d.getMinutes().toString().padStart(2, '0');
  const displayHour = ((hours + 11) % 12) + 1;
  const ampm = hours >= 12 ? 'PM' : 'AM';
  return `${displayHour}:${minutes} ${ampm}`;
}

function dayLabel(date) {
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);

  const isSameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  if (isSameDay(date, today)) return 'Today';
  if (isSameDay(date, tomorrow)) return 'Tomorrow';
  return `${DAY_NAMES[date.getDay()]}, ${MONTH_NAMES[date.getMonth()]} ${date.getDate()}`;
}

function groupByDay(events) {
  const groups = new Map();
  for (const ev of events) {
    const d = new Date(ev.start);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (!groups.has(key)) groups.set(key, { date: d, events: [] });
    groups.get(key).events.push(ev);
  }
  return Array.from(groups.values()).sort((a, b) => a.date - b.date);
}

function renderLegend(events) {
  const people = new Map();
  for (const ev of events) {
    if (!people.has(ev.person)) people.set(ev.person, { label: ev.label, color: ev.color });
  }
  const legend = document.getElementById('legend');
  legend.innerHTML = '';
  for (const [, p] of people) {
    const item = document.createElement('div');
    item.className = 'legend-item';
    item.innerHTML = `<span class="legend-dot ${p.color}"></span><span>${p.label}</span>`;
    legend.appendChild(item);
  }
}

function readSavedRange() {
  try {
    const raw = localStorage.getItem(RANGE_STORAGE_KEY);
    const parsed = Number(raw);
    if (ALLOWED_RANGES.indexOf(parsed) !== -1) return parsed;
  } catch (err) {
    // localStorage may be blocked in hardened browser setups; default safely.
  }
  return 3;
}

function rangeLabel(days) {
  return days === 0 ? 'Today' : 'Next 3 days';
}

function applyRangeSelection(days) {
  currentRangeDays = days;

  const todayBtn = document.getElementById('rangeToday');
  const nextBtn = document.getElementById('rangeNext');
  const isToday = days === 0;

  todayBtn.classList.toggle('is-active', isToday);
  nextBtn.classList.toggle('is-active', !isToday);
  todayBtn.setAttribute('aria-pressed', isToday ? 'true' : 'false');
  nextBtn.setAttribute('aria-pressed', isToday ? 'false' : 'true');

  document.querySelector('.agenda-title').textContent = rangeLabel(days);

  try {
    localStorage.setItem(RANGE_STORAGE_KEY, String(days));
  } catch (err) {
    // Ignore storage write failures and keep using in-memory state.
  }
}

function wireRangeToggle() {
  const buttons = document.querySelectorAll('.range-btn');
  for (const btn of buttons) {
    btn.addEventListener('click', async () => {
      const nextRange = Number(btn.getAttribute('data-range-days'));
      if (nextRange === currentRangeDays || ALLOWED_RANGES.indexOf(nextRange) === -1) return;
      applyRangeSelection(nextRange);
      await loadEvents();
    });
  }
}

function renderAgenda(events) {
  const wrap = document.getElementById('tideline');
  wrap.innerHTML = '';

  if (events.length === 0) {
    const message = currentRangeDays === 0
      ? 'Nothing scheduled today. Enjoy the breathing room.'
      : 'Nothing on the horizon. Enjoy the quiet.';
    wrap.innerHTML = `<p class="empty-state">${message}</p>`;
    return;
  }

  const groups = groupByDay(events);

  for (const group of groups) {
    const dayDiv = document.createElement('div');
    dayDiv.className = 'day-group';

    const label = document.createElement('div');
    label.className = 'day-group-label';
    label.textContent = dayLabel(group.date);
    dayDiv.appendChild(label);

    for (const ev of group.events) {
      const row = document.createElement('div');
      row.className = `event-row person-${ev.person}`;
      row.innerHTML = `
        <span class="event-time">${formatTime(ev.start, ev.allDay)}</span>
        <span class="event-title">${escapeHtml(ev.title)}${ev.location ? `<span class="event-meta"> · ${escapeHtml(ev.location)}</span>` : ''}</span>
      `;
      dayDiv.appendChild(row);
    }

    wrap.appendChild(dayDiv);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function loadEvents() {
  const statusLine = document.getElementById('statusLine');
  try {
    statusLine.textContent = 'Syncing...';

    const res = await fetch(`/api/events?days=${currentRangeDays}`);
    const data = await res.json();

    if (data.errors && data.errors.length > 0) {
      console.warn('Calendar feed warnings:', data.errors);
    }

    renderLegend(data.events);
    renderAgenda(data.events);

    const syncedAt = new Date(data.generatedAt);
    statusLine.textContent = `Updated ${formatTime(syncedAt.toISOString(), false)} · ${rangeLabel(currentRangeDays)}`;
  } catch (err) {
    console.error('Failed to load events', err);
    statusLine.textContent = 'Connection trouble — retrying soon';
  }
}

function init() {
  const savedRange = readSavedRange();
  applyRangeSelection(savedRange);
  wireRangeToggle();

  renderClockAndDate();
  loadEvents();

  setInterval(renderClockAndDate, 30000); // refresh clock every 30s
  setInterval(loadEvents, 5 * 60000); // refresh calendar data every 5 min
}

init();
