// Persisted in the bounded error log, so suppression survives cold starts.
// Match exact messages: a different order or failure remains a new alert.
const ALERT_WINDOW_MS = 24 * 60 * 60 * 1000;
function appendSystemAlert(log, incoming, now = Date.now()) {
  const entries = Array.isArray(log) ? log.slice() : [];
  const duplicate = entries.findIndex(entry => {
    if (entry.source !== incoming.source || entry.message !== incoming.message || entry.resolvedAt
        || !Number.isFinite(entry.ts) || now < entry.ts) return false;
    // A changed dispatch configuration is a new incident, even when the
    // provider returns the same error text. Legacy log entries still match.
    const previousIncident = entry.details && entry.details.incident;
    const nextIncident = incoming.details && incoming.details.incident;
    if (previousIncident && nextIncident && previousIncident !== nextIncident) return false;
    // Unresolved dispatch errors do not become "new" every 24 hours.
    return incoming.source === 'dispatch' || now - entry.ts < ALERT_WINDOW_MS;
  });
  if (duplicate !== -1) {
    entries[duplicate] = Object.assign({}, entries[duplicate], {
      count: (Number(entries[duplicate].count) || 1) + 1, lastSeenAt: now
    });
    return { entries: entries.slice(0, 200), notify: false };
  }
  const entry = Object.assign({}, incoming, {
    id: now + '-' + Math.random().toString(36).slice(2, 8),
    ts: now, lastSeenAt: now, count: 1
  });
  return { entries: [entry].concat(entries).slice(0, 200), notify: true };
}
module.exports = { appendSystemAlert, ALERT_WINDOW_MS };

