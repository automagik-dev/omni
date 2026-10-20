abi <abi/4.0>,
include <tunables/global>

# electron-builder's own profile, widened: /opt/<app>/<executable> is the launcher that
# scripts/after-pack.cjs writes, and <executable>.bin beside it is Electron, which is what
# needs user namespaces for Chromium's sandbox on Ubuntu 24.04+.
profile "${executable}" "/opt/${sanitizedProductName}/${executable}{,.bin}" flags=(unconfined) {
  userns,

  # Site-specific additions and overrides. See local/README for details.
  include if exists <local/${executable}>
}
