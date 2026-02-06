# System Requirements

> Omni v2: Universal Event-Driven Omnichannel Platform

## Quick Check

Run this to verify your system is ready:

```bash
make check-deps          # Check all dependencies
make check-deps --install   # Auto-install missing dependencies
```

---

## Required Dependencies

These must be installed before running `make setup`:

| Tool | Minimum | Purpose | Install |
|------|---------|---------|---------|
| **make** | 4.0+ | Build system | [GNU Make](https://www.gnu.org/software/make/) |
| **bun** | 1.0+ | JavaScript runtime & package manager | `curl -fsSL https://bun.sh/install \| bash` |
| **pm2** | 5.0+ | Process manager | `npm install -g pm2` or `bun add -g pm2` |
| **curl** | 7.0+ | Download tool (for NATS) | Pre-installed on most systems |

### Platform-Specific Installation

#### macOS

```bash
# Using Homebrew
brew install make curl ffmpeg postgresql

# Bun (required)
curl -fsSL https://bun.sh/install | bash

# PM2 (required)
npm install -g pm2  # or: bun add -g pm2
```

#### Ubuntu / Debian

```bash
# System packages
sudo apt-get update
sudo apt-get install -y make curl ffmpeg postgresql-client

# Bun (required)
curl -fsSL https://bun.sh/install | bash

# PM2 (required)
npm install -g pm2  # or: bun add -g pm2
```

#### Fedora / RHEL

```bash
# System packages
sudo dnf install -y make curl ffmpeg postgresql

# Bun (required)
curl -fsSL https://bun.sh/install | bash

# PM2 (required)
npm install -g pm2  # or: bun add -g pm2
```

#### Windows (WSL2 Recommended)

```bash
# Use Ubuntu/Debian instructions in WSL2 terminal
# WSL2 setup: https://learn.microsoft.com/en-us/windows/wsl/install
```

---

## Optional Dependencies

These enhance functionality but are not required for basic setup:

| Tool | Purpose | When Needed | Install |
|------|---------|------------|---------|
| **ffmpeg** | Audio/video processing for WhatsApp voice notes | WhatsApp integration | `brew install ffmpeg` or `sudo apt-get install ffmpeg` |
| **PostgreSQL client** | Direct database access & administration | Manual DB work | `brew install postgresql` or `sudo apt-get install postgresql-client` |
| **Node.js** | Alternative JS runtime (not recommended - use bun) | Legacy compatibility | Skip - use bun instead |
| **Docker** | Containerized deployment | Production deployments | [Docker Desktop](https://www.docker.com/products/docker-desktop) |

---

## Automatic Installation

The dependency checker can auto-install missing tools:

```bash
# Check only
./scripts/check-dependencies.sh

# Auto-install missing required dependencies
./scripts/check-dependencies.sh --install
```

**Note:** Auto-installation requires:
- macOS: Homebrew installed
- Linux: sudo access (will prompt for password)
- Windows: WSL2 with sudo configured

---

## Managed Services (Auto-Handled)

These are **NOT** system dependencies - they're managed automatically:

| Service | How It's Managed | Configuration |
|---------|-----------------|----------------|
| **PostgreSQL** (pgserve) | PM2 + pgserve binary | `PGSERVE_MANAGED=true` in `.env` |
| **NATS** | PM2 + downloaded binary | `NATS_MANAGED=true` in `.env` |
| **API Server** | PM2 | `API_MANAGED=true` in `.env` |

When you run `make dev-services`, PM2 automatically starts these based on your `.env` config.

---

## Verification

After installation, verify everything is ready:

```bash
make check-deps    # Should show all ✓ for required items
make setup         # One-command setup (install + services + dev)
```

---

## Troubleshooting

### "command not found: make"
```bash
# macOS
brew install make

# Ubuntu/Debian
sudo apt-get install make

# Fedora
sudo dnf install make
```

### "command not found: bun"
```bash
curl -fsSL https://bun.sh/install | bash
# Then restart your terminal or: source ~/.bashrc
```

### "command not found: pm2"
```bash
npm install -g pm2
# or: bun add -g pm2
```

### "permission denied" on Linux
Most commands need `sudo`. If you don't have sudo:
```bash
su -
apt-get install make curl   # Debian/Ubuntu
# or
dnf install make curl       # Fedora
```

### macOS: "brew: command not found"
Install Homebrew first:
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

---

## Version Reference

Current versions tested and working:

| Tool | Tested Version |
|------|---|
| bun | 1.3.3+ |
| pm2 | 5.0+ |
| make | 4.3+ |
| Node.js (optional) | 20+ |
| PostgreSQL (client) | 14+ |
| ffmpeg (optional) | 5.0+ |
| Docker (optional) | 20.0+ |

---

## Next Steps

Once all requirements are installed:

```bash
make setup    # Complete setup in one command
```

This will:
1. ✓ Check dependencies
2. ✓ Install npm packages (`bun install`)
3. ✓ Create `.env` configuration
4. ✓ Initialize database schema
5. ✓ Start PostgreSQL + NATS via PM2
6. ✓ Start the API server
7. ✓ Open the dashboard

Then visit: **http://localhost:8882/api/v2/docs**
