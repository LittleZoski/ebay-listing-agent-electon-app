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

  // Listings
  fetchListings: (accountId?: string) => ipcRenderer.invoke('fetch-listings', accountId),
  getStoredListings: (accountId?: string) => ipcRenderer.invoke('get-stored-listings', accountId),
  getListingHistory: (
    accountId: string,
    listingId?: string,
    dateRange?: { start: string; end: string }
  ) => ipcRenderer.invoke('get-listing-history', accountId, listingId, dateRange),
  listListingExports: (accountId?: string) => ipcRenderer.invoke('list-listing-exports', accountId),

  // Utilities
  openExternalUrl: (url: string) => ipcRenderer.invoke('open-external-url', url),

  // Published Listings Database
  dbGetListingBySku: (sku: string) => ipcRenderer.invoke('db-get-listing-by-sku', sku),
  dbGetListingByListingId: (listingId: string) => ipcRenderer.invoke('db-get-listing-by-listing-id', listingId),
  dbQueryListings: (options?: ListingQueryOptions) => ipcRenderer.invoke('db-query-listings', options),
  dbGetSuccessfulListings: (accountId?: string) => ipcRenderer.invoke('db-get-successful-listings', accountId),
  dbGetListingStats: (accountId?: string) => ipcRenderer.invoke('db-get-listing-stats', accountId),
  dbSearchListings: (query: string, limit?: number) => ipcRenderer.invoke('db-search-listings', query, limit),
  dbGetListingCount: (filter?: Partial<PublishedListing>) => ipcRenderer.invoke('db-get-listing-count', filter),
  dbExportListings: () => ipcRenderer.invoke('db-export-listings'),
  dbGetInfo: () => ipcRenderer.invoke('db-get-info'),

  // Migration
  dbGetMigrationPreview: (processedFolder: string) => ipcRenderer.invoke('db-get-migration-preview', processedFolder),
  dbRunMigration: (processedFolder: string, accountId?: string) => ipcRenderer.invoke('db-run-migration', processedFolder, accountId),

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
  onListingsProgress: (callback: (data: ListingProgress) => void) => {
    ipcRenderer.on('listings-progress', (_event, data) => callback(data))
    return () => ipcRenderer.removeAllListeners('listings-progress')
  },
  onListingsFetched: (callback: (data: { accountName: string; totalListings: number; newListings: number; updatedListings: number }) => void) => {
    ipcRenderer.on('listings-fetched', (_event, data) => callback(data))
    return () => ipcRenderer.removeAllListeners('listings-fetched')
  },
  onMigrationProgress: (callback: (data: MigrationProgress) => void) => {
    ipcRenderer.on('migration-progress', (_event, data) => callback(data))
    return () => ipcRenderer.removeAllListeners('migration-progress')
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

  // Listings
  fetchListings: (accountId?: string) => Promise<FetchListingsResult>
  getStoredListings: (accountId?: string) => Promise<ListingDataExport | null>
  getListingHistory: (
    accountId: string,
    listingId?: string,
    dateRange?: { start: string; end: string }
  ) => Promise<ListingSnapshot[]>
  listListingExports: (accountId?: string) => Promise<{ files: string[]; folder: string }>

  // Utilities
  openExternalUrl: (url: string) => Promise<{ success: boolean; error?: string }>

  // Published Listings Database
  dbGetListingBySku: (sku: string) => Promise<PublishedListing | null>
  dbGetListingByListingId: (listingId: string) => Promise<PublishedListing | null>
  dbQueryListings: (options?: ListingQueryOptions) => Promise<PublishedListing[]>
  dbGetSuccessfulListings: (accountId?: string) => Promise<PublishedListing[]>
  dbGetListingStats: (accountId?: string) => Promise<ListingStats>
  dbSearchListings: (query: string, limit?: number) => Promise<PublishedListing[]>
  dbGetListingCount: (filter?: Partial<PublishedListing>) => Promise<number>
  dbExportListings: () => Promise<PublishedListing[]>
  dbGetInfo: () => Promise<{ path: string; count: number; initialized: boolean }>

  // Migration
  dbGetMigrationPreview: (processedFolder: string) => Promise<{
    totalFiles: number
    filesWithResults: number
    filesWithoutResults: number
    estimatedProducts: number
  }>
  dbRunMigration: (processedFolder: string, accountId?: string) => Promise<MigrationResult>

  // Event listeners
  onWatcherOutput: (callback: (data: { type: string; data: string }) => void) => () => void
  onWatcherStopped: (callback: (data: { code: number }) => void) => () => void
  onOrdersFetched: (callback: (data: { accountName: string; totalOrders: number; orders: EbayOrder[] }) => void) => () => void
  onListingsProgress: (callback: (data: ListingProgress) => void) => () => void
  onListingsFetched: (callback: (data: { accountName: string; totalListings: number; newListings: number; updatedListings: number }) => void) => () => void
  onMigrationProgress: (callback: (data: MigrationProgress) => void) => () => void
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

// ===== Listing Types =====

export interface EbayListing {
  listingId: string
  sku: string
  title: string
  price: { value: string; currency: string }
  quantity: number
  quantitySold: number
  status: 'ACTIVE' | 'INACTIVE' | 'ENDED' | 'OUT_OF_STOCK'
  views30Days: number
  watcherCount: number
  questionCount: number
  soldQuantity: number
  listingStartDate: string
  listingEndDate: string | null
  daysRemaining: number | null
  imageUrl: string | null
  categoryId: string
  categoryName: string
  condition: string
  listingFormat: string
  fetchedAt: string
}

export interface ListingSnapshot {
  listingId: string
  sku: string
  date: string
  views30Days: number
  watcherCount: number
  soldQuantity: number
  quantity: number
  price: { value: string; currency: string }
}

export interface ListingDataExport {
  exportedAt: string
  accountId: string
  accountName: string
  totalListings: number
  listings: EbayListing[]
}

export interface FetchListingsResult {
  success: boolean
  accountName: string
  totalListings: number
  listings: EbayListing[]
  newListings: number
  updatedListings: number
  exportPath?: string
  error?: string
}

export interface ListingProgress {
  stage: string
  current: number
  total: number
  message: string
}

// ===== Published Listings Database Types =====

export interface PublishedListing {
  sku: string
  title: string
  description?: string
  bulletPoints?: string[]
  specifications?: Record<string, string>
  images?: string[]
  originalPrice?: string
  deliveryFee?: string
  source?: string
  originalUrl?: string
  offerId?: string
  listingId?: string
  categoryId?: string
  categoryName?: string
  ebayPrice?: number
  optimizedTitle?: string
  sourceFile?: string
  publishedAt: string
  accountId: string
  processingTime?: number
  status: 'success' | 'failed'
  failureStage?: string
  failureError?: string
}

export interface ListingQueryOptions {
  sku?: string
  accountId?: string
  source?: string
  status?: 'success' | 'failed'
  categoryId?: string
  fromDate?: string
  toDate?: string
  limit?: number
  offset?: number
}

export interface ListingStats {
  totalListings: number
  successfulListings: number
  failedListings: number
  bySource: Record<string, number>
  byCategory: Record<string, number>
  byAccount: Record<string, number>
}

export interface MigrationProgress {
  phase: 'scanning' | 'processing' | 'complete'
  currentFile?: string
  totalFiles: number
  processedFiles: number
  totalProducts: number
  importedProducts: number
  skippedProducts: number
  errors: string[]
}

export interface MigrationResult {
  success: boolean
  totalFiles: number
  processedFiles: number
  totalProducts: number
  importedProducts: number
  skippedProducts: number
  updatedProducts: number
  errors: string[]
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
