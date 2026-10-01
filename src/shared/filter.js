// Normalizes raw Google Calendar API events and applies the filtering pipeline
// agreed with the user: drop cancelled, drop declined-by-me, drop all-day events.
"use strict";

/** @param {object} rawEvent Google Calendar API event resource */
function normalizeEvent(rawEvent) {
  const start = rawEvent.start || {};
  const end = rawEvent.end || {};
  const allDay = Boolean(start.date) && !start.dateTime;

  const selfAttendee = (rawEvent.attendees || []).find((a) => a.self);

  return {
    id: rawEvent.id,
    title: rawEvent.summary || "(Untitled)",
    startMs: allDay ? Date.parse(start.date) : Date.parse(start.dateTime),
    endMs: allDay ? Date.parse(end.date) : Date.parse(end.dateTime),
    allDay,
    status: rawEvent.status,
    eventType: rawEvent.eventType || "default",
    location: rawEvent.location || "",
    description: rawEvent.description || "",
    conferenceData: rawEvent.conferenceData || null,
    htmlLink: rawEvent.htmlLink || "",
    selfResponseStatus: selfAttendee ? selfAttendee.responseStatus : null,
  };
}

/**
 * @param {object[]} rawEvents
 * @returns {object[]} normalized, filtered, sorted-by-start events
 */
function filterEvents(rawEvents) {
  return rawEvents
    .map(normalizeEvent)
    .filter((e) => e.status !== "cancelled")
    .filter((e) => e.selfResponseStatus !== "declined")
    .filter((e) => !e.allDay)
    .filter((e) => Number.isFinite(e.startMs) && Number.isFinite(e.endMs))
    .sort((a, b) => a.startMs - b.startMs);
}

/**
 * The meetings the compact card is about right now. Calendars double-book, so
 * this is a list: every meeting in progress, or — when nothing is live — every
 * meeting tied for the earliest upcoming start. An in-progress meeting stays
 * on the card until it ENDS instead of vanishing at start time.
 * @param {object[]} events already filtered+sorted
 * @param {number} nowMs
 * @returns {object[]} sorted by start; empty when nothing is left
 */
function selectActiveMeetings(events, nowMs) {
  const pending = events.filter((e) => e.endMs > nowMs);
  const live = pending.filter((e) => e.startMs <= nowMs);
  if (live.length > 0) return live;
  if (pending.length === 0) return [];
  return pending.filter((e) => e.startMs === pending[0].startMs);
}

/**
 * The meeting that starts before the live ones are all over (back-to-back or
 * overlapping), i.e. the one there is no gap to prepare for. Null while
 * nothing is in progress — the card itself is already the "next" one then.
 * @param {object[]} events already filtered+sorted
 * @param {object[]} active result of selectActiveMeetings for the same nowMs
 * @param {number} nowMs
 */
function selectUpNext(events, active, nowMs) {
  if (active.length === 0 || active[0].startMs > nowMs) return null;
  const lastEndMs = Math.max(...active.map((e) => e.endMs));
  return events.find((e) => e.startMs > nowMs && e.startMs <= lastEndMs) || null;
}

/**
 * Groups events into "today" / "tomorrow" buckets for the expanded view,
 * using calendar-day boundaries in the given IANA time zone.
 * @param {object[]} events already filtered+sorted
 * @param {string} timeZone
 * @param {number} nowMs
 */
function groupByDay(events, timeZone, nowMs) {
  const dayKey = (ms) => dateKeyInZone(ms, timeZone);
  const todayKey = dayKey(nowMs);
  const tomorrowKey = dayKey(nowMs + 24 * 60 * 60 * 1000);

  const today = [];
  const tomorrow = [];

  for (const event of events) {
    const key = dayKey(event.startMs);
    if (key === todayKey) today.push(event);
    else if (key === tomorrowKey) tomorrow.push(event);
  }

  return { today, tomorrow };
}

function dateKeyInZone(ms, timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

// Named distinctly from time.js's `api`: both load as classic scripts in the
// renderer, where top-level consts share one scope and a repeat would throw.
const filterApi = { normalizeEvent, filterEvents, selectActiveMeetings, selectUpNext, groupByDay };
if (typeof module !== "undefined" && module.exports) {
  module.exports = filterApi;
} else {
  window.CalendarWidgetFilter = filterApi;
}
