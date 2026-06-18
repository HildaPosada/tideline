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
const ALLOWED_MODES = [MODE_AUTO, MODE_NEXT, MODE_MONTH];
const CACHE_TTL_MS = 90 * 1000;
let currentRangeMode = MODE_AUTO;
let lastAutoResolvedMode = '';
let latestLoadToken = 0;
const eventsCache = new Map();
const PERSON_ORDER = ['hp', 'kim'];
let viewedMonthCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

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

function simplifyEventTitle(rawTitle) {
  if (!rawTitle) return 'Untitled';

  let title = String(rawTitle).replace(/\s+/g, ' ').trim();

  // Remove leading emoji/symbol clutter often present in calendar names.
  title = title.replace(/^[^\p{L}\p{N}]+/u, '').trim();

  // Google invite titles can include verbose participant tails after pipes.
  if (title.includes('|')) {
    const [head] = title.split('|');
    if (head && head.trim().length >= 4) title = head.trim();
  }

  // Common "topic - attendee names" pattern: keep the topic segment.
  if (title.includes(' - ')) {
    const [head] = title.split(' - ');
    if (head && head.trim().length >= 4) title = head.trim();
  }

  return title || 'Untitled';
}

function shortenText(str, maxLen) {
  if (str.length <= maxLen) return str;
  return `${str.slice(0, Math.max(0, maxLen - 1)).trim()}…`;
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

function formatMonthYear(date) {
  return `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
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

function renderLegend(events, calendars = []) {
  const people = new Map();

  for (const calendar of calendars) {
    people.set(calendar.id, { label: calendar.label, color: calendar.color, configured: calendar.configured !== false });
  }

  for (const ev of events) {
    if (!people.has(ev.person)) {
      people.set(ev.person, { label: ev.label, color: ev.color, configured: true });
    }
  }

  const eventCounts = new Map();
  for (const ev of events) {
    eventCounts.set(ev.person, (eventCounts.get(ev.person) || 0) + 1);
  }

  if ((eventCounts.get('shared') || 0) > 0 && !people.has('shared')) {
    people.set('shared', { label: 'Shared', color: 'shared', configured: true });
  }

  const legend = document.getElementById('legend');
  legend.innerHTML = '';
  const order = ['hp', 'kim', 'shared'];
  const entries = Array.from(people.entries()).sort((a, b) => {
    const ai = order.indexOf(a[0]);
    const bi = order.indexOf(b[0]);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  for (const [personId, p] of entries) {
    const count = eventCounts.get(personId) || 0;
    const isInactive = personId !== 'shared' && count === 0;
    const item = document.createElement('div');
    item.className = `legend-item${isInactive ? ' is-muted' : ''}`;
    const suffix = personId === 'shared' || !isInactive ? '' : ' (none in this range)';
    item.innerHTML = `<span class="legend-dot ${p.color}"></span><span>${p.label}${suffix}</span>`;
    legend.appendChild(item);
  }
}

function readSavedRangeMode() {
  try {
    const raw = localStorage.getItem(RANGE_MODE_STORAGE_KEY);
    if (raw === MODE_TODAY) return MODE_AUTO;
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

function getMonthWindowFor(startDate) {
  const start = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  const monthEnd = new Date(start.getFullYear(), start.getMonth() + 1, 0);
  monthEnd.setHours(23, 59, 59, 999);

  const diffMs = monthEnd.getTime() - start.getTime();
  const days = Math.max(0, Math.min(31, Math.ceil(diffMs / 86400000)));

  return {
    start,
    days,
    startKey: toDayKey(start),
  };
}

function getRequestForMode(mode) {
  if (mode === MODE_MONTH) {
    const monthWindow = getMonthWindowFor(viewedMonthCursor);
    return {
      days: monthWindow.days,
      start: monthWindow.startKey,
      key: `month:${monthWindow.startKey}:${monthWindow.days}`,
    };
  }

  const days = resolveDaysForMode(mode);
  return {
    days,
    start: null,
    key: `rolling:${days}`,
  };
}

function getCurrentMonthRequest() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthWindow = getMonthWindowFor(monthStart);
  return {
    days: monthWindow.days,
    start: monthWindow.startKey,
    key: `month:${monthWindow.startKey}:${monthWindow.days}`,
  };
}

function resolveDaysForMode(mode) {
  if (mode === MODE_AUTO) {
    return resolveDaysForMode(getAutoResolvedMode());
  }
  if (mode === MODE_TODAY) return 0;
  if (mode === MODE_MONTH) return getMonthWindowFor(viewedMonthCursor).days;
  return 3;
}

function modeTitle(mode) {
  if (mode === MODE_AUTO) {
    return getAutoResolvedMode() === MODE_TODAY ? 'Auto (Today)' : 'Auto (Next 3 days)';
  }
  if (mode === MODE_TODAY) return 'Today';
  if (mode === MODE_MONTH) return formatMonthYear(viewedMonthCursor);
  return 'Next 3 days';
}

function busyLevel(count) {
  if (count >= 3) return 'busy';
  if (count >= 1) return 'medium';
  return 'free';
}

function busyColor(level) {
  if (level === 'busy') return 'var(--busy-high)';
  if (level === 'medium') return 'var(--busy-medium)';
  return 'var(--busy-free)';
}

function toDayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function countPeopleForEvent(ev) {
  if (Array.isArray(ev.people) && ev.people.length > 0) {
    return ev.people.filter((p) => PERSON_ORDER.indexOf(p) !== -1);
  }
  if (PERSON_ORDER.indexOf(ev.person) !== -1) return [ev.person];
  if (ev.person === 'shared') return PERSON_ORDER.slice();
  return [];
}

function buildDailyBusyMap(events, year, month) {
  const byDay = new Map();

  for (const ev of events) {
    const d = new Date(ev.start);
    if (d.getFullYear() !== year || d.getMonth() !== month) continue;
    const key = toDayKey(d);
    if (!byDay.has(key)) byDay.set(key, { hp: 0, kim: 0 });
    const bucket = byDay.get(key);

    const people = countPeopleForEvent(ev);
    for (const person of people) {
      bucket[person] = (bucket[person] || 0) + 1;
    }
  }

  return byDay;
}

function renderHeroAvailabilityCalendar(events) {
  const card = document.getElementById('heroCalendarCard');
  const grid = document.getElementById('heroCalendarGrid');
  const title = document.getElementById('heroCalendarTitle');
  if (!card || !grid || !title) return;

  if (currentRangeMode !== MODE_AUTO) {
    card.classList.add('is-hidden');
    return;
  }

  card.classList.remove('is-hidden');

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const todayKey = toDayKey(now);
  title.textContent = `${MONTH_NAMES[month]} Availability`;

  const firstDay = new Date(year, month, 1);
  const leading = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const busyByDay = buildDailyBusyMap(events, year, month);

  grid.innerHTML = '';
  let dayNumber = 1;

  for (let i = 0; i < 42; i += 1) {
    const cell = document.createElement('div');
    cell.className = 'hero-cal-cell';

    const isEmpty = i < leading || dayNumber > daysInMonth;
    if (isEmpty) {
      cell.classList.add('is-empty');
      grid.appendChild(cell);
      continue;
    }

    const date = new Date(year, month, dayNumber);
    const key = toDayKey(date);
    if (key === todayKey) cell.classList.add('is-today');

    const counts = busyByDay.get(key) || { hp: 0, kim: 0 };
    const hpLevel = busyLevel(counts.hp);
    const kimLevel = busyLevel(counts.kim);

    const fill = document.createElement('div');
    fill.className = 'hero-cal-fill';
    fill.style.background = `linear-gradient(to right, ${busyColor(hpLevel)} 0 50%, ${busyColor(kimLevel)} 50% 100%)`;
    cell.appendChild(fill);

    const num = document.createElement('span');
    num.className = 'hero-cal-day';
    num.textContent = String(dayNumber);
    cell.appendChild(num);

    const hpText = hpLevel[0].toUpperCase() + hpLevel.slice(1);
    const kimText = kimLevel[0].toUpperCase() + kimLevel.slice(1);
    cell.title = `Hp: ${hpText} (${counts.hp}) | Kim: ${kimText} (${counts.kim})`;

    grid.appendChild(cell);
    dayNumber += 1;
  }
}

function applyRangeSelection(mode) {
  currentRangeMode = mode;

  const autoBtn = document.getElementById('rangeAuto');
  const nextBtn = document.getElementById('rangeNext');
  const monthBtn = document.getElementById('rangeMonth');
  const heroCalendarCard = document.getElementById('heroCalendarCard');

  autoBtn.classList.toggle('is-active', mode === MODE_AUTO);
  nextBtn.classList.toggle('is-active', mode === MODE_NEXT);
  monthBtn.classList.toggle('is-active', mode === MODE_MONTH);

  const agenda = document.querySelector('.agenda');
  agenda.classList.toggle('is-month', mode === MODE_MONTH);
  if (heroCalendarCard) {
    heroCalendarCard.classList.toggle('is-hidden', mode !== MODE_AUTO);
  }

  autoBtn.setAttribute('aria-pressed', mode === MODE_AUTO ? 'true' : 'false');
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
      const cleanTitle = simplifyEventTitle(ev.title);
      const locationPart = ev.location ? `<div class="event-location">${escapeHtml(ev.location)}</div>` : '';
      const row = document.createElement('div');
      row.className = `event-row person-${ev.person}`;
      row.innerHTML = `
        <span class="event-time">${formatTime(ev.start, ev.allDay)}</span>
        <span class="event-main">
          <span class="event-title" title="${escapeHtml(ev.title)}">${escapeHtml(cleanTitle)}</span>
          ${locationPart}
        </span>
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
  const year = viewedMonthCursor.getFullYear();
  const month = viewedMonthCursor.getMonth();
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

  const header = document.createElement('div');
  header.className = 'month-board-header';

  const monthTitle = document.createElement('h3');
  monthTitle.className = 'month-board-title';
  monthTitle.textContent = formatMonthYear(viewedMonthCursor);

  const nav = document.createElement('div');
  nav.className = 'month-board-nav';

  const prevBtn = document.createElement('button');
  prevBtn.className = 'month-nav-btn';
  prevBtn.type = 'button';
  prevBtn.setAttribute('aria-label', 'Previous month');
  prevBtn.textContent = '<';

  const nextBtn = document.createElement('button');
  nextBtn.className = 'month-nav-btn';
  nextBtn.type = 'button';
  nextBtn.setAttribute('aria-label', 'Next month');
  nextBtn.textContent = '>';

  prevBtn.addEventListener('click', async () => {
    viewedMonthCursor = new Date(viewedMonthCursor.getFullYear(), viewedMonthCursor.getMonth() - 1, 1);
    applyRangeSelection(MODE_MONTH);
    await loadEvents({ preferCache: true, forceFresh: false });
    prefetchMode(MODE_MONTH);
  });

  nextBtn.addEventListener('click', async () => {
    viewedMonthCursor = new Date(viewedMonthCursor.getFullYear(), viewedMonthCursor.getMonth() + 1, 1);
    applyRangeSelection(MODE_MONTH);
    await loadEvents({ preferCache: true, forceFresh: false });
    prefetchMode(MODE_MONTH);
  });

  nav.appendChild(prevBtn);
  nav.appendChild(nextBtn);
  header.appendChild(monthTitle);
  header.appendChild(nav);
  board.appendChild(header);

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
      const cleanTitle = shortenText(simplifyEventTitle(ev.title), 20);
      const chip = document.createElement('div');
      chip.className = `month-chip person-${ev.person}`;
      chip.textContent = ev.allDay
        ? `${ev.label}: ${cleanTitle}`
        : `${formatTime(ev.start, false)} ${cleanTitle}`;
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

function setCache(requestKey, data) {
  eventsCache.set(requestKey, {
    at: Date.now(),
    data,
  });
}

function getCache(requestKey) {
  return eventsCache.get(requestKey) || null;
}

function isCacheFresh(cacheEntry) {
  return !!cacheEntry && Date.now() - cacheEntry.at < CACHE_TTL_MS;
}

function renderEventsForCurrentMode(events, calendars) {
  renderLegend(events, calendars);
  const currentMonthRequest = getCurrentMonthRequest();
  const monthCached = getCache(currentMonthRequest.key);
  const availabilityEvents = currentRangeMode === MODE_AUTO && monthCached
    ? monthCached.data.events
    : events;
  renderHeroAvailabilityCalendar(availabilityEvents);
  if (currentRangeMode === MODE_MONTH) {
    renderMonthBoard(events);
  } else {
    renderAgenda(events);
  }
}

function updateStatusFromGeneratedAt(generatedAt) {
  const statusLine = document.getElementById('statusLine');
  const syncedAt = new Date(generatedAt);
  statusLine.textContent = `Updated ${formatTime(syncedAt.toISOString(), false)} · ${modeTitle(currentRangeMode)}`;
}

async function fetchEventsFromApi(request) {
  const params = new URLSearchParams();
  params.set('days', String(request.days));
  if (request.start) params.set('start', request.start);

  const res = await fetch(`/api/events?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`Request failed with status ${res.status}`);
  }
  return res.json();
}

async function prefetchMode(mode) {
  const request = getRequestForMode(mode);
  const cached = getCache(request.key);
  if (isCacheFresh(cached)) return;

  try {
    const data = await fetchEventsFromApi(request);
    setCache(request.key, data);

    if (mode === MODE_MONTH && currentRangeMode === MODE_AUTO) {
      renderHeroAvailabilityCalendar(data.events);
    }
  } catch (err) {
    // Prefetch is best-effort and should not affect visible UI.
  }
}

async function prefetchOtherModes() {
  const modes = [MODE_AUTO, MODE_NEXT, MODE_MONTH];
  await Promise.all(
    modes
      .filter((mode) => mode !== currentRangeMode)
      .map((mode) => prefetchMode(mode))
  );
}

async function loadEvents(options = {}) {
  const { preferCache = true, forceFresh = false } = options;
  const statusLine = document.getElementById('statusLine');
  const loadToken = ++latestLoadToken;
  const request = getRequestForMode(currentRangeMode);

  const cached = getCache(request.key);

  try {
    if (preferCache && cached) {
      renderEventsForCurrentMode(cached.data.events, cached.data.calendars || []);
      updateStatusFromGeneratedAt(cached.data.generatedAt);

      if (!forceFresh && isCacheFresh(cached)) {
        return;
      }
    } else {
      statusLine.textContent = 'Syncing...';
    }

    const data = await fetchEventsFromApi(request);
    setCache(request.key, data);

    if (loadToken !== latestLoadToken) return;

    if (data.errors && data.errors.length > 0) {
      console.warn('Calendar feed warnings:', data.errors);
    }

    renderEventsForCurrentMode(data.events, data.calendars || []);
    updateStatusFromGeneratedAt(data.generatedAt);
  } catch (err) {
    if (loadToken !== latestLoadToken) return;
    console.error('Failed to load events', err);
    if (cached) {
      statusLine.textContent = `Offline copy · ${modeTitle(currentRangeMode)}`;
      return;
    }
    statusLine.textContent = 'Connection trouble — retrying soon';
  }
}

function init() {
  const savedRangeMode = readSavedRangeMode();
  lastAutoResolvedMode = getAutoResolvedMode();
  applyRangeSelection(savedRangeMode);
  wireRangeToggle();

  renderClockAndDate();
  loadEvents({ preferCache: true, forceFresh: true });
  prefetchOtherModes();

  setInterval(() => {
    renderClockAndDate();
    maybeRefreshAutoModeTitle();
  }, 30000); // refresh clock every 30s and update auto mode when time window shifts
  setInterval(() => {
    loadEvents({ preferCache: true, forceFresh: true });
    prefetchOtherModes();
  }, 5 * 60000); // refresh calendar data every 5 min
}

init();
