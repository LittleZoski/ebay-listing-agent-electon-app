"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Debug: Log the electron module
const electronModule = require('electron');
console.log('Electron module type:', typeof electronModule);
console.log('Electron app type:', typeof electronModule.app);
console.log('Is default export?:', 'default' in electronModule);
const electron_1 = require("electron");
const child_process_1 = require("child_process");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const url_1 = require("url");
// Path to your existing Python eBay listing app
const PYTHON_APP_PATH = 'C:\\Users\\31243\\ebay-listing-app';
const ACCOUNTS_FILE = path_1.default.join(PYTHON_APP_PATH, 'ebay_accounts.json');
let mainWindow = null;
let pythonProcess = null;
let activeAccountId = null;
// ===== Load default values from Python .env file =====
function loadEnvDefaults() {
    try {
        const envPath = path_1.default.join(PYTHON_APP_PATH, '.env');
        if (!fs_1.default.existsSync(envPath)) {
            return {};
        }
        const envContent = fs_1.default.readFileSync(envPath, 'utf-8');
        const env = {};
        envContent.split('\n').forEach(line => {
            const match = line.match(/^([^=]+)=(.*)$/);
            if (match) {
                env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '');
            }
        });
        return {
            ebayAppId: env.EBAY_APP_ID || '',
            ebayCertId: env.EBAY_CERT_ID || '',
            ebayDevId: env.EBAY_DEV_ID || '',
            ebayRedirectUri: env.EBAY_REDIRECT_URI || '',
            ebayEnvironment: (env.EBAY_ENVIRONMENT?.toUpperCase() === 'SANDBOX' ? 'SANDBOX' : 'PRODUCTION'),
            // Business policies for Account 1
            paymentPolicyId: env.PAYMENT_POLICY_ID || '',
            returnPolicyId: env.RETURN_POLICY_ID || '',
            fulfillmentPolicyId: env.FULFILLMENT_POLICY_ID || '',
            // Business policies for Account 2
            paymentPolicyIdAccount2: env.PAYMENT_POLICY_ID_ACCOUNT2 || '',
            returnPolicyIdAccount2: env.RETURN_POLICY_ID_ACCOUNT2 || '',
            fulfillmentPolicyIdAccount2: env.FULFILLMENT_POLICY_ID_ACCOUNT2 || '',
            // Folders
            watchFolder: env.WATCH_FOLDER || 'c:\\Users\\31243\\Downloads',
            processedFolder: env.PROCESSED_FOLDER || path_1.default.join(PYTHON_APP_PATH, 'processed'),
            failedFolder: env.FAILED_FOLDER || path_1.default.join(PYTHON_APP_PATH, 'failed'),
            defaultCategoryId: env.DEFAULT_CATEGORY_ID || '11450',
            defaultMarketplace: env.DEFAULT_MARKETPLACE || 'EBAY_US',
            ebaySiteId: parseInt(env.EBAY_SITE_ID || '0', 10),
            defaultInventoryQuantity: parseInt(env.DEFAULT_INVENTORY_QUANTITY || '5', 10),
            anthropicApiKey: env.ANTHROPIC_API_KEY || '',
        };
    }
    catch (e) {
        console.error('Error loading .env defaults:', e);
        return {};
    }
}
// ===== eBay OAuth Functions =====
function getConsentUrl(account) {
    // Match Python's implementation exactly
    const baseUrl = account.ebayEnvironment === 'PRODUCTION'
        ? 'https://auth.ebay.com/oauth2/authorize'
        : 'https://auth.sandbox.ebay.com/oauth2/authorize';
    // Request all necessary scopes for listing creation and order fulfillment
    const scopes = [
        'https://api.ebay.com/oauth/api_scope/sell.inventory',
        'https://api.ebay.com/oauth/api_scope/sell.account',
        'https://api.ebay.com/oauth/api_scope/sell.marketing.readonly',
        'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
    ];
    // Build URL exactly like Python does (simple string concatenation, not URLSearchParams)
    // This ensures the redirect_uri is NOT double-encoded
    const consentUrl = `${baseUrl}` +
        `?client_id=${account.ebayAppId}` +
        `&redirect_uri=${account.ebayRedirectUri}` +
        `&response_type=code` +
        `&state=${account.id}` +
        `&scope=${scopes.join(' ')}`;
    return consentUrl;
}
function getAuthUrl(environment) {
    return environment === 'PRODUCTION'
        ? 'https://api.ebay.com/identity/v1/oauth2/token'
        : 'https://api.sandbox.ebay.com/identity/v1/oauth2/token';
}
async function exchangeCodeForToken(account, code) {
    const authUrl = getAuthUrl(account.ebayEnvironment);
    // Base64 encode credentials exactly like Python does
    const credentials = Buffer.from(`${account.ebayAppId}:${account.ebayCertId}`).toString('base64');
    const response = await fetch(authUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${credentials}`,
        },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: account.ebayRedirectUri,
        }).toString(),
    });
    if (!response.ok) {
        const errorText = await response.text();
        console.error('Token exchange error:', errorText);
        throw new Error(`Token exchange failed: ${errorText}`);
    }
    return response.json();
}
// ===== Account Storage Functions =====
function loadAccounts() {
    const defaults = loadEnvDefaults();
    try {
        if (fs_1.default.existsSync(ACCOUNTS_FILE)) {
            const data = JSON.parse(fs_1.default.readFileSync(ACCOUNTS_FILE, 'utf-8'));
            activeAccountId = data.activeAccountId;
            // Backfill missing credentials from .env defaults for existing accounts
            let needsSave = false;
            for (const account of data.accounts) {
                // eBay API credentials (shared across accounts in .env)
                if (!account.ebayAppId && defaults.ebayAppId) {
                    account.ebayAppId = defaults.ebayAppId;
                    needsSave = true;
                }
                if (!account.ebayCertId && defaults.ebayCertId) {
                    account.ebayCertId = defaults.ebayCertId;
                    needsSave = true;
                }
                if (!account.ebayDevId && defaults.ebayDevId) {
                    account.ebayDevId = defaults.ebayDevId;
                    needsSave = true;
                }
                if (!account.ebayRedirectUri && defaults.ebayRedirectUri) {
                    account.ebayRedirectUri = defaults.ebayRedirectUri;
                    needsSave = true;
                }
                if (!account.ebayEnvironment && defaults.ebayEnvironment) {
                    account.ebayEnvironment = defaults.ebayEnvironment;
                    needsSave = true;
                }
                // Business policies - use account-specific ones based on account id/name
                const isAccount2 = account.id === 'account_2' || account.name.toLowerCase().includes('2');
                if (!account.paymentPolicyId) {
                    const policyId = isAccount2 ? defaults.paymentPolicyIdAccount2 : defaults.paymentPolicyId;
                    if (policyId) {
                        account.paymentPolicyId = policyId;
                        needsSave = true;
                    }
                }
                if (!account.returnPolicyId) {
                    const policyId = isAccount2 ? defaults.returnPolicyIdAccount2 : defaults.returnPolicyId;
                    if (policyId) {
                        account.returnPolicyId = policyId;
                        needsSave = true;
                    }
                }
                if (!account.fulfillmentPolicyId) {
                    const policyId = isAccount2 ? defaults.fulfillmentPolicyIdAccount2 : defaults.fulfillmentPolicyId;
                    if (policyId) {
                        account.fulfillmentPolicyId = policyId;
                        needsSave = true;
                    }
                }
            }
            // Save if we backfilled any credentials
            if (needsSave) {
                console.log('Backfilled missing credentials from .env');
                saveAccounts(data);
            }
            return data;
        }
    }
    catch (e) {
        console.error('Error loading accounts:', e);
    }
    // Migrate from old token files if they exist, using .env defaults
    const accounts = [];
    // Check for existing Python token files
    for (let i = 1; i <= 2; i++) {
        const oldTokenFile = path_1.default.join(PYTHON_APP_PATH, `ebay_tokens_account${i}.json`);
        if (fs_1.default.existsSync(oldTokenFile)) {
            try {
                const tokenData = JSON.parse(fs_1.default.readFileSync(oldTokenFile, 'utf-8'));
                if (tokenData.access_token) {
                    accounts.push({
                        id: `account_${i}`,
                        name: `Account ${i}`,
                        isAuthorized: true,
                        tokenFile: oldTokenFile,
                        // Use defaults from .env
                        ebayAppId: defaults.ebayAppId || '',
                        ebayCertId: defaults.ebayCertId || '',
                        ebayDevId: defaults.ebayDevId || '',
                        ebayRedirectUri: defaults.ebayRedirectUri || '',
                        ebayEnvironment: defaults.ebayEnvironment || 'PRODUCTION',
                        // Business policies - try to read from .env based on account number
                        paymentPolicyId: '',
                        returnPolicyId: '',
                        fulfillmentPolicyId: '',
                        // Settings
                        defaultCategoryId: defaults.defaultCategoryId || '11450',
                        defaultMarketplace: defaults.defaultMarketplace || 'EBAY_US',
                        ebaySiteId: defaults.ebaySiteId || 0,
                        defaultInventoryQuantity: defaults.defaultInventoryQuantity || 5,
                        watchFolder: defaults.watchFolder || '',
                        processedFolder: defaults.processedFolder || '',
                        failedFolder: defaults.failedFolder || '',
                        createdAt: new Date().toISOString(),
                        lastAuthorized: tokenData.timestamp || new Date().toISOString(),
                    });
                }
            }
            catch (e) {
                console.error(`Error migrating account ${i}:`, e);
            }
        }
    }
    const data = {
        accounts,
        activeAccountId: accounts.length > 0 ? accounts[0].id : null,
        globalSettings: {
            anthropicApiKey: defaults.anthropicApiKey || '',
            maxWorkers: 2,
            useParallelProcessing: true,
            processingTimeoutSeconds: 1800,
        }
    };
    activeAccountId = data.activeAccountId;
    saveAccounts(data);
    return data;
}
function saveAccounts(data) {
    fs_1.default.writeFileSync(ACCOUNTS_FILE, JSON.stringify(data, null, 2));
}
function generateAccountId() {
    return `account_${Date.now()}`;
}
// ===== Window Creation =====
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
        width: 1400,
        height: 900,
        webPreferences: {
            preload: path_1.default.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
        titleBarStyle: 'hiddenInset',
        frame: true,
    });
    if (process.env.NODE_ENV === 'development' || !electron_1.app.isPackaged) {
        mainWindow.loadURL('http://localhost:5173');
        mainWindow.webContents.openDevTools();
    }
    else {
        mainWindow.loadFile(path_1.default.join(__dirname, '../dist/index.html'));
    }
    mainWindow.on('closed', () => {
        mainWindow = null;
        stopPythonProcess();
    });
    // Load accounts on startup
    loadAccounts();
}
electron_1.app.whenReady().then(createWindow);
electron_1.app.on('window-all-closed', () => {
    stopPythonProcess();
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
});
electron_1.app.on('activate', () => {
    if (electron_1.BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
// ===== IPC Handlers =====
// Get all accounts
electron_1.ipcMain.handle('get-accounts', async () => {
    const data = loadAccounts();
    // Verify each account's authorization status
    for (const account of data.accounts) {
        if (fs_1.default.existsSync(account.tokenFile)) {
            try {
                const tokenData = JSON.parse(fs_1.default.readFileSync(account.tokenFile, 'utf-8'));
                account.isAuthorized = !!tokenData.access_token;
            }
            catch {
                account.isAuthorized = false;
            }
        }
        else {
            account.isAuthorized = false;
        }
    }
    return {
        accounts: data.accounts,
        activeAccountId: data.activeAccountId,
        globalSettings: data.globalSettings,
    };
});
// Get .env defaults for new accounts
electron_1.ipcMain.handle('get-env-defaults', async () => {
    return loadEnvDefaults();
});
// Add a new account with full credentials
electron_1.ipcMain.handle('add-account', async (_event, accountData) => {
    const data = loadAccounts();
    const defaults = loadEnvDefaults();
    const id = generateAccountId();
    const tokenFile = path_1.default.join(PYTHON_APP_PATH, `ebay_tokens_${id}.json`);
    const newAccount = {
        id,
        name: accountData.name || `Account ${data.accounts.length + 1}`,
        isAuthorized: false,
        tokenFile,
        // eBay credentials - use provided or defaults
        ebayAppId: accountData.ebayAppId || defaults.ebayAppId || '',
        ebayCertId: accountData.ebayCertId || defaults.ebayCertId || '',
        ebayDevId: accountData.ebayDevId || defaults.ebayDevId || '',
        ebayRedirectUri: accountData.ebayRedirectUri || defaults.ebayRedirectUri || '',
        ebayEnvironment: accountData.ebayEnvironment || defaults.ebayEnvironment || 'PRODUCTION',
        // Business policies
        paymentPolicyId: accountData.paymentPolicyId || '',
        returnPolicyId: accountData.returnPolicyId || '',
        fulfillmentPolicyId: accountData.fulfillmentPolicyId || '',
        // Settings
        defaultCategoryId: accountData.defaultCategoryId || defaults.defaultCategoryId || '11450',
        defaultMarketplace: accountData.defaultMarketplace || defaults.defaultMarketplace || 'EBAY_US',
        ebaySiteId: accountData.ebaySiteId ?? defaults.ebaySiteId ?? 0,
        defaultInventoryQuantity: accountData.defaultInventoryQuantity ?? defaults.defaultInventoryQuantity ?? 5,
        watchFolder: accountData.watchFolder || defaults.watchFolder || '',
        processedFolder: accountData.processedFolder || defaults.processedFolder || '',
        failedFolder: accountData.failedFolder || defaults.failedFolder || '',
        createdAt: new Date().toISOString(),
    };
    data.accounts.push(newAccount);
    // If this is the first account, make it active
    if (data.accounts.length === 1) {
        data.activeAccountId = id;
        activeAccountId = id;
    }
    saveAccounts(data);
    return newAccount;
});
// Update an existing account
electron_1.ipcMain.handle('update-account', async (_event, accountId, updates) => {
    const data = loadAccounts();
    const account = data.accounts.find(a => a.id === accountId);
    if (!account) {
        throw new Error('Account not found');
    }
    // Update allowed fields (but not id, tokenFile, isAuthorized, timestamps)
    const allowedFields = [
        'name', 'ebayAppId', 'ebayCertId', 'ebayDevId', 'ebayRedirectUri', 'ebayEnvironment',
        'paymentPolicyId', 'returnPolicyId', 'fulfillmentPolicyId',
        'defaultCategoryId', 'defaultMarketplace', 'ebaySiteId', 'defaultInventoryQuantity',
        'watchFolder', 'processedFolder', 'failedFolder'
    ];
    for (const field of allowedFields) {
        if (updates[field] !== undefined) {
            account[field] = updates[field];
        }
    }
    saveAccounts(data);
    return { success: true, account };
});
// Remove an account
electron_1.ipcMain.handle('remove-account', async (_event, accountId) => {
    const data = loadAccounts();
    const accountIndex = data.accounts.findIndex(a => a.id === accountId);
    if (accountIndex === -1) {
        throw new Error('Account not found');
    }
    const account = data.accounts[accountIndex];
    // Delete token file if exists
    if (fs_1.default.existsSync(account.tokenFile)) {
        fs_1.default.unlinkSync(account.tokenFile);
    }
    data.accounts.splice(accountIndex, 1);
    // If we removed the active account, select another one
    if (data.activeAccountId === accountId) {
        data.activeAccountId = data.accounts.length > 0 ? data.accounts[0].id : null;
        activeAccountId = data.activeAccountId;
    }
    saveAccounts(data);
    return { success: true };
});
// Set active account
electron_1.ipcMain.handle('set-active-account', async (_event, accountId) => {
    const data = loadAccounts();
    const account = data.accounts.find(a => a.id === accountId);
    if (!account) {
        throw new Error('Account not found');
    }
    data.activeAccountId = accountId;
    activeAccountId = accountId;
    saveAccounts(data);
    return { success: true, activeAccountId: accountId };
});
// Start OAuth authorization - opens browser
electron_1.ipcMain.handle('start-authorization', async (_event, accountId) => {
    const data = loadAccounts();
    const account = data.accounts.find(a => a.id === accountId);
    if (!account) {
        throw new Error('Account not found');
    }
    // Validate required credentials
    if (!account.ebayAppId || !account.ebayCertId || !account.ebayRedirectUri) {
        throw new Error('Missing eBay API credentials. Please configure App ID, Cert ID, and Redirect URI first.');
    }
    // Generate consent URL using account's own credentials
    const consentUrl = getConsentUrl(account);
    console.log('Opening consent URL:', consentUrl);
    // Open in default browser
    electron_1.shell.openExternal(consentUrl);
    return { consentUrl, accountId };
});
// Complete authorization with callback URL (user pastes the redirect URL)
electron_1.ipcMain.handle('complete-authorization', async (_event, accountId, callbackUrl) => {
    const data = loadAccounts();
    const account = data.accounts.find(a => a.id === accountId);
    if (!account) {
        throw new Error('Account not found');
    }
    try {
        // Parse the callback URL to extract the authorization code
        const url = new url_1.URL(callbackUrl);
        const code = url.searchParams.get('code');
        if (!code) {
            throw new Error('No authorization code found in URL. Make sure you copied the full redirect URL.');
        }
        console.log('Exchanging authorization code for tokens...');
        // Exchange code for tokens using account's credentials
        const tokenData = await exchangeCodeForToken(account, code);
        // Save tokens to file
        const tokenContent = {
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token,
            expires_in: tokenData.expires_in,
            timestamp: new Date().toISOString(),
        };
        fs_1.default.writeFileSync(account.tokenFile, JSON.stringify(tokenContent, null, 2));
        // Update account status
        account.isAuthorized = true;
        account.lastAuthorized = new Date().toISOString();
        saveAccounts(data);
        console.log('Authorization successful!');
        return { success: true, account };
    }
    catch (error) {
        console.error('Authorization error:', error);
        throw new Error(`Authorization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
});
// Start the Python file watcher (main.py) for active account
electron_1.ipcMain.handle('start-file-watcher', async () => {
    if (pythonProcess) {
        return { success: false, message: 'File watcher is already running' };
    }
    if (!activeAccountId) {
        return { success: false, message: 'No active account selected' };
    }
    const data = loadAccounts();
    const account = data.accounts.find(a => a.id === activeAccountId);
    if (!account) {
        return { success: false, message: 'Active account not found' };
    }
    if (!account.isAuthorized) {
        return { success: false, message: 'Active account is not authorized. Please authorize first.' };
    }
    return new Promise((resolve) => {
        const pythonScript = path_1.default.join(PYTHON_APP_PATH, 'main.py');
        // Set environment variables for the Python process
        const env = {
            ...process.env,
            PYTHONIOENCODING: 'utf-8',
            EBAY_TOKEN_FILE: account.tokenFile,
        };
        pythonProcess = (0, child_process_1.spawn)('python', [pythonScript], {
            cwd: PYTHON_APP_PATH,
            shell: true,
            env,
        });
        pythonProcess.stdout?.on('data', (outData) => {
            console.log(`watcher stdout: ${outData}`);
            mainWindow?.webContents.send('watcher-output', { type: 'stdout', data: outData.toString() });
        });
        pythonProcess.stderr?.on('data', (errData) => {
            console.error(`watcher stderr: ${errData}`);
            mainWindow?.webContents.send('watcher-output', { type: 'stderr', data: errData.toString() });
        });
        pythonProcess.on('close', (code) => {
            console.log(`File watcher exited with code ${code}`);
            pythonProcess = null;
            mainWindow?.webContents.send('watcher-stopped', { code });
        });
        pythonProcess.on('error', (err) => {
            console.error('Failed to start file watcher:', err);
            pythonProcess = null;
        });
        setTimeout(() => {
            resolve({
                success: true,
                message: `File watcher started for ${account.name}`,
                accountId: activeAccountId,
                accountName: account.name,
            });
        }, 1000);
    });
});
// Stop the Python file watcher
electron_1.ipcMain.handle('stop-file-watcher', async () => {
    return stopPythonProcess();
});
// Get file watcher status
electron_1.ipcMain.handle('get-watcher-status', async () => {
    const data = loadAccounts();
    const account = activeAccountId ? data.accounts.find(a => a.id === activeAccountId) : null;
    return {
        running: pythonProcess !== null,
        activeAccountId,
        activeAccountName: account?.name || null,
    };
});
// Fetch orders using fetch_orders.py
electron_1.ipcMain.handle('fetch-orders', async (_event, accountId) => {
    const data = loadAccounts();
    const targetAccountId = accountId || activeAccountId;
    if (!targetAccountId) {
        throw new Error('No account specified');
    }
    const account = data.accounts.find(a => a.id === targetAccountId);
    if (!account) {
        throw new Error('Account not found');
    }
    if (!account.isAuthorized) {
        throw new Error('Account is not authorized');
    }
    return new Promise((resolve, reject) => {
        const pythonScript = path_1.default.join(PYTHON_APP_PATH, 'fetch_orders.py');
        const env = {
            ...process.env,
            PYTHONIOENCODING: 'utf-8',
            EBAY_TOKEN_FILE: account.tokenFile,
        };
        const fetchProcess = (0, child_process_1.spawn)('python', [pythonScript], {
            cwd: PYTHON_APP_PATH,
            shell: true,
            env,
        });
        let output = '';
        let errorOutput = '';
        fetchProcess.stdout?.on('data', (outData) => {
            output += outData.toString();
            console.log(`fetch_orders stdout: ${outData}`);
        });
        fetchProcess.stderr?.on('data', (errData) => {
            errorOutput += errData.toString();
            console.error(`fetch_orders stderr: ${errData}`);
        });
        fetchProcess.on('close', (code) => {
            if (code === 0) {
                const ordersDir = path_1.default.join(PYTHON_APP_PATH, 'ebay_orders');
                let orders = null;
                try {
                    if (fs_1.default.existsSync(ordersDir)) {
                        const files = fs_1.default.readdirSync(ordersDir)
                            .filter(f => f.endsWith('.json'))
                            .sort()
                            .reverse();
                        if (files.length > 0) {
                            const latestFile = path_1.default.join(ordersDir, files[0]);
                            orders = JSON.parse(fs_1.default.readFileSync(latestFile, 'utf-8'));
                        }
                    }
                }
                catch (e) {
                    console.error('Error reading orders:', e);
                }
                resolve({ success: true, output, orders, accountName: account.name });
            }
            else {
                reject(new Error(`Fetch orders failed: ${errorOutput || output}`));
            }
        });
        fetchProcess.on('error', (err) => {
            reject(err);
        });
    });
});
// Helper function to stop Python process
function stopPythonProcess() {
    if (pythonProcess) {
        try {
            if (process.platform === 'win32') {
                (0, child_process_1.spawn)('taskkill', ['/pid', pythonProcess.pid.toString(), '/f', '/t'], { shell: true });
            }
            else {
                pythonProcess.kill('SIGTERM');
            }
            pythonProcess = null;
            return { success: true, message: 'File watcher stopped' };
        }
        catch (e) {
            console.error('Error stopping Python process:', e);
            return { success: false, message: `Error: ${e}` };
        }
    }
    return { success: true, message: 'File watcher was not running' };
}
