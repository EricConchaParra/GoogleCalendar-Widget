// App entry point: wires config, auth, polling, window, tray and IPC together.
"use strict";

const { app, globalShortcut, powerMonitor, shell } = require("electron");
const config = require("./config");
const auth = require("./auth");
const {
  createWidgetWindow,
  animateToMode,
  animateToSize,
  currentTopLeft,
  SETUP_SIZE,
} = require("./window");
const { createTray } = require("./tray");
const { createPoller } = require("./google-calendar");
const { registerIpcHandlers } = require("./ipc");
const { filterEvents, selectNextMeeting, groupByDay } = require("../shared/filter");
const { extractMeetingLink } = require("../shared/meeting-link");

const GOOGLE_CALENDAR_URL = "https://calendar.google.com/calendar/r";
const HOTKEY = "Ctrl+Alt+Space";

app.setName("CalendarWidget");
app.setAppUserModelId("com.ericconcha.calendarwidget");

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win && !win.isDestroyed()) {
      win.show();
      win.focus();
    }
  });

  let win = null;
  let trayHandle = null;
  let appConfig = config.loadConfig();
  let pollerRunning = false;
  let isQuitting = false;
  // Last computed payload, so a freshly-loaded renderer can pull the current
  // state via IPC instead of depending on catching a push sent at just the
  // right moment (a 'send' fired before the renderer's listener is attached
  // is silently lost — this closes that race).
  let lastAgendaPayload = null;

  function updateConfig(patch) {
    appConfig = { ...appConfig, ...patch };
    config.saveConfig(appConfig);
  }

  function enrichEvent(evt) {
    return {
      id: evt.id,
      title: evt.title,
      startMs: evt.startMs,
      endMs: evt.endMs,
      eventType: evt.eventType,
      location: evt.location,
      htmlLink: evt.htmlLink,
      meetingLink: extractMeetingLink(evt),
    };
  }

  function processAndSend(rawItems, meta) {
    const filtered = filterEvents(rawItems);
    const now = Date.now();
    const nextRaw = selectNextMeeting(filtered, now);
    const { today, tomorrow } = groupByDay(filtered, appConfig.timeZone, now);

    const payload = {
      nextMeeting: nextRaw ? enrichEvent(nextRaw) : null,
      today: today.map(enrichEvent),
      tomorrow: tomorrow.map(enrichEvent),
      meta: {
        stale: Boolean(meta.stale),
        fetchedAt: meta.fetchedAt || null,
        error: meta.error || null,
        timeZone: appConfig.timeZone,
      },
    };

    lastAgendaPayload = payload;
    if (win && !win.isDestroyed()) {
      win.webContents.send("agenda:update", payload);
    }
  }

  const poller = createPoller({
    getAccessToken: () => auth.getAccessToken(appConfig.clientId, appConfig.clientSecret),
    getConfig: () => ({ calendarId: appConfig.calendarId, timeZone: appConfig.timeZone }),
    onUpdate: ({ items, fetchedAt, stale }) => processAndSend(items, { stale, fetchedAt }),
    onError: (err) => {
      // Fall back to whatever was last cached so the widget never goes blank.
      const cached = config.loadCache();
      processAndSend(cached ? cached.items : [], {
        stale: true,
        fetchedAt: cached ? cached.fetchedAt : null,
        error: err.message,
      });
    },
    onUnauthorized: () => auth.invalidateAccessToken(),
  });

  function applyAutostart(openAtLogin) {
    // Packaged builds: process.execPath is CalendarWidget.exe itself, no args needed
    // besides our own flag. Unpackaged (`npm start`/`electron .`): process.execPath is
    // the generic electron.exe, so it needs the app path first — exactly what `electron .`
    // passes implicitly — or Windows would launch bare Electron with nothing to load.
    const args = app.isPackaged ? ["--hidden"] : [app.getAppPath(), "--hidden"];
    app.setLoginItemSettings({ openAtLogin, path: process.execPath, args });
  }

  function syncTray() {
    if (trayHandle) trayHandle.rebuildMenu();
  }

  app.whenReady().then(() => {
    const startHidden = process.argv.includes("--hidden");
    const initialMode = auth.isSignedIn() ? (appConfig.expanded ? "expanded" : "compact") : "setup";
    win = createWidgetWindow(appConfig, { startHidden, initialMode });

    win.on("moved", () => {
      updateConfig({ windowBounds: currentTopLeft(win) });
    });
    win.on("close", (event) => {
      updateConfig({ windowBounds: currentTopLeft(win) });
      // skipTaskbar means the tray is the only way back in — an Alt+F4 or
      // stray close click should hide, not destroy, the only window we have.
      if (!isQuitting) {
        event.preventDefault();
        win.hide();
      }
    });

    trayHandle = createTray(
      {
        onRefresh: () => poller.refreshNow(),
        onToggleExpand: () => {
          const next = !appConfig.expanded;
          updateConfig({ expanded: next });
          animateToMode(win, next);
          win.webContents.send("ui:expandedChanged", next);
          syncTray();
        },
        onToggleAlwaysOnTop: (checked) => {
          win.setAlwaysOnTop(checked, "screen-saver");
          updateConfig({ alwaysOnTop: checked });
        },
        onToggleAutostart: (checked) => {
          applyAutostart(checked);
          updateConfig({ openAtLogin: checked });
        },
        onOpenCalendar: () => shell.openExternal(GOOGLE_CALENDAR_URL),
        onSignOut: () => {
          auth.signOut();
          poller.stop();
          pollerRunning = false;
          processAndSend([], { stale: false, fetchedAt: null });
          win.webContents.send("auth:signedOut");
          animateToSize(win, SETUP_SIZE);
          syncTray();
        },
        onQuit: () => {
          isQuitting = true;
          app.quit();
        },
        onToggleWindowVisible: () => {
          if (win.isVisible()) {
            win.hide();
          } else {
            win.show();
            win.focus();
          }
        },
      },
      () => ({
        expanded: appConfig.expanded,
        alwaysOnTop: appConfig.alwaysOnTop !== false,
        autostart: Boolean(appConfig.openAtLogin),
        signedIn: auth.isSignedIn(),
      })
    );

    registerIpcHandlers({
      getWin: () => win,
      getConfig: () => appConfig,
      updateConfig,
      auth,
      poller,
      isPollerRunning: () => pollerRunning,
      setPollerRunning: (v) => {
        pollerRunning = v;
      },
      getLastAgendaPayload: () => lastAgendaPayload,
    });

    applyAutostart(Boolean(appConfig.openAtLogin));

    globalShortcut.register(HOTKEY, () => {
      const next = !appConfig.expanded;
      updateConfig({ expanded: next });
      animateToMode(win, next);
      win.webContents.send("ui:expandedChanged", next);
      syncTray();
    });

    // A resumed laptop is exactly when a stale countdown would be most visible.
    powerMonitor.on("resume", () => poller.refreshNow());

    if (auth.isSignedIn() && appConfig.clientId && appConfig.clientSecret) {
      poller.start();
      pollerRunning = true;
    }
  });

  app.on("window-all-closed", () => {
    // skipTaskbar + no dock: the tray is the only way back in, so don't quit.
  });

  app.on("before-quit", () => {
    isQuitting = true;
  });

  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
  });
}
