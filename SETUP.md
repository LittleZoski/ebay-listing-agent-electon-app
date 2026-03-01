# eBay Seller App — Windows Deployment Guide

## Prerequisites

### 1. Node.js
Download and install **Node.js v18 or later** from https://nodejs.org
Choose the **LTS** version. This also installs `npm` automatically.

Verify installation:
```powershell
node --version
npm --version
```

### 2. Windows Developer Mode (required for packaging)
electron-builder needs to create symbolic links during packaging. Windows requires Developer Mode for this.

**Settings → System → For Developers → toggle "Developer Mode" ON**

You only need to do this once. Without it, `npm run package` will fail with a symlink permissions error.

---

## First-Time Setup

### Step 1 — Clone or copy the project
Place the project folder somewhere on your machine, e.g.:
```
C:\Users\YourName\ebay-seller-electron-app
```

### Step 2 — Install dependencies
Open PowerShell, navigate to the project folder, and run:
```powershell
cd "C:\Users\YourName\ebay-seller-electron-app"
npm install
```
This downloads all Node packages into `node_modules\`. Takes 1–3 minutes on first run.

### Step 3 — Verify TypeScript compiles clean
```powershell
npm run typecheck
```
No output means success. Fix any errors before continuing.

### Step 4 — Build and package the installer
```powershell
npm run package
```

This runs three steps automatically:
1. `vite build` — compiles the React UI into `dist\`
2. `build-electron.js` — compiles Electron TypeScript into `dist-electron\`
3. `electron-builder` — bundles everything into a Windows NSIS installer

Takes 2–5 minutes. On the very first run it downloads Electron binaries (~100 MB), so allow extra time.

### Step 5 — Find and run the installer
When complete, look in:
```
release\
└── eBay Seller App Setup 1.0.0.exe
```

Double-click the `.exe`. The installer will:
- Ask where to install (default: `C:\Program Files\eBay Seller App`)
- Create a Desktop shortcut
- Create a Start Menu shortcut

---

## Updating the App After Code Changes

Every time you make code changes, rebuild and reinstall:

```powershell
npm run package
```

Then double-click the new `release\eBay Seller App Setup 1.0.0.exe`. NSIS will upgrade the existing installation automatically. Your settings, accounts, and tokens are stored in AppData and are **not wiped on reinstall**.

---

## App Data Location

All persistent data lives in:
```
C:\Users\YourName\AppData\Roaming\ebay-seller-app\
```

| File / Folder | Contents |
|---|---|
| `ebay_accounts.json` | All accounts + global settings (pricing tiers, folders, API keys) |
| `tokens\` | eBay OAuth tokens per account |
| `processed\` | JSON files that have been processed by the watcher |
| `failed\` | JSON files that failed to process |
| `ebay_orders\` | Exported order JSON files |

This folder survives app reinstalls. To fully reset the app, delete this folder.

---

## Development Mode (no installer needed)

To run the app live with hot-reload during development:
```powershell
npm run dev
```

This starts Vite on `http://localhost:5173` and launches Electron pointing at it. DevTools open automatically. Changes to React components reflect instantly; changes to Electron main/preload require restarting.

---

## First Launch Checklist

After installing and opening the app for the first time:

1. **Settings → API Keys** — Enter your Anthropic API key (from https://console.anthropic.com)
2. **Accounts → Add Account** — Enter your eBay App ID, Cert ID, Dev ID, and Redirect URI (from https://developer.ebay.com/my/keys)
3. **Accounts → Authorize** — Click Authorize, complete the OAuth flow in your browser, paste the redirect URL back
4. **Accounts → Business Policies** — Enter your Payment, Return, and Fulfillment policy IDs
5. **Settings → Folders** — Set the watch folder (where your scraped JSON files will be dropped)
6. **Dashboard → Build Vector DB** — Run this once to build the eBay category index (takes a few minutes)
7. **Dashboard → Start Watcher** — The app is now live and will process JSON files dropped into the watch folder

---

## Pricing Tiers

The app supports source-specific pricing multipliers configurable in Settings:

| Source | Tiers Section |
|---|---|
| `source: "amazon"` | Amazon Pricing Tiers |
| `source: "yami"` | Yami Pricing Tiers |
| `source: "costco"` | Costco Pricing Tiers |

Each source has 7 tiers. Tiers 1–6 define a max price breakpoint and multiplier. Tier 7 applies to anything above Tier 6's max price. The app automatically selects the correct tier set based on the `source` field in your input JSON.

---

## Input JSON Format

The watch folder expects JSON files with this structure:

```json
{
  "products": [
    {
      "asin": "B08XYZ123",
      "title": "Product Title",
      "description": "Product description text",
      "bulletPoints": ["Feature 1", "Feature 2"],
      "images": ["https://example.com/image1.jpg"],
      "price": "$19.99",
      "deliveryFee": "Free",
      "source": "amazon",
      "specifications": {
        "Brand": "Example",
        "Material": "Cotton"
      }
    }
  ]
}
```

For **Costco products** (`"source": "costco"`), bullet points may contain embedded images in this format — they will be automatically extracted and rendered in the eBay listing description:
```json
"bulletPoints": [
  "Limit 5 per member",
  "[IMAGE]: https://content.syndigo.com/asset/abc123/480.webp"
]
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `npm run package` fails with symlink error | Ensure Windows Developer Mode is ON (Settings → System → For Developers) |
| Windows Defender blocks the installer | Click "More info" → "Run anyway" — expected for unsigned apps |
| App fails to start after install | Check `C:\Users\YourName\AppData\Roaming\ebay-seller-app\` exists and is writable |
| File watcher not starting | Confirm account is authorized AND all 3 business policy IDs are filled in |
| Products failing at "category" stage | Run Build Vector DB from the Dashboard first |
| Token expired errors | Re-authorize the account from the Accounts tab |
