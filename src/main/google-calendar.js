// Fetches events from Google Calendar and drives a self-scheduling poller with
// disk caching and exponential backoff on failure.
"use strict";

const { loadCache, saveCache } = require("./config");

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
// Only what filter.js / meeting-link.js actually consume — Zoom descriptions
// alone can run to hundreds of dial-in numbers, no need to pull that over the wire.
const FIELDS =
  "items(id,summary,status,eventType,start,end,location,description,htmlLink," +
  "conferenceData/entryPoints,attendees(self,responseStatus))";

const BASE_INTERVAL_MS = 60 * 1000;
const MAX_BACKOFF_MS = 5 * 60 * 1000;

async function fetchEvents({ accessToken, calendarId, timeZone }) {
  const now = Date.now();
  const timeMin = new Date(now - 60 * 60 * 1000).toISOString();
  // Covers the rest of today plus all of tomorrow no matter what time "now" is;
  // groupByDay() in shared/filter.js does the precise day-boundary bucketing.
  const timeMax = new Date(now + 48 * 60 * 60 * 1000).toISOString();

  const url = new URL(
    `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`
  );
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("timeMin", timeMin);
  url.searchParams.set("timeMax", timeMax);
  url.searchParams.set("maxResults", "50");
  url.searchParams.set("fields", FIELDS);
  url.searchParams.set("timeZone", timeZone);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const err = new Error(`Google Calendar API responded with ${res.status}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  return data.items || [];
}

/**
 * @param {object} deps
 * @param {() => Promise<string>} deps.getAccessToken
 * @param {() => { calendarId: string, timeZone: string }} deps.getConfig
 * @param {(payload: { items: object[], fetchedAt: number, stale: boolean }) => void} deps.onUpdate
 * @param {(err: Error) => void} deps.onError
 * @param {() => void} [deps.onUnauthorized] called once on a 401 before the retry
 */
function createPoller({ getAccessToken, getConfig, onUpdate, onError, onUnauthorized }) {
  let timer = null;
  let backoffMs = BASE_INTERVAL_MS;
  let stopped = false;

  function scheduleNext(delay) {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(tick, delay);
  }

  async function tick(isRetryAfterAuthError = false) {
    if (stopped) return;
    try {
      const config = getConfig();
      const accessToken = await getAccessToken();
      const items = await fetchEvents({
        accessToken,
        calendarId: config.calendarId,
        timeZone: config.timeZone,
      });

      backoffMs = BASE_INTERVAL_MS;
      const fetchedAt = Date.now();
      saveCache({ items, fetchedAt });
      onUpdate({ items, fetchedAt, stale: false });
      scheduleNext(BASE_INTERVAL_MS);
    } catch (err) {
      if (err.status === 401 && !isRetryAfterAuthError) {
        if (onUnauthorized) onUnauthorized();
        return tick(true);
      }
      onError(err);
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
      scheduleNext(backoffMs);
    }
  }

  function start() {
    stopped = false;
    const cached = loadCache();
    if (cached) {
      onUpdate({ items: cached.items, fetchedAt: cached.fetchedAt, stale: true });
    }
    tick();
  }

  function refreshNow() {
    clearTimeout(timer);
    backoffMs = BASE_INTERVAL_MS;
    tick();
  }

  function stop() {
    stopped = true;
    clearTimeout(timer);
  }

  return { start, stop, refreshNow };
}

module.exports = { fetchEvents, createPoller, BASE_INTERVAL_MS };
