// Registers the IPC handlers the preload bridge exposes to the renderer.
// Kept deliberately small and explicit — see preload.js for the matching surface.
"use strict";

const { ipcMain, shell } = require("electron");
const { animateToMode, animateToSize, normalizeExtras, SETUP_SIZE } = require("./window");

const ALLOWED_LINK_SCHEMES = new Set(["https:"]);
const ZOOM_DEEP_LINK_SCHEME = "zoommtg:";

/**
 * @param {object} ctx
 * @param {() => import('electron').BrowserWindow} ctx.getWin
 * @param {() => object} ctx.getConfig
 * @param {(patch: object) => void} ctx.updateConfig
 * @param {import('./auth')} ctx.auth
 * @param {{ refreshNow: () => void, start: () => void }} ctx.poller
 * @param {() => boolean} ctx.isPollerRunning
 * @param {(running: boolean) => void} ctx.setPollerRunning
 * @param {() => object | null} ctx.getLastAgendaPayload
 * @param {() => { stackedRows: number, noteLines: number }} ctx.getCompactExtras
 * @param {(extras: { stackedRows: number, noteLines: number }) => void} ctx.setCompactExtras
 */
function registerIpcHandlers(ctx) {
  ipcMain.handle("agenda:refresh", () => {
    ctx.poller.refreshNow();
    return { ok: true };
  });

  // Pull-based initial sync: a renderer that just finished loading calls this
  // to catch up on whatever was last computed, instead of only relying on a
  // 'send' that may have fired before its listener was ready.
  ipcMain.handle("agenda:get", () => ctx.getLastAgendaPayload());

  ipcMain.handle("ui:toggleExpand", (_event, expand) => {
    const win = ctx.getWin();
    const config = ctx.getConfig();
    const nextExpanded = typeof expand === "boolean" ? expand : !config.expanded;
    ctx.updateConfig({ expanded: nextExpanded });
    animateToMode(win, nextExpanded, ctx.getCompactExtras());
    return { expanded: nextExpanded };
  });

  // The renderer owns the rows below the main meeting — stacked concurrent
  // meetings and the "Up next …" / "+N more" notes. They depend on the clock,
  // which it re-evaluates between polls, so it reports the counts here and the
  // compact card grows by exactly those rows' height instead of clipping.
  ipcMain.handle("ui:compactExtras", (_event, extras) => {
    const next = normalizeExtras(extras);
    const current = ctx.getCompactExtras();
    if (next.stackedRows === current.stackedRows && next.noteLines === current.noteLines) {
      return { ok: true };
    }
    ctx.setCompactExtras(next);

    // Only the compact card is height-sensitive; expanded and setup have slack.
    if (!ctx.getConfig().expanded && ctx.auth.isSignedIn()) {
      animateToMode(ctx.getWin(), false, next);
    }
    return { ok: true };
  });

  ipcMain.handle("link:open", (_event, url) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return { ok: false, error: "Invalid URL" };
    }

    const config = ctx.getConfig();
    const allowed =
      ALLOWED_LINK_SCHEMES.has(parsed.protocol) ||
      (config.useZoomDeepLink && parsed.protocol === ZOOM_DEEP_LINK_SCHEME);

    if (!allowed) {
      return { ok: false, error: `Scheme not allowed: ${parsed.protocol}` };
    }

    shell.openExternal(url);
    return { ok: true };
  });

  ipcMain.handle("auth:start", async (_event, { clientId, clientSecret, accountEmail }) => {
    if (!clientId || !clientSecret) {
      return { ok: false, error: "Client ID and Client Secret are required." };
    }
    ctx.updateConfig({ clientId, clientSecret, accountEmail: accountEmail || "" });
    try {
      await ctx.auth.startSignIn(clientId, clientSecret, accountEmail);
      if (!ctx.isPollerRunning()) {
        ctx.poller.start();
        ctx.setPollerRunning(true);
      }
      animateToMode(ctx.getWin(), ctx.getConfig().expanded, ctx.getCompactExtras());
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Same connection, fresh token: reuses the stored client credentials and
  // account hint, so a refresh token Google expired or revoked can be replaced
  // straight from the "outdated" badge — nothing to re-enter.
  ipcMain.handle("auth:reconnect", async () => {
    const config = ctx.getConfig();
    if (!config.clientId || !config.clientSecret) {
      // Nothing on file to reuse — fall back to the full setup screen.
      animateToSize(ctx.getWin(), SETUP_SIZE);
      return { ok: false, needsSetup: true, error: "No saved credentials — connect again." };
    }
    try {
      await ctx.auth.startSignIn(config.clientId, config.clientSecret, config.accountEmail);
      if (ctx.isPollerRunning()) {
        ctx.poller.refreshNow();
      } else {
        ctx.poller.start();
        ctx.setPollerRunning(true);
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("auth:status", () => ({
    signedIn: ctx.auth.isSignedIn(),
    expanded: Boolean(ctx.getConfig().expanded),
  }));
}

module.exports = { registerIpcHandlers };
