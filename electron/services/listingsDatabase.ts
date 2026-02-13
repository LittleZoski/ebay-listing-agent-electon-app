/**
 * Listings Database Service
 * Uses LokiJS to store published listings with combined product + eBay response data
 * Enables order-to-product mapping and historical tracking
 */

import Loki from 'lokijs'
import path from 'path'
import fs from 'fs'
import { app } from 'electron'

// Combined listing record: original product data + eBay response
export interface PublishedListing {
  // Primary key
  sku: string

  // Original product data
  title: string
  description?: string
  bulletPoints?: string[]
  specifications?: Record<string, string>
  images?: string[]
  originalPrice?: string
  deliveryFee?: string
  source?: string // 'amazon' | 'yami' | 'costco'
  originalUrl?: string

  // eBay response data
  offerId?: string
  listingId?: string
  categoryId?: string
  categoryName?: string
  ebayPrice?: number
  optimizedTitle?: string

  // Metadata
  sourceFile?: string
  publishedAt: string
  accountId: string
  processingTime?: number
  status: 'success' | 'failed'
  failureStage?: string
  failureError?: string

  // LokiJS metadata (auto-added)
  $loki?: number
  meta?: {
    created: number
    revision: number
    updated: number
    version: number
  }
}

// Input for adding a new listing (product + result combined)
export interface AddListingInput {
  // From original product JSON
  product: {
    asin: string
    title: string
    description?: string
    bulletPoints?: string[]
    specifications?: Record<string, string>
    images?: string[]
    price?: string
    deliveryFee?: string
    source?: string
    originalAmazonUrl?: string
  }

  // From eBay listing result
  result: {
    sku: string
    status: 'success' | 'failed'
    categoryId?: string
    categoryName?: string
    offerId?: string
    listingId?: string
    ebayPrice?: number
    stage?: string
    error?: string
    processingTime?: number
  }

  // Metadata
  sourceFile: string
  accountId: string
}

// Query options
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

// Statistics
export interface ListingStats {
  totalListings: number
  successfulListings: number
  failedListings: number
  bySource: Record<string, number>
  byCategory: Record<string, number>
  byAccount: Record<string, number>
}

class ListingsDatabase {
  private db: Loki | null = null
  private listings: Collection<PublishedListing> | null = null
  private dbPath: string = ''
  private initialized: boolean = false
  private initPromise: Promise<void> | null = null

  /**
   * Initialize the database
   */
  async initialize(): Promise<void> {
    if (this.initialized) return
    if (this.initPromise) return this.initPromise

    this.initPromise = this._doInitialize()
    return this.initPromise
  }

  private async _doInitialize(): Promise<void> {
    // Get app data path
    const appDataPath = app.getPath('userData')
    const dbDir = path.join(appDataPath, 'database')

    // Ensure directory exists
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true })
    }

    this.dbPath = path.join(dbDir, 'listings.db')
    console.log('[ListingsDB] Database path:', this.dbPath)

    return new Promise((resolve, reject) => {
      this.db = new Loki(this.dbPath, {
        autoload: true,
        autosave: true,
        autosaveInterval: 5000, // Auto-save every 5 seconds
        autoloadCallback: (err) => {
          if (err) {
            console.error('[ListingsDB] Error loading database:', err)
            reject(err)
            return
          }

          // Get or create the listings collection
          this.listings = this.db!.getCollection<PublishedListing>('listings')

          if (!this.listings) {
            console.log('[ListingsDB] Creating new listings collection')
            this.listings = this.db!.addCollection<PublishedListing>('listings', {
              unique: ['sku'],
              indices: ['accountId', 'source', 'status', 'categoryId', 'publishedAt', 'listingId'],
            })
          }

          this.initialized = true
          console.log(`[ListingsDB] Initialized with ${this.listings.count()} existing listings`)
          resolve()
        },
      })
    })
  }

  /**
   * Ensure database is initialized before operations
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize()
    }
  }

  /**
   * Add or update a listing in the database
   */
  async upsertListing(input: AddListingInput): Promise<PublishedListing> {
    await this.ensureInitialized()

    const { product, result, sourceFile, accountId } = input

    const listing: PublishedListing = {
      // Primary key
      sku: product.asin,

      // Original product data
      title: product.title,
      description: product.description,
      bulletPoints: product.bulletPoints,
      specifications: product.specifications,
      images: product.images,
      originalPrice: product.price,
      deliveryFee: product.deliveryFee,
      source: product.source,
      originalUrl: product.originalAmazonUrl,

      // eBay response data
      offerId: result.offerId,
      listingId: result.listingId,
      categoryId: result.categoryId,
      categoryName: result.categoryName,
      ebayPrice: result.ebayPrice,

      // Metadata
      sourceFile,
      publishedAt: new Date().toISOString(),
      accountId,
      processingTime: result.processingTime,
      status: result.status,
      failureStage: result.status === 'failed' ? result.stage : undefined,
      failureError: result.status === 'failed' ? result.error : undefined,
    }

    // Check if listing already exists
    const existing = this.listings!.findOne({ sku: listing.sku })

    if (existing) {
      // Update existing listing
      Object.assign(existing, listing)
      this.listings!.update(existing)
      console.log(`[ListingsDB] Updated listing: ${listing.sku}`)
      return existing
    } else {
      // Insert new listing
      const inserted = this.listings!.insert(listing)
      console.log(`[ListingsDB] Added new listing: ${listing.sku}`)
      // LokiJS insert returns the object with $loki and meta added
      return inserted as PublishedListing
    }
  }

  /**
   * Add multiple listings (for migration)
   */
  async bulkUpsert(inputs: AddListingInput[]): Promise<{ added: number; updated: number; errors: number }> {
    await this.ensureInitialized()

    let added = 0
    let updated = 0
    let errors = 0

    for (const input of inputs) {
      try {
        const existing = this.listings!.findOne({ sku: input.product.asin })
        await this.upsertListing(input)

        if (existing) {
          updated++
        } else {
          added++
        }
      } catch (error) {
        console.error(`[ListingsDB] Error upserting ${input.product.asin}:`, error)
        errors++
      }
    }

    // Force save after bulk operation
    this.db?.saveDatabase()

    return { added, updated, errors }
  }

  /**
   * Get a listing by SKU
   */
  async getListingBySku(sku: string): Promise<PublishedListing | null> {
    await this.ensureInitialized()
    return this.listings!.findOne({ sku }) || null
  }

  /**
   * Get a listing by eBay listing ID
   */
  async getListingByListingId(listingId: string): Promise<PublishedListing | null> {
    await this.ensureInitialized()
    return this.listings!.findOne({ listingId }) || null
  }

  /**
   * Query listings with filters
   */
  async queryListings(options: ListingQueryOptions = {}): Promise<PublishedListing[]> {
    await this.ensureInitialized()

    let chain = this.listings!.chain()

    // Apply filters
    if (options.sku) {
      chain = chain.find({ sku: options.sku })
    }
    if (options.accountId) {
      chain = chain.find({ accountId: options.accountId })
    }
    if (options.source) {
      chain = chain.find({ source: options.source })
    }
    if (options.status) {
      chain = chain.find({ status: options.status })
    }
    if (options.categoryId) {
      chain = chain.find({ categoryId: options.categoryId })
    }
    if (options.fromDate) {
      chain = chain.find({ publishedAt: { $gte: options.fromDate } })
    }
    if (options.toDate) {
      chain = chain.find({ publishedAt: { $lte: options.toDate } })
    }

    // Sort by publishedAt descending (newest first)
    chain = chain.simplesort('publishedAt', true)

    // Apply pagination
    if (options.offset) {
      chain = chain.offset(options.offset)
    }
    if (options.limit) {
      chain = chain.limit(options.limit)
    }

    return chain.data()
  }

  /**
   * Get all successful listings
   */
  async getSuccessfulListings(accountId?: string): Promise<PublishedListing[]> {
    return this.queryListings({
      status: 'success',
      accountId,
    })
  }

  /**
   * Get statistics
   */
  async getStats(accountId?: string): Promise<ListingStats> {
    await this.ensureInitialized()

    const filter = accountId ? { accountId } : {}
    const all = this.listings!.find(filter)

    const stats: ListingStats = {
      totalListings: all.length,
      successfulListings: all.filter(l => l.status === 'success').length,
      failedListings: all.filter(l => l.status === 'failed').length,
      bySource: {},
      byCategory: {},
      byAccount: {},
    }

    for (const listing of all) {
      // By source
      const source = listing.source || 'unknown'
      stats.bySource[source] = (stats.bySource[source] || 0) + 1

      // By category
      const category = listing.categoryName || 'uncategorized'
      stats.byCategory[category] = (stats.byCategory[category] || 0) + 1

      // By account
      stats.byAccount[listing.accountId] = (stats.byAccount[listing.accountId] || 0) + 1
    }

    return stats
  }

  /**
   * Search listings by title (partial match)
   */
  async searchByTitle(query: string, limit: number = 50): Promise<PublishedListing[]> {
    await this.ensureInitialized()

    const lowerQuery = query.toLowerCase()

    return this.listings!
      .chain()
      .where((listing) => listing.title.toLowerCase().includes(lowerQuery))
      .simplesort('publishedAt', true)
      .limit(limit)
      .data()
  }

  /**
   * Get total count
   */
  async getCount(filter?: Partial<PublishedListing>): Promise<number> {
    await this.ensureInitialized()
    return filter ? this.listings!.find(filter).length : this.listings!.count()
  }

  /**
   * Delete a listing by SKU
   */
  async deleteListing(sku: string): Promise<boolean> {
    await this.ensureInitialized()

    const listing = this.listings!.findOne({ sku })
    if (listing) {
      this.listings!.remove(listing)
      console.log(`[ListingsDB] Deleted listing: ${sku}`)
      return true
    }
    return false
  }

  /**
   * Force save the database
   */
  async save(): Promise<void> {
    if (this.db) {
      return new Promise((resolve, reject) => {
        this.db!.saveDatabase((err) => {
          if (err) {
            console.error('[ListingsDB] Error saving database:', err)
            reject(err)
          } else {
            console.log('[ListingsDB] Database saved')
            resolve()
          }
        })
      })
    }
  }

  /**
   * Close the database
   */
  async close(): Promise<void> {
    if (this.db) {
      await this.save()
      this.db.close()
      this.db = null
      this.listings = null
      this.initialized = false
      this.initPromise = null
      console.log('[ListingsDB] Database closed')
    }
  }

  /**
   * Export all data to JSON (for backup)
   */
  async exportToJson(): Promise<PublishedListing[]> {
    await this.ensureInitialized()
    return this.listings!.find()
  }

  /**
   * Get database file path
   */
  getDbPath(): string {
    return this.dbPath
  }
}

// Singleton instance
let instance: ListingsDatabase | null = null

export function getListingsDatabase(): ListingsDatabase {
  if (!instance) {
    instance = new ListingsDatabase()
  }
  return instance
}

export { ListingsDatabase }
