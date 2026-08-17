// Extracts a joinable meeting URL from a normalized event, in priority order:
// conferenceData -> location -> description. Pure logic, no Electron/Node APIs,
// so it can run unmodified in the renderer too.
"use strict";

const PROVIDER_PATTERNS = [
  { id: "zoom", label: "Zoom", regex: /https?:\/\/[\w.-]*zoom\.us\/(j|w|my|s)\/[^\s"<>]+/i },
  { id: "meet", label: "Google Meet", regex: /https?:\/\/meet\.google\.com\/[^\s"<>]+/i },
  {
    id: "teams",
    label: "Teams",
    regex: /https?:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\s"<>]+/i,
  },
  { id: "webex", label: "Webex", regex: /https?:\/\/[\w.-]*webex\.com\/[^\s"<>]+/i },
];

/** @param {string} html raw description HTML from the Calendar API */
function decodeHtmlEntities(html) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, " ");
}

function matchProvider(text) {
  if (!text) return null;
  for (const provider of PROVIDER_PATTERNS) {
    const match = text.match(provider.regex);
    if (match) {
      // Trim trailing punctuation that regex greediness can pick up.
      const url = match[0].replace(/[),.;]+$/, "");
      return { id: provider.id, label: provider.label, url };
    }
  }
  return null;
}

/**
 * @param {{ conferenceData?: object, location?: string, description?: string }} event
 * @returns {{ id: string, label: string, url: string } | null}
 */
function extractMeetingLink(event) {
  const entryPoints = event.conferenceData && event.conferenceData.entryPoints;
  if (entryPoints) {
    const video = entryPoints.find((ep) => ep.entryPointType === "video");
    if (video && video.uri) {
      const known = matchProvider(video.uri);
      return known || { id: "video", label: "Videollamada", url: video.uri };
    }
  }

  const fromLocation = matchProvider(event.location || "");
  if (fromLocation) return fromLocation;

  const fromDescription = matchProvider(decodeHtmlEntities(event.description || ""));
  if (fromDescription) return fromDescription;

  return null;
}

const api = { extractMeetingLink };
if (typeof module !== "undefined" && module.exports) {
  module.exports = api;
} else {
  window.CalendarWidgetMeetingLink = api;
}
