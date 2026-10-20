// Draws assets/icon.png (1024 px) from the Omni mark in ../omni-ui-dsh/src/client/logo.js,
// with Electron's own renderer, so the repository needs no image tools. Run it again when
// the mark changes, and commit the PNG:
//   npx electron scripts/make-icon.cjs        (add --no-sandbox where Chromium needs it)
const { app, BrowserWindow } = require('electron')
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const SIZE = 1024
const logo = readFileSync(join(__dirname, '..', '..', 'omni-ui-dsh', 'src', 'client', 'logo.js'), 'utf8')
const constant = name => logo.match(new RegExp(`const ${name} = '?([^'\\n]+)'?`))[1]
const mark = constant('MARK')
const box = Number(constant('MARK_BOX'))
const shift = Number(constant('SHIFT'))

// A dark rounded tile with the mark centred at 62% of it, in white over its cyan and magenta offsets.
const scale = (SIZE * 0.62) / box
const offset = (SIZE - box * scale) / 2
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
<rect width="${SIZE}" height="${SIZE}" rx="${SIZE * 0.22}" fill="#0b1220"/>
<g transform="translate(${offset} ${offset}) scale(${scale})">
<path d="${mark}" fill="${constant('CYAN')}" transform="translate(-${shift} 0)"/>
<path d="${mark}" fill="${constant('MAGENTA')}" transform="translate(${shift} 0)"/>
<path d="${mark}" fill="#ffffff"/>
</g></svg>`

app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: SIZE, height: SIZE, show: false, useContentSize: true, transparent: true, frame: false, webPreferences: { offscreen: true } })
  await window.loadURL(`data:text/html,${encodeURIComponent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`)}`)
  await new Promise(done => setTimeout(done, 500))
  const image = await window.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE })
  mkdirSync(join(__dirname, '..', 'assets'), { recursive: true })
  writeFileSync(join(__dirname, '..', 'assets', 'icon.png'), image.resize({ width: SIZE, height: SIZE }).toPNG())
  console.log('assets/icon.png')
  app.quit()
})
