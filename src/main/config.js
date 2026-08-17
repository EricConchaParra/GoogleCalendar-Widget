// Persists user preferences + OAuth client credentials in userData/config.json.
// The refresh token itself is NOT stored here — see auth.js, which keeps it
// separately encrypted via safeStorage in credentials.bin.
"use strict";

const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const DEFAULTS = {
  clientId: "",
  clientSecret: "",
  accountEmail: "", // pre-fills the Google account picker during sign-in; optional
  calendarId: "primary",
  timeZone: "America/Santiago",
  glass: "acrylic", // 'acrylic' | 'css'
  openAtLogin: false,
  useZoomDeepLink: false,
  expanded: false,
  windowBounds: null, // { x, y } top-left; sizes are fixed per-mode
};

function configPath() {
  return path.join(app.getPath("userData"), "config.json");
}

function cachePath() {
  return path.join(app.getPath("userData"), "cache.json");
}

function credentialsPath() {
  return path.join(app.getPath("userData"), "credentials.bin");
}

function atomicWrite(filePath, contents) {
  const tmp = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, contents);
  fs.renameSync(tmp, filePath);
}

function loadConfig() {
  try {
    const raw = fs.readFileSync(configPath(), "utf8");
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveConfig(config) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  atomicWrite(configPath(), JSON.stringify(config, null, 2));
}

function loadCache() {
  try {
    const raw = fs.readFileSync(cachePath(), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveCache(cache) {
  fs.mkdirSync(path.dirname(cachePath()), { recursive: true });
  atomicWrite(cachePath(), JSON.stringify(cache));
}

module.exports = {
  DEFAULTS,
  configPath,
  cachePath,
  credentialsPath,
  loadConfig,
  saveConfig,
  loadCache,
  saveCache,
};
