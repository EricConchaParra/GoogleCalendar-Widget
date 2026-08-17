// Creates and manages the floating always-on-top widget window: glass surface,
// compact <-> expanded animated resize, and position persistence per display.
"use strict";

const path = require("path");
const { BrowserWindow, screen } = require("electron");

const COMPACT_SIZE = { width: 340, height: 96 };
const EXPANDED_SIZE = { width: 360, height: 440 };
const SETUP_SIZE = { width: 340, height: 450 };
const RESIZE_DURATION_MS = 180;
const RESIZE_STEPS = 12;
const DEFAULT_MARGIN = 24;

function clampToDisplay(x, y, width, height) {
  const display = screen.getDisplayMatching({ x, y, width, height });
  const area = display.workArea;
  const clampedX = Math.min(Math.max(x, area.x), area.x + area.width - width);
  const clampedY = Math.min(Math.max(y, area.y), area.y + area.height - height);
  return { x: clampedX, y: clampedY };
}

function defaultPosition(width, height) {
  const area = screen.getPrimaryDisplay().workArea;
  return {
    x: area.x + area.width - width - DEFAULT_MARGIN,
    y: area.y + DEFAULT_MARGIN,
  };
}

function sizeForMode(mode, expanded) {
  if (mode === "setup") return SETUP_SIZE;
  return expanded ? EXPANDED_SIZE : COMPACT_SIZE;
}

function createWidgetWindow(config, { startHidden = false, initialMode = "compact" } = {}) {
  const size = sizeForMode(initialMode, config.expanded);
  const pos = config.windowBounds
    ? clampToDisplay(config.windowBounds.x, config.windowBounds.y, size.width, size.height)
    : defaultPosition(size.width, size.height);

  const useAcrylic = config.glass === "acrylic";

  const win = new BrowserWindow({
    width: size.width,
    height: size.height,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: !useAcrylic,
    backgroundColor: useAcrylic ? undefined : "#00000000",
    backgroundMaterial: useAcrylic ? "acrylic" : undefined,
    roundedCorners: false,
    resizable: false,
    movable: true,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  if (process.env.CW_DEBUG_CONSOLE) {
    win.webContents.on("console-message", (_e, level, message, line, sourceId) => {
      console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
    });
  }

  win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));

  if (!startHidden) {
    win.once("ready-to-show", () => win.show());
  }

  return win;
}

/**
 * Animates the window to an arbitrary target size, keeping the top-left
 * corner fixed (clamped to the current display) so it doesn't drift.
 */
function animateToSize(win, target) {
  if (win.isDestroyed()) return;

  const current = win.getBounds();
  const clamped = clampToDisplay(current.x, current.y, target.width, target.height);

  const startWidth = current.width;
  const startHeight = current.height;
  const startX = current.x;
  const startY = current.y;

  const deltaW = target.width - startWidth;
  const deltaH = target.height - startHeight;
  const deltaX = clamped.x - startX;
  const deltaY = clamped.y - startY;

  let step = 0;
  const stepMs = RESIZE_DURATION_MS / RESIZE_STEPS;

  const tick = () => {
    if (win.isDestroyed()) return;
    step += 1;
    const t = Math.min(1, step / RESIZE_STEPS);
    const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic

    win.setBounds({
      x: Math.round(startX + deltaX * eased),
      y: Math.round(startY + deltaY * eased),
      width: Math.round(startWidth + deltaW * eased),
      height: Math.round(startHeight + deltaH * eased),
    });

    if (t < 1) setTimeout(tick, stepMs);
  };

  tick();
}

/** Animates between the compact and expanded widget modes. */
function animateToMode(win, expanded) {
  animateToSize(win, expanded ? EXPANDED_SIZE : COMPACT_SIZE);
}

function currentTopLeft(win) {
  const { x, y } = win.getBounds();
  return { x, y };
}

module.exports = {
  COMPACT_SIZE,
  EXPANDED_SIZE,
  SETUP_SIZE,
  createWidgetWindow,
  animateToMode,
  animateToSize,
  clampToDisplay,
  currentTopLeft,
};
