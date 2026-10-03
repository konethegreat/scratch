// Preload runs in an isolated context before the renderer loads.
// Keep this minimal — the renderer talks to the local Express server over HTTP,
// so we don't need to expose Node APIs. Add bridges here later if you need
// native file dialogs, OS notifications, etc.

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('saJas', {
  isElectron: true,
  platform: process.platform
});
