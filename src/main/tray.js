// System tray icon + context menu. This is the only way to bring the widget
// back since the window itself is skipTaskbar.
"use strict";

const path = require("path");
const { Tray, Menu, nativeImage } = require("electron");

/**
 * @param {object} actions
 * @param {() => void} actions.onRefresh
 * @param {() => void} actions.onToggleExpand
 * @param {(checked: boolean) => void} actions.onToggleAlwaysOnTop
 * @param {(checked: boolean) => void} actions.onToggleAutostart
 * @param {() => void} actions.onOpenCalendar
 * @param {() => void} actions.onSignOut
 * @param {() => void} actions.onQuit
 * @param {() => void} actions.onToggleWindowVisible
 * @param {() => { expanded: boolean, alwaysOnTop: boolean, autostart: boolean, signedIn: boolean }} getState
 */
function createTray(actions, getState) {
  const icon = nativeImage.createFromPath(path.join(__dirname, "..", "..", "assets", "tray.png"));
  const tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip("CalendarWidget");

  function rebuildMenu() {
    const state = getState();
    const menu = Menu.buildFromTemplate([
      { label: "Refresh now", click: actions.onRefresh },
      {
        label: state.expanded ? "Collapse" : "Expand",
        click: actions.onToggleExpand,
      },
      { type: "separator" },
      {
        label: "Always on top",
        type: "checkbox",
        checked: state.alwaysOnTop,
        click: (item) => actions.onToggleAlwaysOnTop(item.checked),
      },
      {
        label: "Start with Windows",
        type: "checkbox",
        checked: state.autostart,
        click: (item) => actions.onToggleAutostart(item.checked),
      },
      { type: "separator" },
      { label: "Open Google Calendar", click: actions.onOpenCalendar },
      {
        label: "Sign out",
        enabled: state.signedIn,
        click: actions.onSignOut,
      },
      { type: "separator" },
      { label: "Quit", click: actions.onQuit },
    ]);
    tray.setContextMenu(menu);
  }

  // Left-click toggles the widget's visibility; right-click shows the menu
  // (native default on Windows once setContextMenu is set).
  tray.on("click", () => actions.onToggleWindowVisible());
  tray.on("right-click", () => rebuildMenu());
  rebuildMenu();

  return { tray, rebuildMenu };
}

module.exports = { createTray };
