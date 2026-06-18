// Tideline — frontend logic
// Fetches merged events from /api/events and renders the hero + agenda.

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const RANGE_MODE_STORAGE_KEY = 'tidelineRangeMode';
const MODE_AUTO = 'auto';
const MODE_TODAY = 'today';
const MODE_NEXT = 'next';
const MODE_MONTH = 'month';
const ALLOWED_MODES = [MODE_AUTO, MODE_TODAY, MODE_NEXT, MODE_MONTH];
let currentRangeMode = MODE_AUTO;
let lastAutoResolvedMode = '';

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

function readSavedRangeMode() {
  try {
    const raw = localStorage.getItem(RANGE_MODE_STORAGE_KEY);
    if (ALLOWED_MODES.indexOf(raw) !== -1) return raw;
  } catch (err) {
    // localStorage may be blocked in hardened browser setups; default safely.
  }
  return MODE_AUTO;
}

function getAutoResolvedMode() {
  const now = new Date();
  const hour = now.getHours();

  // Daytime emphasizes immediate schedule; evenings show a broader horizon.
  return hour >= 6 && hour < 18 ? MODE_TODAY : MODE_NEXT;
}

function getMonthFetchDays() {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  monthEnd.setHours(23, 59, 59, 999);

  const diffMs = monthEnd.getTime() - start.getTime();
  return Math.max(0, Math.min(31, Math.ceil(diffMs / 86400000)));
}

function resolveDaysForMode(mode) {
  if (mode === MODE_AUTO) {
    return resolveDaysForMode(getAutoResolvedMode());
  }
  if (mode === MODE_TODAY) return 0;
  if (mode === MODE_MONTH) return getMonthFetchDays();
  return 3;
}

function modeTitle(mode) {
  if (mode === MODE_AUTO) {
    return getAutoResolvedMode() === MODE_TODAY ? 'Auto (Today)' : 'Auto (Next 3 days)';
  }
  if (mode === MODE_TODAY) return 'Today';
  if (mode === MODE_MONTH) return 'Month';
  return 'Next 3 days';
}

function applyRangeSelection(mode) {
  currentRangeMode = mode;

  const autoBtn = document.getElementById('rangeAuto');
  const todayBtn = document.getElementById('rangeToday');
  const nextBtn = document.getElementById('rangeNext');
  const monthBtn = document.getElementById('rangeMonth');

  autoBtn.classList.toggle('is-active', mode === MODE_AUTO);
  todayBtn.classList.toggle('is-active', mode === MODE_TODAY);
  nextBtn.classList.toggle('is-active', mode === MODE_NEXT);
  monthBtn.classList.toggle('is-active', mode === MODE_MONTH);

  const agenda = document.querySelector('.agenda');
  agenda.classList.toggle('is-month', mode === MODE_MONTH);

  autoBtn.setAttribute('aria-pressed', mode === MODE_AUTO ? 'true' : 'false');
  todayBtn.setAttribute('aria-pressed', mode === MODE_TODAY ? 'true' : 'false');
  nextBtn.setAttribute('aria-pressed', mode === MODE_NEXT ? 'true' : 'false');
  monthBtn.setAttribute('aria-pressed', mode === MODE_MONTH ? 'true' : 'false');

  document.querySelector('.agenda-title').textContent = modeTitle(mode);

  try {
    localStorage.setItem(RANGE_MODE_STORAGE_KEY, mode);
  } catch (err) {
    // Ignore storage write failures and keep using in-memory state.
  }
}

function wireRangeToggle() {
  const buttons = document.querySelectorAll('.range-btn');
  for (const btn of buttons) {
    btn.addEventListener('click', async () => {
      const nextMode = btn.getAttribute('data-range-mode');
      if (nextMode === currentRangeMode || ALLOWED_MODES.indexOf(nextMode) === -1) return;
      applyRangeSelection(nextMode);
      await loadEvents();
    });
  }
}

function maybeRefreshAutoModeTitle() {
  if (currentRangeMode !== MODE_AUTO) return;
  const resolved = getAutoResolvedMode();
  if (resolved === lastAutoResolvedMode) return;

  lastAutoResolvedMode = resolved;
  applyRangeSelection(MODE_AUTO);
  loadEvents();
}

function renderAgenda(events) {
  const wrap = document.getElementById('tideline');
  wrap.innerHTML = '';

  if (events.length === 0) {
    const days = resolveDaysForMode(currentRangeMode);
    const message = days === 0
      ? 'Nothing scheduled today. Enjoy the breathing room.'
      : days >= 30
        ? 'The month ahead looks light. Enjoy the quiet tide.'
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

function toLocalDayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function renderMonthBoard(events) {
  const wrap = document.getElementById('tideline');
  wrap.innerHTML = '';

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const todayKey = toLocalDayKey(now);

  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingEmpty = firstDay.getDay();

  const monthEvents = new Map();
  for (const ev of events) {
    const d = new Date(ev.start);
    if (d.getFullYear() !== year || d.getMonth() !== month) continue;
    const key = toLocalDayKey(d);
    if (!monthEvents.has(key)) monthEvents.set(key, []);
    monthEvents.get(key).push(ev);
  }

  const board = document.createElement('section');
  board.className = 'month-board';

  const weekdays = document.createElement('div');
  weekdays.className = 'month-weekdays';
  for (const day of WEEKDAY_SHORT) {
    const item = document.createElement('div');
    item.className = 'month-weekday';
    item.textContent = day;
    weekdays.appendChild(item);
  }
  board.appendChild(weekdays);

  const grid = document.createElement('div');
  grid.className = 'month-grid';

  const totalCells = 42;
  let renderedDay = 1;

  for (let cellIndex = 0; cellIndex < totalCells; cellIndex += 1) {
    const cell = document.createElement('article');
    cell.className = 'month-cell';

    const isOutsideMonth = cellIndex < leadingEmpty || renderedDay > daysInMonth;
    if (isOutsideMonth) {
      cell.classList.add('is-empty');
      grid.appendChild(cell);
      continue;
    }

    const dayDate = new Date(year, month, renderedDay);
    const dayKey = toLocalDayKey(dayDate);
    const dayEvents = monthEvents.get(dayKey) || [];

    if (dayKey === todayKey) cell.classList.add('is-today');
    if (dayDate < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
      cell.classList.add('is-past');
    }

    const number = document.createElement('div');
    number.className = 'month-day-number';
    number.textContent = String(renderedDay);
    cell.appendChild(number);

    const eventsWrap = document.createElement('div');
    eventsWrap.className = 'month-events';

    const maxVisible = 2;
    for (let i = 0; i < Math.min(maxVisible, dayEvents.length); i += 1) {
      const ev = dayEvents[i];
      const chip = document.createElement('div');
      chip.className = `month-chip person-${ev.person}`;
      chip.textContent = ev.allDay
        ? `${ev.label}: ${ev.title}`
        : `${formatTime(ev.start, false)} ${ev.title}`;
      eventsWrap.appendChild(chip);
    }

    if (dayEvents.length > maxVisible) {
      const more = document.createElement('div');
      more.className = 'month-more';
      more.textContent = `+${dayEvents.length - maxVisible} more`;
      eventsWrap.appendChild(more);
    }

    cell.appendChild(eventsWrap);
    grid.appendChild(cell);
    renderedDay += 1;
  }

  board.appendChild(grid);
  wrap.appendChild(board);
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

    const days = resolveDaysForMode(currentRangeMode);
    const res = await fetch(`/api/events?days=${days}`);
    const data = await res.json();

    if (data.errors && data.errors.length > 0) {
      console.warn('Calendar feed warnings:', data.errors);
    }

    renderLegend(data.events);
    if (currentRangeMode === MODE_MONTH) {
      renderMonthBoard(data.events);
    } else {
      renderAgenda(data.events);
    }

    const syncedAt = new Date(data.generatedAt);
    statusLine.textContent = `Updated ${formatTime(syncedAt.toISOString(), false)} · ${modeTitle(currentRangeMode)}`;
  } catch (err) {
    console.error('Failed to load events', err);
    statusLine.textContent = 'Connection trouble — retrying soon';
  }
}

function init() {
  const savedRangeMode = readSavedRangeMode();
  lastAutoResolvedMode = getAutoResolvedMode();
  applyRangeSelection(savedRangeMode);
  wireRangeToggle();

  renderClockAndDate();
  loadEvents();

  setInterval(() => {
    renderClockAndDate();
    maybeRefreshAutoModeTitle();
  }, 30000); // refresh clock every 30s and update auto mode when time window shifts
  setInterval(loadEvents, 5 * 60000); // refresh calendar data every 5 min
}

init();
