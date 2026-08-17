// Minimal, explicit bridge between the sandboxed renderer and main. No direct
// Node/Electron API is ever exposed — only these six purpose-built calls.
"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("calendarWidget", {
  onAgendaUpdate(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("agenda:update", listener);
    return () => ipcRenderer.removeListener("agenda:update", listener);
  },
  refreshAgenda: () => ipcRenderer.invoke("agenda:refresh"),
  getAgenda: () => ipcRenderer.invoke("agenda:get"),
  toggleExpand: (expand) => ipcRenderer.invoke("ui:toggleExpand", expand),
  openLink: (url) => ipcRenderer.invoke("link:open", url),
  startAuth: (clientId, clientSecret, accountEmail) =>
    ipcRenderer.invoke("auth:start", { clientId, clientSecret, accountEmail }),
  getAuthStatus: () => ipcRenderer.invoke("auth:status"),
  onExpandedChanged(callback) {
    const listener = (_event, expanded) => callback(expanded);
    ipcRenderer.on("ui:expandedChanged", listener);
    return () => ipcRenderer.removeListener("ui:expandedChanged", listener);
  },
  onSignedOut(callback) {
    const listener = () => callback();
    ipcRenderer.on("auth:signedOut", listener);
    return () => ipcRenderer.removeListener("auth:signedOut", listener);
  },
});
