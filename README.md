# eBay Seller Desktop App - MVP

A desktop application for managing your eBay dropshipping business with an AI chat interface.

## Features

- **Dashboard**: Overview and control panel
  - View eBay account authorization status
  - Authorize/re-authorize accounts (opens browser for OAuth)
  - Start/stop the file watcher (listing automation)
  - Fetch orders for any account
  - Activity log viewer

- **AI Chat**: Natural language control
  - "Start the file watcher"
  - "Stop the watcher"
  - "Check watcher status"
  - "Fetch orders for account 1"
  - "Check account status"

## Prerequisites

1. **Node.js** (v18 or later)
2. **Python** (3.8+) with your existing ebay-listing-app configured at `C:\Users\31243\ebay-listing-app`
3. **eBay Developer Account** with OAuth credentials configured in the Python app

## Installation

```bash
cd C:\Users\31243\ebay-seller-electron-app

# Install dependencies
npm install

# Run in development mode
npm run dev
```

## Project Structure

```
ebay-seller-electron-app/
├── electron/
│   ├── main.ts          # Electron main process (IPC handlers, Python bridge)
│   ├── preload.ts       # Secure API exposed to renderer
│   └── tsconfig.json    # TypeScript config for Electron
├── src/
│   ├── components/
│   │   ├── RootLayout.tsx   # App shell with sidebar navigation
│   │   ├── Dashboard.tsx    # Main control panel
│   │   └── Chat.tsx         # AI chat interface
│   ├── routes/
│   │   └── index.ts         # TanStack Router configuration
│   ├── main.tsx            # React entry point
│   └── index.css           # Tailwind styles
├── scripts/
│   └── build-electron.js   # Electron build script
├── package.json
└── README.md
```

## Available Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development mode (Vite + Electron) |
| `npm run build` | Build for production |
| `npm run package` | Package as distributable |

## How It Works

1. **Electron Main Process** (`electron/main.ts`):
   - Spawns Python scripts from your existing ebay-listing-app
   - Handles OAuth authorization by opening browser
   - Manages file watcher process (main.py)
   - Fetches orders using fetch_orders.py

2. **IPC Bridge** (`electron/preload.ts`):
   - Exposes secure APIs to the React frontend
   - Context isolation enabled for security

3. **React Frontend** (`src/`):
   - TanStack Router for navigation
   - TanStack Query for state management
   - Tailwind CSS for styling
   - AI Chat with tool execution

## Python Integration

The app connects to your existing Python codebase at:
```
C:\Users\31243\ebay-listing-app
```

It calls these Python scripts:
- `authorize_account.py <account_id>` - OAuth flow
- `main.py` - File watcher for listing automation
- `fetch_orders.py` - Fetch unshipped orders

## Next Steps (Future Development)

- [ ] Add Claude Agent SDK for advanced AI capabilities
- [ ] Implement customer service automation
- [ ] Add Chinese language support (i18n)
- [ ] Multi-account scaling (10+ accounts)
- [ ] SaaS transformation
