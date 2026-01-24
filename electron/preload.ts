import { contextBridge, ipcRenderer } from 'electron'

// Types - Full account model matching main.ts
export interface EbayAccount {
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

  // Folder Settings
  watchFolder: string
  processedFolder: string
  failedFolder: string

  // Timestamps
  createdAt: string
  lastAuthorized?: string
}

export interface GlobalSettings {
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

  // Charm Pricing Strategy
  charmPricingStrategy: 'always_99' | 'always_49' | 'tiered'

  // Default Listing Settings
  defaultCategoryId: string
  defaultMarketplace: string
  defaultInventoryQuantity: number

  // Category Selection Settings
  categoryCandidatesTopK: number
}

export interface AccountsResponse {
  accounts: EbayAccount[]
  activeAccountId: string | null
  globalSettings: GlobalSettings
}

export interface WatcherStatus {
  running: boolean
  activeAccountId: string | null
  activeAccountName: string | null
}

export interface EnvDefaults {
  ebayAppId?: string
  ebayCertId?: string
  ebayDevId?: string
  ebayRedirectUri?: string
  ebayEnvironment?: 'SANDBOX' | 'PRODUCTION'
  watchFolder?: string
  processedFolder?: string
  failedFolder?: string
  defaultCategoryId?: string
  defaultMarketplace?: string
  ebaySiteId?: number
  defaultInventoryQuantity?: number
  anthropicApiKey?: string
}

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Account management
  getAccounts: () => ipcRenderer.invoke('get-accounts'),
  getEnvDefaults: () => ipcRenderer.invoke('get-env-defaults'),
  addAccount: (accountData: Partial<EbayAccount>) => ipcRenderer.invoke('add-account', accountData),
  updateAccount: (accountId: string, updates: Partial<EbayAccount>) =>
    ipcRenderer.invoke('update-account', accountId, updates),
  removeAccount: (accountId: string) => ipcRenderer.invoke('remove-account', accountId),
  setActiveAccount: (accountId: string) => ipcRenderer.invoke('set-active-account', accountId),

  // Global settings
  getGlobalSettings: () => ipcRenderer.invoke('get-global-settings'),
  updateGlobalSettings: (updates: Partial<GlobalSettings>) =>
    ipcRenderer.invoke('update-global-settings', updates),

  // Authorization
  startAuthorization: (accountId: string) => ipcRenderer.invoke('start-authorization', accountId),
  completeAuthorization: (accountId: string, callbackUrl: string) =>
    ipcRenderer.invoke('complete-authorization', accountId, callbackUrl),

  // File watcher control
  startFileWatcher: () => ipcRenderer.invoke('start-file-watcher'),
  stopFileWatcher: () => ipcRenderer.invoke('stop-file-watcher'),
  getWatcherStatus: () => ipcRenderer.invoke('get-watcher-status'),

  // Orders
  fetchOrders: (accountId?: string) => ipcRenderer.invoke('fetch-orders', accountId),
  getStoredOrders: (filePath?: string) => ipcRenderer.invoke('get-stored-orders', filePath),
  listOrderExports: (accountId?: string) => ipcRenderer.invoke('list-order-exports', accountId),

  // Event listeners
  onWatcherOutput: (callback: (data: { type: string; data: string }) => void) => {
    ipcRenderer.on('watcher-output', (_event, data) => callback(data))
    return () => ipcRenderer.removeAllListeners('watcher-output')
  },
  onWatcherStopped: (callback: (data: { code: number }) => void) => {
    ipcRenderer.on('watcher-stopped', (_event, data) => callback(data))
    return () => ipcRenderer.removeAllListeners('watcher-stopped')
  },
  onOrdersFetched: (callback: (data: { accountName: string; totalOrders: number; orders: unknown[] }) => void) => {
    ipcRenderer.on('orders-fetched', (_event, data) => callback(data))
    return () => ipcRenderer.removeAllListeners('orders-fetched')
  },
})

// Type declarations for renderer
export interface ElectronAPI {
  // Account management
  getAccounts: () => Promise<AccountsResponse>
  getEnvDefaults: () => Promise<EnvDefaults>
  addAccount: (accountData: Partial<EbayAccount>) => Promise<EbayAccount>
  updateAccount: (accountId: string, updates: Partial<EbayAccount>) => Promise<{ success: boolean; account: EbayAccount }>
  removeAccount: (accountId: string) => Promise<{ success: boolean }>
  setActiveAccount: (accountId: string) => Promise<{ success: boolean; activeAccountId: string }>

  // Global settings
  getGlobalSettings: () => Promise<GlobalSettings>
  updateGlobalSettings: (updates: Partial<GlobalSettings>) => Promise<{ success: boolean; globalSettings: GlobalSettings }>

  // Authorization
  startAuthorization: (accountId: string) => Promise<{ consentUrl: string; accountId: string }>
  completeAuthorization: (accountId: string, callbackUrl: string) => Promise<{ success: boolean; account: EbayAccount }>

  // File watcher
  startFileWatcher: () => Promise<{ success: boolean; message: string; accountId?: string; accountName?: string }>
  stopFileWatcher: () => Promise<{ success: boolean; message: string }>
  getWatcherStatus: () => Promise<WatcherStatus>

  // Orders
  fetchOrders: (accountId?: string) => Promise<FetchOrdersResult>
  getStoredOrders: (filePath?: string) => Promise<OrderExport | null>
  listOrderExports: (accountId?: string) => Promise<{ files: string[]; folder: string }>

  // Event listeners
  onWatcherOutput: (callback: (data: { type: string; data: string }) => void) => () => void
  onWatcherStopped: (callback: (data: { code: number }) => void) => () => void
  onOrdersFetched: (callback: (data: { accountName: string; totalOrders: number; orders: EbayOrder[] }) => void) => () => void
}

// Order types for renderer
export interface ShippingAddress {
  name: string
  addressLine1: string
  addressLine2: string
  city: string
  stateOrProvince: string
  postalCode: string
  countryCode: string
  phoneNumber: string
  email: string
}

export interface OrderLineItem {
  lineItemId: string
  sku: string
  asin: string
  title: string
  quantity: number
  price: number
  currency: string
}

export interface EbayOrder {
  ebayOrderId: string
  ebayOrderDate: string
  ebayOrderStatus: string
  totalPaidByBuyer: {
    amount: string
    currency: string
  }
  shippingAddress: ShippingAddress
  items: OrderLineItem[]
  orderNote: string
  processedAt: string
}

export interface OrderExport {
  exportedAt: string
  accountId: string
  accountName: string
  totalOrders: number
  orders: EbayOrder[]
}

export interface FetchOrdersResult {
  success: boolean
  accountName: string
  totalOrders: number
  orders: EbayOrder[]
  exportPath?: string
  error?: string
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
