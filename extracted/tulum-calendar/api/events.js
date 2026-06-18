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

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60');

  const daysAhead = Math.min(parseInt(req.query.days || '3', 10), 7);
  const rangeStart = startOfDay(new Date());
  const rangeEnd = endOfDay(new Date(Date.now() + daysAhead * 86400000));

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

  results.sort((a, b) => new Date(a.start) - new Date(b.start));

  res.status(200).json({
    events: results,
    errors,
    generatedAt: new Date().toISOString(),
  });
};
