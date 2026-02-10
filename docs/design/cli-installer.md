# Design Doc: Omni CLI Installer (`install.sh`)

## 1. Current State

Currently, the Omni CLI is installed via `make cli-link` during development. This process:
1.  Runs `bun run build` in `packages/cli`.
2.  Uses `bun link` to make the `omni` command available globally (usually via a symlink in a local bin directory).

On the local development machine (`genie-os`), a manual helper exists at `~/.omni/bin/omni` which is a bash wrapper:
```bash
#!/usr/bin/env bash
exec bun "/home/genie/workspace/repos/automagik/omni/packages/cli/src/index.ts" "$@"
```

In production (`10.114.1.140`), the `omni` command is **not** currently installed in the PATH.

## 2. Proposed Behavior: `install.sh`

The goal is a one-liner:
`curl -fsSL https://omni.namastex.io/install.sh | bash`

### 2.1. Key Responsibilities
1.  **Environment Detection:** Detect OS (Linux/macOS) and Architecture (x64/arm64).
2.  **Dependency Check:** Check for `bun`. If missing, offer to install it or error out.
3.  **Installation Directory:** Use `~/.omni` as the base.
    *   Binaries in `~/.omni/bin`.
    *   Configuration/Logs in `~/.omni/config` or similar.
4.  **Binary Acquisition:**
    *   **Phase 1 (Source):** If running within the repo, build the binary using `bun build --compile`.
    *   **Phase 2 (Remote):** Download the pre-compiled binary from GitHub Releases or a CDN based on OS/Arch.
5.  **PATH Management:**
    *   Detect the user's shell (`$SHELL`).
    *   Update `.bashrc`, `.zshrc`, or `config.fish` if `~/.omni/bin` is not in PATH.
6.  **Verification:** Run `omni --version` to confirm success.

### 2.2. Script Skeleton (Draft)

```bash
#!/bin/bash
set -e

OMNI_DIR="$HOME/.omni"
OMNI_BIN_DIR="$OMNI_DIR/bin"
mkdir -p "$OMNI_BIN_DIR"

# 1. Detect OS/Arch
OS="$(uname -s)"
ARCH="$(uname -m)"

# 2. Check for Bun
if ! command -v bun &> /dev/null; then
    echo "Bun not found. Installing Bun..."
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
fi

# 3. Install/Build Binary
# For now, we'll assume we are building from source if in a repo, 
# or downloading a placeholder if not.
if [ -f "packages/cli/src/index.ts" ]; then
    echo "Building Omni CLI from source..."
    bun build ./packages/cli/src/index.ts --compile --outfile "$OMNI_BIN_DIR/omni"
else
    echo "Downloading Omni CLI binary for $OS/$ARCH..."
    # URL="https://github.com/automagik-dev/omni/releases/latest/download/omni-$OS-$ARCH"
    # curl -L "$URL" -o "$OMNI_BIN_DIR/omni"
    # chmod +x "$OMNI_BIN_DIR/omni"
    echo "Remote download not yet implemented. Please run from repo root."
    exit 1
fi

# 4. PATH Setup
SHELL_RC=""
case "$SHELL" in
    */bash) SHELL_RC="$HOME/.bashrc" ;;
    */zsh)  SHELL_RC="$HOME/.zshrc" ;;
    */fish) SHELL_RC="$HOME/.config/fish/config.fish" ;;
esac

if [ -n "$SHELL_RC" ]; then
    if ! grep -q "$OMNI_BIN_DIR" "$SHELL_RC"; then
        echo "Adding $OMNI_BIN_DIR to PATH in $SHELL_RC"
        if [[ "$SHELL" == *"fish"* ]]; then
            echo "set -gx PATH $OMNI_BIN_DIR \$PATH" >> "$SHELL_RC"
        else
            echo "export PATH=\"$OMNI_BIN_DIR:\$PATH\"" >> "$SHELL_RC"
        fi
    fi
fi

echo "Omni CLI installed successfully!"
echo "Run 'omni --help' to get started."
```

## 3. Edge Cases & Considerations

-   **Updates:** The `install.sh` should be re-runnable to upgrade the CLI.
-   **Permissions:** Avoid using `sudo`. Everything should stay within `$HOME`.
-   **CI/CD:** The script should be non-interactive by default.
-   **Multiple Shells:** If a user uses both Bash and Zsh, we might only update the current one. Maybe check for existence of common RC files.
-   **Uninstall:** Provide `uninstall.sh` or a command `omni self-uninstall` that removes `~/.omni` and cleans up RC files (though cleaning RC files is tricky/dangerous).

## 4. Production Findings (10.114.1.140)

-   **User:** `omni`
-   **Shell:** `/bin/bash`
-   **Current PATH:** Standard, missing Omni.
-   **Recommendation:** Running `install.sh` on this machine should target `/home/omni/.omni/bin` and update `/home/omni/.bashrc`.

## 5. Next Steps

1.  Create `scripts/install.sh` based on this design.
2.  Refine the `bun build --compile` process to ensure cross-platform compatibility (or set up a CI pipeline to build binaries for multiple targets).
3.  Add `omni upgrade` command to the CLI itself.
