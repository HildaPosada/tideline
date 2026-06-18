const ical = require('node-ical');

// Two named feeds, each with a color identity used by the frontend.
// URLs come from Vercel environment variables, never committed to the repo.
const FEEDS = [
  { id: 'hp', label: process.env.CAL_HP_LABEL || 'Hp', url: process.env.CAL_HP_URL, color: 'clay' },
  { id: 'kim', label: process.env.CAL_KIM_LABEL || 'Kim', url: process.env.CAL_KIM_URL, color: 'teal' },
];

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function parseStartDate(input) {
  if (!input || typeof input !== 'string') return null;
  const match = input.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) return null;

  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}

// Expands a recurring VEVENT into concrete occurrences that fall within [rangeStart, rangeEnd].
function expandOccurrences(vevent, rangeStart, rangeEnd) {
  const occurrences = [];

  if (vevent.rrule) {
    const dates = vevent.rrule.between(rangeStart, rangeEnd, true);
    for (const date of dates) {
      const duration = vevent.end ? vevent.end.getTime() - vevent.start.getTime() : 0;
      occurrences.push({
        start: date,
        end: new Date(date.getTime() + duration),
      });
    }
  } else if (vevent.start && vevent.start >= rangeStart && vevent.start <= rangeEnd) {
    occurrences.push({ start: vevent.start, end: vevent.end || vevent.start });
  }

  return occurrences;
}

function normalizeTitle(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/^\W+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeLocation(location) {
  return String(location || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function mergeDuplicateEvents(events) {
  const mergedByKey = new Map();

  for (const ev of events) {
    const key = [
      ev.start,
      ev.end,
      ev.allDay ? '1' : '0',
      normalizeTitle(ev.title),
      normalizeLocation(ev.location),
    ].join('|');

    const existing = mergedByKey.get(key);
    if (!existing) {
      mergedByKey.set(key, {
        ...ev,
        people: [ev.person],
      });
      continue;
    }

    // If the same event appears on both calendars, collapse to one shared item.
    if (existing.person !== ev.person) {
      existing.people = Array.from(new Set([...(existing.people || []), ev.person]));
      existing.person = 'shared';
      existing.label = 'Shared';
      existing.color = 'shared';
    } else {
      existing.people = Array.from(new Set([...(existing.people || []), ev.person]));
    }
  }

  return Array.from(mergedByKey.values());
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60');

  const requestedDays = Number.parseInt(req.query.days || '3', 10);
  const safeDays = Number.isNaN(requestedDays) ? 3 : requestedDays;
  const daysAhead = Math.max(0, Math.min(safeDays, 31));
  const requestedStart = parseStartDate(req.query.start);
  const rangeStart = startOfDay(requestedStart || new Date());
  const rangeEnd = endOfDay(new Date(rangeStart.getTime() + daysAhead * 86400000));

  const results = [];
  const errors = [];

  await Promise.all(
    FEEDS.map(async (feed) => {
      if (!feed.url) {
        errors.push(`${feed.label}: no calendar URL configured`);
        return;
      }
      try {
        const data = await ical.async.fromURL(feed.url);
        for (const key in data) {
          const item = data[key];
          if (item.type !== 'VEVENT') continue;

          const occurrences = expandOccurrences(item, rangeStart, rangeEnd);
          for (const occ of occurrences) {
            results.push({
              person: feed.id,
              label: feed.label,
              color: feed.color,
              title: item.summary || 'Untitled',
              start: occ.start.toISOString(),
              end: occ.end.toISOString(),
              allDay: !!item.datetype && item.datetype === 'date',
              location: item.location || null,
            });
          }
        }
      } catch (err) {
        errors.push(`${feed.label}: ${err.message}`);
      }
    })
  );

  const mergedResults = mergeDuplicateEvents(results);
  mergedResults.sort((a, b) => new Date(a.start) - new Date(b.start));

  res.status(200).json({
    events: mergedResults,
    calendars: FEEDS.map((feed) => ({
      id: feed.id,
      label: feed.label,
      color: feed.color,
      configured: !!feed.url,
    })),
    errors,
    generatedAt: new Date().toISOString(),
  });
};
