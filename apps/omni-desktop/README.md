# Omni desktop (labs)

Omni on your desktop: a window on a [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) of its own, with the Omni UI plugin ([`apps/omni-ui-dsh`](../omni-ui-dsh)) already in it. Open it, type the address of your Omni, send the code it shows to yourself on WhatsApp, and your channels and chats are there. No keys to copy.

> Labs build: Linux (AppImage, deb; also WSL with WSLg) and an unsigned macOS dmg. Windows itself is not supported.

## How it works

- Electron's main process starts dsh with Electron's own Node (`ELECTRON_RUN_AS_NODE`), on `127.0.0.1` and a free port, and opens the launch URL dsh prints with its per-launch token. Quitting stops dsh.
- Everything the app keeps is in one folder, `~/.omni/desktop` (`OMNI_DESKTOP_HOME`, or `$OMNI_HOME/desktop`):

  | Folder | What |
  |---|---|
  | `dsh/` | dsh's home (`DSH_HOME`): its Sessions, settings, and the `omni` profile the app copies in from the build |
  | `ui/` | the Omni UI plugin's home: the Bot team, and `omni.json`, the Omni this app is linked to (0600) |
  | `logs/dsh.log` | dsh's output |

  It is apart from a dsh you already run (`~/.dsh`) and from the Omni UI plugin installed into that dsh (`~/.omni/ui`).
- The window is a plain page: context isolation and the renderer sandbox are on, there is no Node in it, it stays on dsh's origin, and web links (a `wa.me` link, docs) open in your browser. Other schemes are refused.
- Linux sandbox: Chromium needs user namespaces or a setuid helper, and Ubuntu 24.04+ restricts user namespaces. The deb installs an AppArmor profile that allows them for the app, so the window is sandboxed. An AppImage cannot carry one; on such a system its launcher runs without the sandbox and says so on stderr. Prefer the deb there.
- The app ships the dsh release the plugin is tested against (`runtime/package.json`, pinned with its lock) and the plugin packed with `npm pack`. Nothing updates itself.

Models come from dsh: on first start, sign in to DeepSeek, enter an API key, or set up another provider in Settings → Models.

## Build

```sh
npm ci                  # Electron and electron-builder
npm test                # the main-process logic, without Electron
npm run dist:linux      # dist/Omni-<version>-linux-x86_64.AppImage and -amd64.deb
npm run dist:mac        # on macOS: dist/Omni-<version>-labs-unsigned-mac-<arch>.dmg
```

`dist:*` first runs `scripts/prepare-runtime.mjs`, which installs the pinned dsh into `build/runtime` and the packed plugin into `build/profile`. Native packages are per platform, so build each target on its own platform. Builds run with `DO_NOT_TRACK=1`.

To run from a checkout: `npm run prepare-runtime`, then `npx electron .` (add `--no-sandbox` on a system where Chromium's sandbox cannot start unpackaged).

`npx electron scripts/make-icon.cjs` draws `assets/icon.png` from the Omni mark in the plugin's `logo.js`.

## Measured (labs prototype, 2026-10-20, Linux x64)

| | |
|---|---|
| AppImage | 251 MB |
| deb | 208 MB |
| dsh runtime, unpacked | 864 MB (145 MB of it is LibreOffice WASM for document previews) |
| Memory after start, idle | about 1.0 GB RSS across Electron's processes and dsh (dsh itself about 290 MB) |

## macOS

The dmg is not signed or notarized. Gatekeeper blocks it on first open; allow it under System Settings → Privacy & Security. Signed builds wait for an Apple Developer ID.
