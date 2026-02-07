import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { spawn, ChildProcess } from 'child_process'
import path from 'path'
import fs from 'fs'
import { URL } from 'url'

// Import services
import { FileWatcher, loadProductsFromFile } from './services/fileWatcher'
import { getCategoryCache } from './services/categoryCache'
import { getVectorCategoryDB } from './services/vectorCategoryDB'
import { EbayListingService, ListingResult } from './services/ebayListingService'
import { EbayOrderService, FetchOrdersResult, EbayOrder, OrderExport } from './services/ebayOrderService'
import {
  EbayListingManagementService,
  FetchListingsResult,
  ListingDataExport,
  ListingSnapshot,
} from './services/ebayListingManagementService'
import type { GlobalSettings as ServiceGlobalSettings } from './services/productMapper'

// ===== App Data Directory =====
// Use Electron's userData path for all app data (tokens, accounts, etc.)
// This is platform-specific: %APPDATA% on Windows, ~/Library/Application Support on macOS
function getAppDataPath(): string {
  return app.getPath('userData')
}

// Lazy initialization since app.getPath() requires app to be ready
let APP_DATA_PATH: string
let ACCOUNTS_FILE: string
let TOKENS_DIR: string

function initPaths(): void {
  if (!APP_DATA_PATH) {
    APP_DATA_PATH = getAppDataPath()
    ACCOUNTS_FILE = path.join(APP_DATA_PATH, 'ebay_accounts.json')
    TOKENS_DIR = path.join(APP_DATA_PATH, 'tokens')

    // Ensure directories exist
    if (!fs.existsSync(APP_DATA_PATH)) {
      fs.mkdirSync(APP_DATA_PATH, { recursive: true })
    }
    if (!fs.existsSync(TOKENS_DIR)) {
      fs.mkdirSync(TOKENS_DIR, { recursive: true })
    }

    console.log('App data path:', APP_DATA_PATH)
  }
}

let mainWindow: BrowserWindow | null = null
let pythonProcess: ChildProcess | null = null
let activeAccountId: string | null = null
let fileWatcher: FileWatcher | null = null

// ===== Account Management Types =====
// Full account model matching .env parameters
interface EbayAccount {
  id: string
  name: string
  isAuthorized: boolean
  tokenFile: string

  // eBay API Credentials (per account)
  ebayAppId: string
  ebayCertId: string
  ebayDevId: string
  ebayRedirectUri: string
  ebayEnvironment: 'SANDBOX' | 'PRODUCTION'

  // Business Policies
  paymentPolicyId: string
  returnPolicyId: string
  fulfillmentPolicyId: string

  // Listing Settings
  defaultCategoryId: string
  defaultMarketplace: string
  ebaySiteId: number
  defaultInventoryQuantity: number

  // Folder Settings (can be per-account or shared)
  watchFolder: string
  processedFolder: string
  failedFolder: string

  // Timestamps
  createdAt: string
  lastAuthorized?: string
}

interface GlobalSettings {
  // API Keys
  anthropicApiKey: string

  // Processing Settings
  maxWorkers: number
  useParallelProcessing: boolean
  processingTimeoutSeconds: number

  // Folder Settings
  watchFolder: string
  processedFolder: string
  failedFolder: string
  ordersExportFolder: string

  // Amazon Pricing Tiers (7 tiers)
  amazonTier1MaxPrice: number
  amazonTier1Multiplier: number
  amazonTier2MaxPrice: number
  amazonTier2Multiplier: number
  amazonTier3MaxPrice: number
  amazonTier3Multiplier: number
  amazonTier4MaxPrice: number
  amazonTier4Multiplier: number
  amazonTier5MaxPrice: number
  amazonTier5Multiplier: number
  amazonTier6MaxPrice: number
  amazonTier6Multiplier: number
  amazonTier7Multiplier: number

  // Yami Pricing Tiers (7 tiers)
  yamiTier1MaxPrice: number
  yamiTier1Multiplier: number
  yamiTier2MaxPrice: number
  yamiTier2Multiplier: number
  yamiTier3MaxPrice: number
  yamiTier3Multiplier: number
  yamiTier4MaxPrice: number
  yamiTier4Multiplier: number
  yamiTier5MaxPrice: number
  yamiTier5Multiplier: number
  yamiTier6MaxPrice: number
  yamiTier6Multiplier: number
  yamiTier7Multiplier: number

  // Costco Pricing Tiers (7 tiers)
  costcoTier1MaxPrice: number
  costcoTier1Multiplier: number
  costcoTier2MaxPrice: number
  costcoTier2Multiplier: number
  costcoTier3MaxPrice: number
  costcoTier3Multiplier: number
  costcoTier4MaxPrice: number
  costcoTier4Multiplier: number
  costcoTier5MaxPrice: number
  costcoTier5Multiplier: number
  costcoTier6MaxPrice: number
  costcoTier6Multiplier: number
  costcoTier7Multiplier: number

  // Charm Pricing Strategy
  charmPricingStrategy: 'always_99' | 'always_49' | 'tiered'

  // Default Listing Settings
  defaultCategoryId: string
  defaultMarketplace: string
  defaultInventoryQuantity: number

  // Category Selection Settings
  categoryCandidatesTopK: number
}

interface AccountsData {
  accounts: EbayAccount[]
  activeAccountId: string | null
  globalSettings: GlobalSettings
}

// ===== Default values for global settings =====
function getDefaultGlobalSettings(): GlobalSettings {
  initPaths()
  return {
    // API Keys
    anthropicApiKey: '',

    // Processing Settings
    maxWorkers: 2,
    useParallelProcessing: true,
    processingTimeoutSeconds: 1800,

    // Folder Settings
    watchFolder: 'c:\\Users\\31243\\Downloads',
    processedFolder: path.join(APP_DATA_PATH, 'processed'),
    failedFolder: path.join(APP_DATA_PATH, 'failed'),
    ordersExportFolder: path.join(APP_DATA_PATH, 'ebay_orders'),

    // Amazon Pricing Tiers (matching Python config.py defaults)
    amazonTier1MaxPrice: 10,
    amazonTier1Multiplier: 2.5,
    amazonTier2MaxPrice: 15,
    amazonTier2Multiplier: 2.3,
    amazonTier3MaxPrice: 20,
    amazonTier3Multiplier: 2.1,
    amazonTier4MaxPrice: 30,
    amazonTier4Multiplier: 1.95,
    amazonTier5MaxPrice: 40,
    amazonTier5Multiplier: 1.85,
    amazonTier6MaxPrice: 60,
    amazonTier6Multiplier: 1.75,
    amazonTier7Multiplier: 1.65,

    // Yami Pricing Tiers (matching Python config.py defaults)
    yamiTier1MaxPrice: 8,
    yamiTier1Multiplier: 2.8,
    yamiTier2MaxPrice: 12,
    yamiTier2Multiplier: 2.5,
    yamiTier3MaxPrice: 18,
    yamiTier3Multiplier: 2.3,
    yamiTier4MaxPrice: 25,
    yamiTier4Multiplier: 2.1,
    yamiTier5MaxPrice: 35,
    yamiTier5Multiplier: 1.95,
    yamiTier6MaxPrice: 50,
    yamiTier6Multiplier: 1.85,
    yamiTier7Multiplier: 1.75,

    // Costco Pricing Tiers (warehouse club pricing)
    costcoTier1MaxPrice: 15,
    costcoTier1Multiplier: 2.2,
    costcoTier2MaxPrice: 25,
    costcoTier2Multiplier: 2.0,
    costcoTier3MaxPrice: 40,
    costcoTier3Multiplier: 1.85,
    costcoTier4MaxPrice: 60,
    costcoTier4Multiplier: 1.7,
    costcoTier5MaxPrice: 80,
    costcoTier5Multiplier: 1.6,
    costcoTier6MaxPrice: 100,
    costcoTier6Multiplier: 1.5,
    costcoTier7Multiplier: 1.4,

    // Charm Pricing Strategy
    charmPricingStrategy: 'always_99',

    // Default Listing Settings
    defaultCategoryId: '11450',
    defaultMarketplace: 'EBAY_US',
    defaultInventoryQuantity: 3,

    // Category Selection Settings
    categoryCandidatesTopK: 3,
  }
}

// ===== Default values for new accounts =====
function getDefaultAccountSettings(): Partial<EbayAccount> {
  initPaths()
  return {
    ebayAppId: '',
    ebayCertId: '',
    ebayDevId: '',
    ebayRedirectUri: '',
    ebayEnvironment: 'PRODUCTION',
    paymentPolicyId: '',
    returnPolicyId: '',
    fulfillmentPolicyId: '',
    defaultCategoryId: '11450',
    defaultMarketplace: 'EBAY_US',
    ebaySiteId: 0,
    defaultInventoryQuantity: 5,
    watchFolder: '',
    processedFolder: path.join(APP_DATA_PATH, 'processed'),
    failedFolder: path.join(APP_DATA_PATH, 'failed'),
  }
}

// Generate token file path for an account
function getTokenFilePath(accountId: string): string {
  initPaths()
  return path.join(TOKENS_DIR, `${accountId}_token.json`)
}

// ===== eBay OAuth Functions =====
function getConsentUrl(account: EbayAccount): string {
  const baseUrl = account.ebayEnvironment === 'PRODUCTION'
    ? 'https://auth.ebay.com/oauth2/authorize'
    : 'https://auth.sandbox.ebay.com/oauth2/authorize'

  // Request all necessary scopes for listing creation and order fulfillment
  const scopes = [
    'https://api.ebay.com/oauth/api_scope/sell.inventory',
    'https://api.ebay.com/oauth/api_scope/sell.account',
    'https://api.ebay.com/oauth/api_scope/sell.marketing.readonly',
    'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
  ]

  // URL-encode the scopes (spaces become %20)
  const encodedScopes = encodeURIComponent(scopes.join(' '))

  // Build consent URL - redirect_uri should NOT be encoded as eBay expects it as-is
  const consentUrl =
    `${baseUrl}` +
    `?client_id=${account.ebayAppId}` +
    `&redirect_uri=${account.ebayRedirectUri}` +
    `&response_type=code` +
    `&state=${account.id}` +
    `&scope=${encodedScopes}`

  console.log('Generated consent URL:', consentUrl)
  return consentUrl
}

function getAuthUrl(environment: 'SANDBOX' | 'PRODUCTION'): string {
  return environment === 'PRODUCTION'
    ? 'https://api.ebay.com/identity/v1/oauth2/token'
    : 'https://api.sandbox.ebay.com/identity/v1/oauth2/token'
}

async function exchangeCodeForToken(account: EbayAccount, code: string): Promise<{
  access_token: string
  refresh_token: string
  expires_in: number
}> {
  const authUrl = getAuthUrl(account.ebayEnvironment)

  // Base64 encode credentials exactly like Python does
  const credentials = Buffer.from(`${account.ebayAppId}:${account.ebayCertId}`).toString('base64')

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
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error('Token exchange error:', errorText)
    throw new Error(`Token exchange failed: ${errorText}`)
  }

  return response.json()
}

// ===== Account Storage Functions =====
function loadAccounts(): AccountsData {
  initPaths()

  try {
    if (fs.existsSync(ACCOUNTS_FILE)) {
      const data = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf-8')) as AccountsData
      activeAccountId = data.activeAccountId
      return data
    }
  } catch (e) {
    console.error('Error loading accounts:', e)
  }

  // Return empty accounts data if no file exists
  const data: AccountsData = {
    accounts: [],
    activeAccountId: null,
    globalSettings: getDefaultGlobalSettings(),
  }

  activeAccountId = data.activeAccountId
  saveAccounts(data)
  return data
}

function saveAccounts(data: AccountsData): void {
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(data, null, 2))
}

function generateAccountId(): string {
  return `account_${Date.now()}`
}

// ===== Window Creation =====
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: 'hiddenInset',
    frame: true,
  })

  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
    stopPythonProcess()
  })

  // Load accounts on startup
  loadAccounts()
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  stopPythonProcess()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// ===== IPC Handlers =====

// Check if a token is valid (exists and not expired)
function isTokenValid(tokenFile: string): boolean {
  if (!fs.existsSync(tokenFile)) {
    return false
  }

  try {
    const tokenData = JSON.parse(fs.readFileSync(tokenFile, 'utf-8'))

    // Must have access_token
    if (!tokenData.access_token) {
      return false
    }

    // Check if token is expired (if expiry info is available)
    if (tokenData.token_expiry) {
      const now = Date.now() / 1000 // Current time in seconds
      if (now >= tokenData.token_expiry) {
        // Token expired, but we can still use refresh_token
        return !!tokenData.refresh_token
      }
    }

    return true
  } catch {
    return false
  }
}

// Check if account has required credentials for authorization
function hasRequiredCredentials(account: EbayAccount): boolean {
  return !!(account.ebayAppId && account.ebayCertId && account.ebayRedirectUri)
}

// Get all accounts
ipcMain.handle('get-accounts', async () => {
  const data = loadAccounts()

  // Verify each account's authorization status
  for (const account of data.accounts) {
    // Account is authorized only if token file exists and is valid
    account.isAuthorized = isTokenValid(account.tokenFile)
  }

  return {
    accounts: data.accounts,
    activeAccountId: data.activeAccountId,
    globalSettings: data.globalSettings,
  }
})

// Get default settings for new accounts
ipcMain.handle('get-env-defaults', async () => {
  return getDefaultAccountSettings()
})

// Get global settings
ipcMain.handle('get-global-settings', async () => {
  const data = loadAccounts()
  // Merge with defaults to ensure all fields exist
  return { ...getDefaultGlobalSettings(), ...data.globalSettings }
})

// Update global settings
ipcMain.handle('update-global-settings', async (_event: Electron.IpcMainInvokeEvent, updates: Partial<GlobalSettings>) => {
  const data = loadAccounts()

  // Merge updates with existing settings
  data.globalSettings = {
    ...getDefaultGlobalSettings(),
    ...data.globalSettings,
    ...updates,
  }

  saveAccounts(data)
  return { success: true, globalSettings: data.globalSettings }
})

// Add a new account with full credentials
ipcMain.handle('add-account', async (_event: Electron.IpcMainInvokeEvent, accountData: Partial<EbayAccount>) => {
  const data = loadAccounts()
  const defaults = getDefaultAccountSettings()
  const id = generateAccountId()
  const tokenFile = getTokenFilePath(id)

  const newAccount: EbayAccount = {
    id,
    name: accountData.name || `Account ${data.accounts.length + 1}`,
    isAuthorized: false,
    tokenFile,
    // eBay credentials - must be provided by user
    ebayAppId: accountData.ebayAppId || '',
    ebayCertId: accountData.ebayCertId || '',
    ebayDevId: accountData.ebayDevId || '',
    ebayRedirectUri: accountData.ebayRedirectUri || '',
    ebayEnvironment: accountData.ebayEnvironment || 'PRODUCTION',
    // Business policies - must be provided by user
    paymentPolicyId: accountData.paymentPolicyId || '',
    returnPolicyId: accountData.returnPolicyId || '',
    fulfillmentPolicyId: accountData.fulfillmentPolicyId || '',
    // Settings - use defaults
    defaultCategoryId: accountData.defaultCategoryId || defaults.defaultCategoryId || '11450',
    defaultMarketplace: accountData.defaultMarketplace || defaults.defaultMarketplace || 'EBAY_US',
    ebaySiteId: accountData.ebaySiteId ?? defaults.ebaySiteId ?? 0,
    defaultInventoryQuantity: accountData.defaultInventoryQuantity ?? defaults.defaultInventoryQuantity ?? 5,
    watchFolder: accountData.watchFolder || '',
    processedFolder: accountData.processedFolder || defaults.processedFolder || '',
    failedFolder: accountData.failedFolder || defaults.failedFolder || '',
    createdAt: new Date().toISOString(),
  }

  data.accounts.push(newAccount)

  // If this is the first account, make it active
  if (data.accounts.length === 1) {
    data.activeAccountId = id
    activeAccountId = id
  }

  saveAccounts(data)
  return newAccount
})

// Update an existing account
ipcMain.handle('update-account', async (_event: Electron.IpcMainInvokeEvent, accountId: string, updates: Partial<EbayAccount>) => {
  const data = loadAccounts()
  const account = data.accounts.find(a => a.id === accountId)

  if (!account) {
    throw new Error('Account not found')
  }

  // Update allowed fields (but not id, tokenFile, isAuthorized, timestamps)
  const allowedFields: (keyof EbayAccount)[] = [
    'name', 'ebayAppId', 'ebayCertId', 'ebayDevId', 'ebayRedirectUri', 'ebayEnvironment',
    'paymentPolicyId', 'returnPolicyId', 'fulfillmentPolicyId',
    'defaultCategoryId', 'defaultMarketplace', 'ebaySiteId', 'defaultInventoryQuantity',
    'watchFolder', 'processedFolder', 'failedFolder'
  ]

  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      (account as unknown as Record<string, unknown>)[field] = updates[field]
    }
  }

  saveAccounts(data)
  return { success: true, account }
})

// Remove an account
ipcMain.handle('remove-account', async (_event: Electron.IpcMainInvokeEvent, accountId: string) => {
  const data = loadAccounts()
  const accountIndex = data.accounts.findIndex(a => a.id === accountId)

  if (accountIndex === -1) {
    throw new Error('Account not found')
  }

  const account = data.accounts[accountIndex]

  // Delete token file if exists
  if (fs.existsSync(account.tokenFile)) {
    fs.unlinkSync(account.tokenFile)
  }

  data.accounts.splice(accountIndex, 1)

  // If we removed the active account, select another one
  if (data.activeAccountId === accountId) {
    data.activeAccountId = data.accounts.length > 0 ? data.accounts[0].id : null
    activeAccountId = data.activeAccountId
  }

  saveAccounts(data)
  return { success: true }
})

// Set active account
ipcMain.handle('set-active-account', async (_event: Electron.IpcMainInvokeEvent, accountId: string) => {
  const data = loadAccounts()
  const account = data.accounts.find(a => a.id === accountId)

  if (!account) {
    throw new Error('Account not found')
  }

  data.activeAccountId = accountId
  activeAccountId = accountId
  saveAccounts(data)

  return { success: true, activeAccountId: accountId }
})

// Start OAuth authorization - opens browser
ipcMain.handle('start-authorization', async (_event: Electron.IpcMainInvokeEvent, accountId: string) => {
  const data = loadAccounts()
  const account = data.accounts.find(a => a.id === accountId)

  if (!account) {
    throw new Error('Account not found')
  }

  // Validate required credentials
  if (!account.ebayAppId || !account.ebayCertId || !account.ebayRedirectUri) {
    throw new Error('Missing eBay API credentials. Please configure App ID, Cert ID, and Redirect URI first.')
  }

  // Generate consent URL using account's own credentials
  const consentUrl = getConsentUrl(account)

  console.log('Opening consent URL:', consentUrl)

  // Open in default browser
  shell.openExternal(consentUrl)

  return { consentUrl, accountId }
})

// Complete authorization with callback URL (user pastes the redirect URL)
ipcMain.handle('complete-authorization', async (_event: Electron.IpcMainInvokeEvent, accountId: string, callbackUrl: string) => {
  const data = loadAccounts()
  const account = data.accounts.find(a => a.id === accountId)

  if (!account) {
    throw new Error('Account not found')
  }

  try {
    // Parse the callback URL to extract the authorization code
    const url = new URL(callbackUrl)
    const code = url.searchParams.get('code')

    if (!code) {
      throw new Error('No authorization code found in URL. Make sure you copied the full redirect URL.')
    }

    console.log('Exchanging authorization code for tokens...')

    // Exchange code for tokens using account's credentials
    const tokenData = await exchangeCodeForToken(account, code)

    // Save tokens to file
    const tokenContent = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_in: tokenData.expires_in,
      timestamp: new Date().toISOString(),
    }

    fs.writeFileSync(account.tokenFile, JSON.stringify(tokenContent, null, 2))

    // Update account status
    account.isAuthorized = true
    account.lastAuthorized = new Date().toISOString()
    saveAccounts(data)

    console.log('Authorization successful!')
    return { success: true, account }
  } catch (error) {
    console.error('Authorization error:', error)
    throw new Error(`Authorization failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
})

// Start the native file watcher for active account
ipcMain.handle('start-file-watcher', async () => {
  if (fileWatcher) {
    return { success: false, message: 'File watcher is already running' }
  }

  if (!activeAccountId) {
    return { success: false, message: 'No active account selected' }
  }

  const data = loadAccounts()
  const account = data.accounts.find(a => a.id === activeAccountId)

  if (!account) {
    return { success: false, message: 'Active account not found' }
  }

  if (!account.isAuthorized) {
    return { success: false, message: 'Active account is not authorized. Please authorize first.' }
  }

  // Check for Anthropic API key
  if (!data.globalSettings.anthropicApiKey) {
    return { success: false, message: 'Anthropic API key not configured. Please set it in Settings.' }
  }

  // Check for business policies
  if (!account.paymentPolicyId || !account.returnPolicyId || !account.fulfillmentPolicyId) {
    return { success: false, message: 'Business policies not configured for this account.' }
  }

  try {
    // Initialize file watcher with settings
    initPaths()
    fileWatcher = new FileWatcher({
      watchFolder: data.globalSettings.watchFolder || 'c:\\Users\\31243\\Downloads',
      processedFolder: data.globalSettings.processedFolder || path.join(APP_DATA_PATH, 'processed'),
      failedFolder: data.globalSettings.failedFolder || path.join(APP_DATA_PATH, 'failed'),
    })

    // Set up event listeners
    fileWatcher.on('log', (message: string, level: string) => {
      const logMessage = `[${level.toUpperCase()}] ${message}`
      console.log(logMessage)
      if (mainWindow) {
        mainWindow.webContents.send('watcher-output', { type: level, data: logMessage })
      }
    })

    fileWatcher.on('file-detected', (filePath: string, fileName: string) => {
      console.log(`File detected: ${fileName}`)
    })

    fileWatcher.on('processing-start', (filePath: string, remaining: number) => {
      if (mainWindow) {
        mainWindow.webContents.send('watcher-output', {
          type: 'info',
          data: `Processing: ${path.basename(filePath)} (${remaining} files remaining in queue)`,
        })
      }
    })

    fileWatcher.on('processing-complete', (filePath: string, success: boolean, error?: string) => {
      if (mainWindow) {
        mainWindow.webContents.send('watcher-output', {
          type: success ? 'info' : 'error',
          data: success
            ? `Completed: ${path.basename(filePath)}`
            : `Failed: ${path.basename(filePath)} - ${error}`,
        })
      }
    })

    // Set the process callback to use our native listing service
    fileWatcher.setProcessCallback(async (processedFilePath: string) => {
      return await processJsonFile(processedFilePath, account, data.globalSettings)
    })

    // Start watching
    fileWatcher.start()

    return {
      success: true,
      message: `File watcher started for ${account.name}`,
      accountId: account.id,
      accountName: account.name,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('Error starting file watcher:', errorMessage)
    fileWatcher = null
    return { success: false, message: `Failed to start file watcher: ${errorMessage}` }
  }
})

// Stop the native file watcher
ipcMain.handle('stop-file-watcher', async () => {
  if (fileWatcher) {
    try {
      await fileWatcher.stop()
      fileWatcher = null
      return { success: true, message: 'File watcher stopped' }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error('Error stopping file watcher:', errorMessage)
      return { success: false, message: `Error: ${errorMessage}` }
    }
  }

  // Also stop any legacy Python process
  return stopPythonProcess()
})

// Get file watcher status
ipcMain.handle('get-watcher-status', async () => {
  const data = loadAccounts()
  const account = activeAccountId ? data.accounts.find(a => a.id === activeAccountId) : null

  // Check native file watcher first, then fall back to legacy Python process
  const isRunning = fileWatcher !== null || pythonProcess !== null

  return {
    running: isRunning,
    activeAccountId,
    activeAccountName: account?.name || null,
  }
})

// Get Vector DB status
ipcMain.handle('get-vector-db-status', async () => {
  try {
    const vectorDB = getVectorCategoryDB()
    return {
      initialized: vectorDB.hasData(),
      categoryCount: vectorDB.getCategoryCount(),
    }
  } catch (error) {
    return {
      initialized: false,
      categoryCount: 0,
      error: error instanceof Error ? error.message : String(error),
    }
  }
})

// Build Vector DB manually
ipcMain.handle('build-vector-db', async () => {
  try {
    const data = loadAccounts()

    // Need eBay credentials to initialize category cache
    const account = data.accounts.find(a => a.isAuthorized)
    if (!account) {
      throw new Error('No authorized account found. Please authorize an account first.')
    }

    console.log('[VectorDB] Starting manual build...')

    // Initialize category cache
    const categoryCache = getCategoryCache()
    const credentials = {
      appId: account.ebayAppId,
      certId: account.ebayCertId,
      environment: account.ebayEnvironment as 'SANDBOX' | 'PRODUCTION',
    }

    console.log('[VectorDB] Initializing category cache...')
    await categoryCache.initialize(credentials)
    console.log(`[VectorDB] Category cache loaded with ${categoryCache.getCategoryCount()} categories`)

    // Build vector DB
    const vectorDB = getVectorCategoryDB()
    console.log('[VectorDB] Building vector index (this may take a few minutes on first run)...')
    await vectorDB.initializeFromCache(categoryCache, true) // Force rebuild

    console.log(`[VectorDB] Build complete! ${vectorDB.getCategoryCount()} categories indexed.`)

    return {
      success: true,
      categoryCount: vectorDB.getCategoryCount(),
    }
  } catch (error) {
    console.error('[VectorDB] Build failed:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
})

// Fetch orders - Native implementation using eBay Fulfillment API
ipcMain.handle('fetch-orders', async (_event: Electron.IpcMainInvokeEvent, accountId?: string): Promise<FetchOrdersResult> => {
  const data = loadAccounts()
  const targetAccountId = accountId || activeAccountId

  if (!targetAccountId) {
    throw new Error('No account specified')
  }

  const account = data.accounts.find(a => a.id === targetAccountId)
  if (!account) {
    throw new Error('Account not found')
  }

  if (!account.isAuthorized) {
    throw new Error('Account is not authorized')
  }

  // Get global settings for export folder
  const globalSettings = data.globalSettings || getDefaultGlobalSettings()

  // Create order service with account details and configured export folder
  const orderService = new EbayOrderService(
    {
      id: account.id,
      ebayAppId: account.ebayAppId,
      ebayCertId: account.ebayCertId,
      ebayEnvironment: account.ebayEnvironment,
      tokenFile: account.tokenFile,
    },
    account.name,
    globalSettings.ordersExportFolder
  )

  // Fetch orders
  const result = await orderService.fetchOrders()

  // Send progress to UI if we have a window
  if (mainWindow && result.success) {
    mainWindow.webContents.send('orders-fetched', {
      accountName: result.accountName,
      totalOrders: result.totalOrders,
      orders: result.orders,
    })
  }

  return result
})

// Get stored orders from a previous export
ipcMain.handle('get-stored-orders', async (_event: Electron.IpcMainInvokeEvent, filePath?: string): Promise<OrderExport | null> => {
  if (filePath) {
    return EbayOrderService.loadExportedOrders(filePath)
  }
  return null
})

// List exported order files
ipcMain.handle('list-order-exports', async (_event: Electron.IpcMainInvokeEvent, accountId?: string): Promise<{ files: string[], folder: string }> => {
  const data = loadAccounts()
  const targetAccountId = accountId || activeAccountId

  if (!targetAccountId) {
    return { files: [], folder: '' }
  }

  const account = data.accounts.find(a => a.id === targetAccountId)
  if (!account) {
    return { files: [], folder: '' }
  }

  // Get global settings for export folder
  const globalSettings = data.globalSettings || getDefaultGlobalSettings()

  const orderService = new EbayOrderService(
    {
      id: account.id,
      ebayAppId: account.ebayAppId,
      ebayCertId: account.ebayCertId,
      ebayEnvironment: account.ebayEnvironment,
      tokenFile: account.tokenFile,
    },
    account.name,
    globalSettings.ordersExportFolder
  )

  return {
    files: orderService.listExportedOrderFiles(),
    folder: orderService.getOutputFolder(),
  }
})

// ===== Listing Management IPC Handlers =====

// Fetch all listings for an account
ipcMain.handle('fetch-listings', async (
  _event: Electron.IpcMainInvokeEvent,
  accountId?: string
): Promise<FetchListingsResult> => {
  const data = loadAccounts()
  const targetAccountId = accountId || activeAccountId

  if (!targetAccountId) {
    throw new Error('No account specified')
  }

  const account = data.accounts.find(a => a.id === targetAccountId)
  if (!account) {
    throw new Error('Account not found')
  }

  if (!account.isAuthorized) {
    throw new Error('Account is not authorized')
  }

  // Create listing management service
  const listingService = new EbayListingManagementService(
    {
      id: account.id,
      ebayAppId: account.ebayAppId,
      ebayCertId: account.ebayCertId,
      ebayEnvironment: account.ebayEnvironment,
      tokenFile: account.tokenFile,
    },
    account.name
  )

  // Set up progress callback to send updates to UI
  listingService.setProgressCallback((progress) => {
    if (mainWindow) {
      mainWindow.webContents.send('listings-progress', progress)
    }
  })

  // Fetch listings
  const result = await listingService.fetchAllListings()

  // Send completion event to UI
  if (mainWindow && result.success) {
    mainWindow.webContents.send('listings-fetched', {
      accountName: result.accountName,
      totalListings: result.totalListings,
      newListings: result.newListings,
      updatedListings: result.updatedListings,
    })
  }

  return result
})

// Get stored listings from last fetch
ipcMain.handle('get-stored-listings', async (
  _event: Electron.IpcMainInvokeEvent,
  accountId?: string
): Promise<ListingDataExport | null> => {
  const data = loadAccounts()
  const targetAccountId = accountId || activeAccountId

  if (!targetAccountId) {
    return null
  }

  const account = data.accounts.find(a => a.id === targetAccountId)
  if (!account) {
    return null
  }

  const listingService = new EbayListingManagementService(
    {
      id: account.id,
      ebayAppId: account.ebayAppId,
      ebayCertId: account.ebayCertId,
      ebayEnvironment: account.ebayEnvironment,
      tokenFile: account.tokenFile,
    },
    account.name
  )

  return listingService.getStoredListings()
})

// Get listing history for performance tracking
ipcMain.handle('get-listing-history', async (
  _event: Electron.IpcMainInvokeEvent,
  accountId: string,
  listingId?: string,
  dateRange?: { start: string; end: string }
): Promise<ListingSnapshot[]> => {
  const data = loadAccounts()
  const account = data.accounts.find(a => a.id === accountId)

  if (!account) {
    return []
  }

  const listingService = new EbayListingManagementService(
    {
      id: account.id,
      ebayAppId: account.ebayAppId,
      ebayCertId: account.ebayCertId,
      ebayEnvironment: account.ebayEnvironment,
      tokenFile: account.tokenFile,
    },
    account.name
  )

  return listingService.getListingHistory(listingId, dateRange)
})

// List exported listing files
ipcMain.handle('list-listing-exports', async (
  _event: Electron.IpcMainInvokeEvent,
  accountId?: string
): Promise<{ files: string[]; folder: string }> => {
  const data = loadAccounts()
  const targetAccountId = accountId || activeAccountId

  if (!targetAccountId) {
    return { files: [], folder: '' }
  }

  const account = data.accounts.find(a => a.id === targetAccountId)
  if (!account) {
    return { files: [], folder: '' }
  }

  const listingService = new EbayListingManagementService(
    {
      id: account.id,
      ebayAppId: account.ebayAppId,
      ebayCertId: account.ebayCertId,
      ebayEnvironment: account.ebayEnvironment,
      tokenFile: account.tokenFile,
    },
    account.name
  )

  return {
    files: listingService.listExportedListingFiles(),
    folder: listingService.getOutputFolder(),
  }
})

// Helper function to stop Python process
function stopPythonProcess(): { success: boolean; message: string } {
  if (pythonProcess) {
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', pythonProcess.pid!.toString(), '/f', '/t'], { shell: true })
      } else {
        pythonProcess.kill('SIGTERM')
      }
      pythonProcess = null
      return { success: true, message: 'File watcher stopped' }
    } catch (e) {
      console.error('Error stopping Python process:', e)
      return { success: false, message: `Error: ${e}` }
    }
  }
  return { success: true, message: 'File watcher was not running' }
}

// Process a JSON file with Amazon products using native listing service
async function processJsonFile(
  filePath: string,
  account: EbayAccount,
  globalSettings: GlobalSettings
): Promise<boolean> {
  try {
    console.log(`\nProcessing file: ${filePath}`)

    // Load products from JSON file
    const { products, fileName } = loadProductsFromFile(filePath)

    if (products.length === 0) {
      console.log('No products found in file')
      return false
    }

    console.log(`Loaded ${products.length} products from ${fileName}`)

    // Send progress to UI
    if (mainWindow) {
      mainWindow.webContents.send('watcher-output', {
        type: 'info',
        data: `Processing ${products.length} products from ${fileName}...`,
      })
    }

    // Initialize category cache
    const categoryCache = getCategoryCache()

    // Convert GlobalSettings to ServiceGlobalSettings for the listing service
    const serviceSettings: ServiceGlobalSettings = {
      amazonTier1MaxPrice: globalSettings.amazonTier1MaxPrice,
      amazonTier1Multiplier: globalSettings.amazonTier1Multiplier,
      amazonTier2MaxPrice: globalSettings.amazonTier2MaxPrice,
      amazonTier2Multiplier: globalSettings.amazonTier2Multiplier,
      amazonTier3MaxPrice: globalSettings.amazonTier3MaxPrice,
      amazonTier3Multiplier: globalSettings.amazonTier3Multiplier,
      amazonTier4MaxPrice: globalSettings.amazonTier4MaxPrice,
      amazonTier4Multiplier: globalSettings.amazonTier4Multiplier,
      amazonTier5MaxPrice: globalSettings.amazonTier5MaxPrice,
      amazonTier5Multiplier: globalSettings.amazonTier5Multiplier,
      amazonTier6MaxPrice: globalSettings.amazonTier6MaxPrice,
      amazonTier6Multiplier: globalSettings.amazonTier6Multiplier,
      amazonTier7Multiplier: globalSettings.amazonTier7Multiplier,
      yamiTier1MaxPrice: globalSettings.yamiTier1MaxPrice,
      yamiTier1Multiplier: globalSettings.yamiTier1Multiplier,
      yamiTier2MaxPrice: globalSettings.yamiTier2MaxPrice,
      yamiTier2Multiplier: globalSettings.yamiTier2Multiplier,
      yamiTier3MaxPrice: globalSettings.yamiTier3MaxPrice,
      yamiTier3Multiplier: globalSettings.yamiTier3Multiplier,
      yamiTier4MaxPrice: globalSettings.yamiTier4MaxPrice,
      yamiTier4Multiplier: globalSettings.yamiTier4Multiplier,
      yamiTier5MaxPrice: globalSettings.yamiTier5MaxPrice,
      yamiTier5Multiplier: globalSettings.yamiTier5Multiplier,
      yamiTier6MaxPrice: globalSettings.yamiTier6MaxPrice,
      yamiTier6Multiplier: globalSettings.yamiTier6Multiplier,
      yamiTier7Multiplier: globalSettings.yamiTier7Multiplier,
      costcoTier1MaxPrice: globalSettings.costcoTier1MaxPrice,
      costcoTier1Multiplier: globalSettings.costcoTier1Multiplier,
      costcoTier2MaxPrice: globalSettings.costcoTier2MaxPrice,
      costcoTier2Multiplier: globalSettings.costcoTier2Multiplier,
      costcoTier3MaxPrice: globalSettings.costcoTier3MaxPrice,
      costcoTier3Multiplier: globalSettings.costcoTier3Multiplier,
      costcoTier4MaxPrice: globalSettings.costcoTier4MaxPrice,
      costcoTier4Multiplier: globalSettings.costcoTier4Multiplier,
      costcoTier5MaxPrice: globalSettings.costcoTier5MaxPrice,
      costcoTier5Multiplier: globalSettings.costcoTier5Multiplier,
      costcoTier6MaxPrice: globalSettings.costcoTier6MaxPrice,
      costcoTier6Multiplier: globalSettings.costcoTier6Multiplier,
      costcoTier7Multiplier: globalSettings.costcoTier7Multiplier,
      charmPricingStrategy: globalSettings.charmPricingStrategy,
      defaultInventoryQuantity: globalSettings.defaultInventoryQuantity,
    }

    // Get vector DB instance
    const vectorDB = getVectorCategoryDB()

    // Create listing service
    const listingService = new EbayListingService(
      {
        id: account.id,
        ebayAppId: account.ebayAppId,
        ebayCertId: account.ebayCertId,
        ebayEnvironment: account.ebayEnvironment,
        paymentPolicyId: account.paymentPolicyId,
        returnPolicyId: account.returnPolicyId,
        fulfillmentPolicyId: account.fulfillmentPolicyId,
        tokenFile: account.tokenFile,
      },
      serviceSettings,
      categoryCache,
      vectorDB
    )

    // Set progress callback
    listingService.setProgressCallback((progress) => {
      if (mainWindow) {
        mainWindow.webContents.send('watcher-output', {
          type: 'info',
          data: `[${progress.currentProduct}/${progress.totalProducts}] ${progress.stage}: ${progress.message}`,
        })
      }
    })

    // Process all products
    const results: ListingResult[] = await listingService.processProducts(
      products,
      globalSettings.anthropicApiKey
    )

    // Report results
    const successful = results.filter(r => r.status === 'success')
    const failed = results.filter(r => r.status === 'failed')

    if (mainWindow) {
      mainWindow.webContents.send('watcher-output', {
        type: 'info',
        data: `\n========== SUMMARY ==========`,
      })
      mainWindow.webContents.send('watcher-output', {
        type: 'info',
        data: `Processed: ${products.length} | Success: ${successful.length} | Failed: ${failed.length}`,
      })

      for (const result of successful) {
        mainWindow.webContents.send('watcher-output', {
          type: 'info',
          data: `SUCCESS: ${result.sku} -> https://www.ebay.com/itm/${result.listingId}`,
        })
      }

      for (const result of failed) {
        mainWindow.webContents.send('watcher-output', {
          type: 'error',
          data: `FAILED: ${result.sku} at ${result.stage}: ${result.error?.substring(0, 100)}`,
        })
      }
    }

    return successful.length > 0
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('Error processing JSON file:', errorMessage)

    if (mainWindow) {
      mainWindow.webContents.send('watcher-output', {
        type: 'error',
        data: `Error processing file: ${errorMessage}`,
      })
    }

    return false
  }
}
