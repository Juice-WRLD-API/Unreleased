const { contextBridge, ipcRenderer } = require('electron')

// Bridge for the updating window shown at launch (see updateBeforeLaunch in
// main.js). The page only hears the update status; it can't send anything.
contextBridge.exposeInMainWorld('updating', {
  onStatus: (/** @type {(status: unknown) => void} */ cb) => {
    ipcRenderer.on('update-status', (_event, status) => cb(status))
  },
})
