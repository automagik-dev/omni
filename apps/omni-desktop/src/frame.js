// How the Omni window looks. No system frame and no border anywhere: on Linux the window
// is transparent and the shell page (shell.html) draws its rounded shape, title bar and
// window buttons; on macOS the title bar is hidden behind the system's own traffic lights.
// Omni's page (dsh) is a view laid in edge to edge below the bar, its corners rounded with
// the window's. Chromium keeps a frameless window's resize edge over the view.

export const BAR_HEIGHT = 40
export const RADIUS = 14

/** BrowserWindow options for the frame on `platform`. */
export function windowChrome(platform) {
  if (platform === 'darwin') {
    return { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 13 }, vibrancy: 'under-window', visualEffectState: 'active', backgroundColor: '#00000000' }
  }
  return { frame: false, transparent: true, backgroundColor: '#00000000', autoHideMenuBar: true }
}

/**
 * Where Omni's page goes in a window whose content is `size`, and how round its corners
 * are: rounded with the window on Linux, square when maximized or on macOS (whose window
 * rounds itself).
 */
export function pageLayout(size, { platform, maximized }) {
  return {
    bounds: { x: 0, y: BAR_HEIGHT, width: size.width, height: Math.max(0, size.height - BAR_HEIGHT) },
    radius: platform === 'darwin' || maximized ? 0 : RADIUS,
  }
}

/** What the shell page's window buttons may ask the main process for. */
export const WINDOW_ACTIONS = new Set(['minimize', 'maximize', 'close'])
