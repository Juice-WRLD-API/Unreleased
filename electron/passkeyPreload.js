const { contextBridge, ipcRenderer } = require('electron')

// Bridge for the passkey ceremony window (see passkey.js). The page can read
// the one request it was opened for and report the outcome, nothing else.
contextBridge.exposeInMainWorld('passkeyHost', {
  getRequest: () => ipcRenderer.invoke('passkey-window:request'),
  finish: (result) => ipcRenderer.send('passkey-window:result', result),
})
