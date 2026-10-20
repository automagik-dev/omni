// The window runs dsh's web app as a plain page; it needs nothing from Electron. This
// preload only tells the page it is inside the Omni desktop app.
const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('omniDesktop', Object.freeze({ app: 'omni-desktop', platform: process.platform }))
