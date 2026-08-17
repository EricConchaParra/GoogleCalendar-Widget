// Countdown formatting shared between main (tray tooltip) and renderer (card UI).
// Deliberately hours+minutes only, per spec — no seconds, ever.
"use strict";

const MINUTE_MS = 60 * 1000;

/**
 * @param {{ startMs: number, endMs: number }} meeting
 * @param {number} nowMs
 * @returns {{ state: 'upcoming'|'starting'|'in-progress'|'ended', label: string, minutesUntil: number }}
 */
function describeCountdown(meeting, nowMs) {
  const { startMs, endMs } = meeting;

  if (nowMs >= endMs) {
    return { state: "ended", label: "Ended", minutesUntil: 0 };
  }

  if (nowMs >= startMs) {
    const minutesLeft = Math.max(1, Math.ceil((endMs - nowMs) / MINUTE_MS));
    return {
      state: "in-progress",
      label: `in progress · ends in ${formatMinutes(minutesLeft)}`,
      minutesUntil: 0,
    };
  }

  const minutesUntil = Math.ceil((startMs - nowMs) / MINUTE_MS);

  if (minutesUntil < 1) {
    return { state: "starting", label: "starting now", minutesUntil: 0 };
  }

  return {
    state: "upcoming",
    label: `in ${formatMinutes(minutesUntil)}`,
    minutesUntil,
  };
}

function formatMinutes(totalMinutes) {
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

function formatTimeRange(startMs, endMs, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
    timeZone,
  });
  return `${fmt.format(new Date(startMs))} – ${fmt.format(new Date(endMs))}`;
}

const api = { describeCountdown, formatMinutes, formatTimeRange, MINUTE_MS };
if (typeof module !== "undefined" && module.exports) {
  module.exports = api;
} else {
  window.CalendarWidgetTime = api;
}
