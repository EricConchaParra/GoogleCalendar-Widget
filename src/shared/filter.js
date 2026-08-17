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
 * Next meeting is the first event whose END is still in the future, so an
 * in-progress meeting stays the active card instead of vanishing at start time.
 * @param {object[]} events already filtered+sorted
 * @param {number} nowMs
 */
function selectNextMeeting(events, nowMs) {
  return events.find((e) => e.endMs > nowMs) || null;
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

const api = { normalizeEvent, filterEvents, selectNextMeeting, groupByDay };
if (typeof module !== "undefined" && module.exports) {
  module.exports = api;
} else {
  window.CalendarWidgetFilter = api;
}
