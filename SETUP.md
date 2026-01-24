# eBay Seller App Setup

## Prerequisites

- Node.js (v18 or higher recommended)
- npm

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/LittleZoski/ebay-listing-agent-electon-app.git
   cd ebay-listing-agent-electon-app
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file in the root directory with your API keys:
   ```
   ANTHROPIC_API_KEY=your_anthropic_api_key_here
   ```

## Running the App

### Development mode
```bash
npm run dev
```
This starts both the Vite dev server and Electron app with hot reload.

### Production build
```bash
npm run build
```

### Package for distribution
```bash
npm run package
```
The packaged app will be in the `release/` folder.

## Project Structure

- `src/` - React frontend code
- `electron/` - Electron main process code
- `dist/` - Vite build output (generated)
- `dist-electron/` - Electron build output (generated)