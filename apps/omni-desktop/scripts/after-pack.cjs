// electron-builder afterPack hook (Linux only): puts a launcher in front of the Electron
// binary that decides how Chromium sandboxes the window before Chromium starts, since a
// switch set from the main script comes too late for the sandbox.
//
//   chrome-sandbox setuid root                                 -> sandboxed, as is
//   unprivileged user namespaces allowed                       -> sandboxed, as is
//   installed from the deb, whose AppArmor profile grants the
//   binary user namespaces (Ubuntu 24.04+)                     -> sandboxed, as is
//   none of these (an AppImage on Ubuntu 24.04+)               -> --no-sandbox, and it says so
//
// The deb's AppArmor profile (scripts/apparmor-profile.tpl) attaches to both this launcher
// and the real binary next to it.
const { chmodSync, renameSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'linux') return
  const name = context.packager.executableName
  const binary = join(context.appOutDir, name)
  renameSync(binary, `${binary}.bin`)
  writeFileSync(binary, launcher(name), { mode: 0o755 })
  chmodSync(binary, 0o755)
}

function launcher(name) {
  return `#!/bin/sh
# Omni desktop launcher: see scripts/after-pack.cjs in apps/omni-desktop.
here=$(dirname "$(readlink -f "$0")")
sandbox="$here/chrome-sandbox"
restricted=$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null || echo 0)
if [ -u "$sandbox" ] && [ "$(stat -c %u "$sandbox" 2>/dev/null)" = 0 ]; then
  exec "$here/${name}.bin" "$@"
elif [ "$restricted" != 1 ]; then
  exec "$here/${name}.bin" "$@"
elif [ -f "/etc/apparmor.d/${name}" ] && grep -qF "\\"$here/${name}" "/etc/apparmor.d/${name}"; then
  exec "$here/${name}.bin" "$@"
else
  echo "omni-desktop: this system blocks the namespaces Chromium sandboxes with, and this copy has no setuid helper; running without the sandbox. Install the .deb for a sandboxed window." >&2
  exec "$here/${name}.bin" --no-sandbox "$@"
fi
`
}
