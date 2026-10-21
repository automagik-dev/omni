// The frame page's only bridge: its window buttons, and the window's state to draw.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('omniWindow', Object.freeze({
  platform: process.platform,
  act: (action) => ipcRenderer.send('omni-window', action),
  onState: (listener) => ipcRenderer.on('omni-window-state', (_event, state) => listener(state)),
}))
