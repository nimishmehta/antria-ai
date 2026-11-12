'use strict';

// Minimal preload. contextIsolation is on; we expose only a tiny, safe bridge so
// the office web UI can learn when an app update is ready and ask to relaunch.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nimishOffice', {
  desktop: true,
  version: '0.2.7',
  // Fires when the Electron updater has downloaded a new version and it's ready
  // to install. cb receives { ready:true, version }.
  onUpdateReady: (cb) => {
    if (typeof cb !== 'function') return;
    ipcRenderer.on('update-ready', (_e, info) => { try { cb(info); } catch (_) {} });
  },
  // Ask for the current update state on load (covers an update that finished
  // downloading before the UI mounted). Resolves { ready:boolean, version? }.
  getUpdateState: () => ipcRenderer.invoke('get-update-state'),
  // Relaunch the app to apply the downloaded update.
  relaunchToUpdate: () => ipcRenderer.send('quit-and-install'),
  // Full app relaunch — the hook the office's one-click engine-switch restart calls
  // (window.nimishOffice.relaunchApp) to reopen on the newly-chosen engine.
  relaunchApp: () => ipcRenderer.send('relaunch-app'),
  // Retry first-run setup (re-attempt Claude Code install + start the team).
  retryBoot: () => ipcRenderer.send('retry-boot'),
});
