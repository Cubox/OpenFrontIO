# Simple Deployment Guide for OpenFrontIO

## Overview

This guide will help you deploy OpenFrontIO on your server using your existing Caddy setup without Docker or third-party services.

## Requirements

- Node.js (v18+)
- npm
- Caddy server (already running)
- Domain: of.cubox.dev

## Setup Steps

### 1. Environment Configuration

Create a `.env` file with minimal config:

```bash
# Set the game environment to preprod
GAME_ENV=preprod

# Optional admin token (generate a secure random string)
ADMIN_TOKEN=your_secure_admin_token_here
```

**Note:** The app doesn't need DOMAIN/SUBDOMAIN environment variables for basic local deployment - those are only used for Cloudflare tunnels which we're skipping.

### 2. Install Dependencies and Build

```bash
npm install
npm run build-prod
```

### 3. Caddy Configuration

Add this section to your Caddyfile:

```caddy
of.cubox.dev {
    # Serve static files with caching
    @static {
        path *.js *.css *.png *.jpg *.jpeg *.gif *.svg *.webp *.woff *.woff2 *.ico
    }
    handle @static {
        header Cache-Control "public, max-age=31536000, immutable"
        reverse_proxy localhost:3564
    }

    # API endpoints with shorter cache
    handle /api/* {
        header Cache-Control "no-cache"
        reverse_proxy localhost:3564
    }

    # WebSocket connections for game workers (w0/, w1/, etc.)
    handle /w* {
        reverse_proxy localhost:3564
    }

    # Default handler for everything else
    handle {
        header Cache-Control "no-store"
        reverse_proxy localhost:3564
    }
}
```

### 4. Process Management

Create a systemd service file at `/etc/systemd/system/openfront.service`:

```ini
[Unit]
Description=OpenFront Game Server
After=network.target

[Service]
Type=simple
User=cubox
WorkingDirectory=/home/cubox/OpenFrontIO
Environment=NODE_ENV=production
Environment=GAME_ENV=preprod
ExecStart=/usr/bin/node --loader ts-node/esm --experimental-specifier-resolution=node src/server/Server.ts
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

### 5. Start Everything

1. Enable and start the service:

```bash
sudo systemctl enable openfront
sudo systemctl start openfront
```

2. Reload Caddy with new config:

```bash
sudo systemctl reload caddy
```

### 6. Verify Deployment

- Check service status: `sudo systemctl status openfront`
- Check logs: `sudo journalctl -u openfront -f`
- Visit: https://of.cubox.dev

## Notes

- The game master runs on port 3564
- Workers run on ports 3565, 3566, 3567, etc.
- All traffic goes through the master which routes to appropriate workers
- Static files are cached for 1 year
- API responses are not cached
- The service will auto-restart if it crashes

## Updating

To update:

```bash
cd /home/cubox/OpenFrontIO
git pull
npm install
npm run build-prod
sudo systemctl restart openfront
```
