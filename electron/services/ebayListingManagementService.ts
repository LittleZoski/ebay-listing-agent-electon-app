/**
 * eBay Listing Management Service
 * Fetches active listings from eBay with detailed metrics (views, watchers, sold, etc.)
 * and manages local persistence with historical tracking
 */

import fs from 'fs'
import path from 'path'
import { app } from 'electron'

// ============================================================================
// Types and Interfaces
// ============================================================================

export interface EbayListingAccount {
  id: string
  ebayAppId: string
  ebayCertId: string
  ebayEnvironment: 'SANDBOX' | 'PRODUCTION'
  tokenFile: string
}

export interface TokenData {
  access_token: string
  refresh_token?: string
  expires_in?: number
  token_expiry?: number
  timestamp?: string
}

// Core listing data from eBay APIs
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
  listingFormat: string // FIXED_PRICE, AUCTION, etc.
  fetchedAt: string
}

// For daily snapshots (performance monitoring)
export interface ListingSnapshot {
  listingId: string
  sku: string
  date: string // YYYY-MM-DD
  views30Days: number
  watcherCount: number
  soldQuantity: number
  quantity: number
  price: { value: string; currency: string }
}

// Storage structure
export interface ListingDataExport {
  exportedAt: string
  accountId: string
  accountName: string
  totalListings: number
  listings: EbayListing[]
}

export interface ListingHistoryFile {
  accountId: string
  lastUpdated: string
  snapshots: ListingSnapshot[]
}

// Fetch result
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

// Progress callback
export interface ListingProgress {
  stage: string
  current: number
  total: number
  message: string
}

// eBay API response types
interface InventoryItem {
  sku: string
  product?: {
    title?: string
    imageUrls?: string[]
    aspects?: Record<string, string[]>
  }
  condition?: string
  availability?: {
    shipToLocationAvailability?: {
      quantity?: number
    }
  }
}

interface Offer {
  offerId: string
  sku: string
  marketplaceId: string
  format: string
  listingId?: string
  status: string
  pricingSummary?: {
    price?: { value: string; currency: string }
  }
  listing?: {
    listingId?: string
  }
  categoryId?: string
}

interface ActiveListingItem {
  itemId: string
  sku: string
  title: string
  watchCount?: number
  questionCount?: number
  quantitySold?: number
  quantity?: number
  quantityAvailable?: number
  listingDuration?: string
  startTime?: string
  endTime?: string
  viewItemURL?: string
  pictureDetails?: {
    galleryURL?: string
    pictureURL?: string[]
  }
  listingStatus?: string // For ended listings: 'Completed', 'Active', etc.
  sellingStatus?: {
    currentPrice?: { value: string; currencyID?: string }
    quantitySold?: number
  }
  listingDetails?: {
    startTime?: string
    endTime?: string
    viewItemURL?: string
  }
}

// ============================================================================
// eBay Listing Management Service Class
// ============================================================================

export class EbayListingManagementService {
  private account: EbayListingAccount
  private accountName: string
  private accessToken: string | null = null
  private baseUrl: string
  private outputFolder: string
  private historyFolder: string
  private progressCallback: ((progress: ListingProgress) => void) | null = null

  constructor(account: EbayListingAccount, accountName: string, dataFolder?: string) {
    this.account = account
    this.accountName = accountName
    this.baseUrl =
      account.ebayEnvironment === 'PRODUCTION'
        ? 'https://api.ebay.com'
        : 'https://api.sandbox.ebay.com'

    // Use provided data folder or default to user data directory
    const baseFolder = dataFolder || path.join(app.getPath('userData'), 'listings')
    this.outputFolder = path.join(baseFolder, account.id, 'current')
    this.historyFolder = path.join(baseFolder, account.id, 'history')

    // Ensure directories exist
    if (!fs.existsSync(this.outputFolder)) {
      fs.mkdirSync(this.outputFolder, { recursive: true })
    }
    if (!fs.existsSync(this.historyFolder)) {
      fs.mkdirSync(this.historyFolder, { recursive: true })
    }
  }

  /**
   * Set progress callback for UI updates
   */
  setProgressCallback(callback: (progress: ListingProgress) => void): void {
    this.progressCallback = callback
  }

  /**
   * Report progress to UI
   */
  private reportProgress(stage: string, current: number, total: number, message: string): void {
    if (this.progressCallback) {
      this.progressCallback({ stage, current, total, message })
    }
    console.log(`[${stage}] ${message}`)
  }

  /**
   * Load access token from token file
   */
  private async loadAccessToken(): Promise<boolean> {
    try {
      if (!fs.existsSync(this.account.tokenFile)) {
        console.error(`Token file not found: ${this.account.tokenFile}`)
        return false
      }

      const tokenData = JSON.parse(
        fs.readFileSync(this.account.tokenFile, 'utf-8')
      ) as TokenData

      if (!tokenData.access_token) {
        console.error('No access token in token file')
        return false
      }

      // Check if token is expired
      if (tokenData.token_expiry) {
        const now = Date.now() / 1000
        if (now >= tokenData.token_expiry - 300) {
          // Token expired, try to refresh
          if (tokenData.refresh_token) {
            console.log('Access token expired, refreshing...')
            const refreshed = await this.refreshToken(tokenData.refresh_token)
            if (refreshed) {
              console.log('Token refreshed successfully')
              return true
            }
          }
          console.error('Token expired and cannot be refreshed')
          return false
        }
      }

      this.accessToken = tokenData.access_token
      console.log('Access token loaded successfully')
      return true
    } catch (error) {
      console.error('Error loading access token:', error)
      return false
    }
  }

  /**
   * Refresh access token
   */
  private async refreshToken(refreshToken: string): Promise<boolean> {
    try {
      const tokenUrl = `${this.baseUrl}/identity/v1/oauth2/token`
      const credentials = Buffer.from(
        `${this.account.ebayAppId}:${this.account.ebayCertId}`
      ).toString('base64')

      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${credentials}`,
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }).toString(),
      })

      if (!response.ok) {
        console.error('Token refresh failed:', await response.text())
        return false
      }

      const tokenData = await response.json()
      this.accessToken = tokenData.access_token

      // Save updated tokens
      const newTokenData: TokenData = {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || refreshToken,
        expires_in: tokenData.expires_in,
        token_expiry: Date.now() / 1000 + (tokenData.expires_in || 7200),
        timestamp: new Date().toISOString(),
      }

      fs.writeFileSync(this.account.tokenFile, JSON.stringify(newTokenData, null, 2))
      return true
    } catch (error) {
      console.error('Error refreshing token:', error)
      return false
    }
  }

  /**
   * Get request headers with authorization
   */
  private getHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Accept-Language': 'en-US',
      'Content-Language': 'en-US',
    }
  }

  /**
   * Delay helper for rate limiting
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * Fetch all inventory items from eBay (paginated)
   */
  private async fetchInventoryItems(): Promise<InventoryItem[]> {
    const allItems: InventoryItem[] = []
    let offset = 0
    const limit = 100 // eBay Inventory API max is 100

    this.reportProgress('inventory', 0, 0, 'Starting to fetch inventory items...')

    while (true) {
      const endpoint = `${this.baseUrl}/sell/inventory/v1/inventory_item?limit=${limit}&offset=${offset}`

      const response = await fetch(endpoint, {
        headers: this.getHeaders(),
      })

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Authentication failed. Please re-authorize the account.')
        }
        const errorText = await response.text()
        throw new Error(`Inventory API Error: ${response.status} - ${errorText}`)
      }

      const data = await response.json()
      const items = data.inventoryItems || []
      const total = data.total || 0

      allItems.push(...items)
      this.reportProgress('inventory', allItems.length, total, `Fetched ${allItems.length}/${total} inventory items`)

      if (!data.next || allItems.length >= total || items.length === 0) {
        break
      }

      offset += items.length

      // Rate limiting: 150ms delay between requests
      await this.delay(150)
    }

    return allItems
  }

  /**
   * Fetch all offers from eBay (paginated)
   * Returns empty array if API fails - offers are optional
   */
  private async fetchOffers(): Promise<Offer[]> {
    const allOffers: Offer[] = []
    let offset = 0
    const limit = 200

    this.reportProgress('offers', 0, 0, 'Starting to fetch offers...')

    try {
      while (true) {
        // Try fetching offers with format parameter
        const endpoint = `${this.baseUrl}/sell/inventory/v1/offer?format=FIXED_PRICE&marketplace_id=EBAY_US&limit=${limit}&offset=${offset}`

        const response = await fetch(endpoint, {
          headers: this.getHeaders(),
        })

        if (!response.ok) {
          if (response.status === 401) {
            throw new Error('Authentication failed. Please re-authorize the account.')
          }
          // If offers API fails, log and continue without offers
          const errorText = await response.text()
          console.warn(`Offers API failed (${response.status}), continuing without offers: ${errorText}`)
          this.reportProgress('offers', 0, 0, 'Offers API unavailable, skipping...')
          return []
        }

        const data = await response.json()
        const offers = data.offers || []
        const total = data.total || 0

        allOffers.push(...offers)
        this.reportProgress('offers', allOffers.length, total, `Fetched ${allOffers.length}/${total} offers`)

        if (!data.next || allOffers.length >= total || offers.length === 0) {
          break
        }

        offset += offers.length

        // Rate limiting
        await this.delay(150)
      }
    } catch (error) {
      // If it's an auth error, re-throw it
      if (error instanceof Error && error.message.includes('Authentication failed')) {
        throw error
      }
      // Otherwise, log and continue without offers
      console.warn('Error fetching offers, continuing without them:', error)
      this.reportProgress('offers', 0, 0, 'Offers fetch failed, continuing...')
      return []
    }

    return allOffers
  }

  /**
   * Fetch listings using the Trading API (GetMyeBaySelling)
   * This provides watch count, views, questions, etc.
   * Fetches both active and ended listings (SoldList, UnsoldList)
   * Uses XML format as required by Trading API
   */
  private async fetchActiveListingsFromTrading(): Promise<Map<string, ActiveListingItem>> {
    const listingsMap = new Map<string, ActiveListingItem>()

    // Trading API endpoint
    const endpoint =
      this.account.ebayEnvironment === 'PRODUCTION'
        ? 'https://api.ebay.com/ws/api.dll'
        : 'https://api.sandbox.ebay.com/ws/api.dll'

    // Fetch active listings
    await this.fetchListingsByType(endpoint, 'ActiveList', listingsMap, 'ACTIVE')

    // Fetch sold/ended listings (completed sales)
    await this.fetchListingsByType(endpoint, 'SoldList', listingsMap, 'ENDED')

    // Fetch unsold/ended listings (ended without sale)
    await this.fetchListingsByType(endpoint, 'UnsoldList', listingsMap, 'ENDED')

    return listingsMap
  }

  /**
   * Fetch a specific listing type from Trading API
   */
  private async fetchListingsByType(
    endpoint: string,
    listType: 'ActiveList' | 'SoldList' | 'UnsoldList',
    listingsMap: Map<string, ActiveListingItem>,
    defaultStatus: string
  ): Promise<void> {
    let pageNumber = 1
    const entriesPerPage = 200 // Max for Trading API
    let hasMorePages = true

    const listTypeDisplay = listType === 'ActiveList' ? 'Active' : listType === 'SoldList' ? 'Sold' : 'Unsold'
    this.reportProgress('trading', 0, 0, `Fetching ${listTypeDisplay} listings from Trading API...`)

    while (hasMorePages) {
      const xmlRequest = `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${this.accessToken}</eBayAuthToken>
  </RequesterCredentials>
  <${listType}>
    <Include>true</Include>
    <Pagination>
      <EntriesPerPage>${entriesPerPage}</EntriesPerPage>
      <PageNumber>${pageNumber}</PageNumber>
    </Pagination>
  </${listType}>
  <DetailLevel>ReturnAll</DetailLevel>
</GetMyeBaySellingRequest>`

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'text/xml',
            'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
            'X-EBAY-API-CALL-NAME': 'GetMyeBaySelling',
            'X-EBAY-API-SITEID': '0', // US site
            'X-EBAY-API-IAF-TOKEN': this.accessToken || '',
          },
          body: xmlRequest,
        })

        if (!response.ok) {
          console.warn(`Trading API returned ${response.status} for ${listType}, skipping`)
          break
        }

        const xmlText = await response.text()

        // Parse XML response - extract from the correct list container
        const listContainerMatch = xmlText.match(new RegExp(`<${listType}>[\\s\\S]*?</${listType}>`))
        if (!listContainerMatch) {
          hasMorePages = false
          break
        }

        const items = this.parseActiveListFromXml(listContainerMatch[0])

        if (items.length === 0) {
          hasMorePages = false
          break
        }

        for (const item of items) {
          // Mark the listing status based on list type
          item.listingStatus = defaultStatus

          const key = item.sku || item.itemId
          if (key && !listingsMap.has(key)) {
            listingsMap.set(key, item)
          }
        }

        // Check if there are more pages
        const totalPagesMatch = listContainerMatch[0].match(/<TotalNumberOfPages>(\d+)<\/TotalNumberOfPages>/)
        const totalPages = totalPagesMatch ? parseInt(totalPagesMatch[1], 10) : 1
        const totalEntriesMatch = listContainerMatch[0].match(/<TotalNumberOfEntries>(\d+)<\/TotalNumberOfEntries>/)
        const totalEntries = totalEntriesMatch ? parseInt(totalEntriesMatch[1], 10) : items.length

        this.reportProgress(
          'trading',
          listingsMap.size,
          totalEntries,
          `Fetched ${items.length} ${listTypeDisplay} listings (page ${pageNumber}/${totalPages})`
        )

        hasMorePages = pageNumber < totalPages
        pageNumber++

        // Rate limiting
        await this.delay(200)
      } catch (error) {
        console.warn(`Trading API error for ${listType}, continuing:`, error)
        break
      }
    }
  }

  /**
   * Parse ActiveList items from XML response
   */
  private parseActiveListFromXml(xmlText: string): ActiveListingItem[] {
    const items: ActiveListingItem[] = []

    // Extract each Item element
    const itemMatches = xmlText.match(/<Item>[\s\S]*?<\/Item>/g) || []

    for (const itemXml of itemMatches) {
      const item: ActiveListingItem = {
        itemId: this.extractXmlValue(itemXml, 'ItemID') || '',
        sku: this.extractXmlValue(itemXml, 'SKU') || '',
        title: this.extractXmlValue(itemXml, 'Title') || '',
        watchCount: parseInt(this.extractXmlValue(itemXml, 'WatchCount') || '0', 10),
        questionCount: parseInt(this.extractXmlValue(itemXml, 'QuestionCount') || '0', 10),
        quantitySold: parseInt(this.extractXmlValue(itemXml, 'QuantitySold') || '0', 10),
        quantity: parseInt(this.extractXmlValue(itemXml, 'Quantity') || '0', 10),
        quantityAvailable: parseInt(this.extractXmlValue(itemXml, 'QuantityAvailable') || '0', 10),
      }

      // Extract listing details
      const listingDetailsMatch = itemXml.match(/<ListingDetails>[\s\S]*?<\/ListingDetails>/)
      if (listingDetailsMatch) {
        item.listingDetails = {
          startTime: this.extractXmlValue(listingDetailsMatch[0], 'StartTime') || undefined,
          endTime: this.extractXmlValue(listingDetailsMatch[0], 'EndTime') || undefined,
          viewItemURL: this.extractXmlValue(listingDetailsMatch[0], 'ViewItemURL') || undefined,
        }
      }

      // Extract selling status
      const sellingStatusMatch = itemXml.match(/<SellingStatus>[\s\S]*?<\/SellingStatus>/)
      if (sellingStatusMatch) {
        const priceMatch = sellingStatusMatch[0].match(/<CurrentPrice[^>]*>([^<]+)<\/CurrentPrice>/)
        const currencyMatch = sellingStatusMatch[0].match(/<CurrentPrice[^>]*currencyID="([^"]+)"/)
        item.sellingStatus = {
          currentPrice: priceMatch
            ? { value: priceMatch[1], currencyID: currencyMatch?.[1] || 'USD' }
            : undefined,
          quantitySold: parseInt(
            this.extractXmlValue(sellingStatusMatch[0], 'QuantitySold') || '0',
            10
          ),
        }
      }

      // Extract picture details
      const pictureMatch = itemXml.match(/<PictureDetails>[\s\S]*?<\/PictureDetails>/)
      if (pictureMatch) {
        const galleryURL = this.extractXmlValue(pictureMatch[0], 'GalleryURL')
        // Also try to get PictureURL as fallback (may be multiple)
        const pictureURLMatch = pictureMatch[0].match(/<PictureURL>([^<]+)<\/PictureURL>/)
        const pictureURL = pictureURLMatch ? pictureURLMatch[1] : undefined

        item.pictureDetails = {
          galleryURL: galleryURL || pictureURL || undefined,
          pictureURL: pictureURL ? [pictureURL] : undefined,
        }
      }

      items.push(item)
    }

    return items
  }

  /**
   * Extract value from XML element
   */
  private extractXmlValue(xml: string, tag: string): string | null {
    const match = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`))
    return match ? match[1] : null
  }

  /**
   * Merge data from all sources into EbayListing objects
   * Priority: Trading API (active listings) > Offers > Inventory Items
   */
  private mergeListingData(
    inventoryItems: InventoryItem[],
    offers: Offer[],
    tradingData: Map<string, ActiveListingItem>
  ): EbayListing[] {
    const listings: EbayListing[] = []
    const now = new Date().toISOString()
    const processedSkus = new Set<string>()

    // Create maps for quick lookup
    const offersBySku = new Map<string, Offer>()
    for (const offer of offers) {
      if (offer.sku) {
        offersBySku.set(offer.sku, offer)
      }
    }

    const inventoryBySku = new Map<string, InventoryItem>()
    for (const item of inventoryItems) {
      inventoryBySku.set(item.sku, item)
    }

    // First pass: Process items from Trading API (these are definitely active listings)
    for (const [key, tradingItem] of tradingData) {
      const sku = tradingItem.sku || key
      if (processedSkus.has(sku)) continue
      processedSkus.add(sku)

      const inventoryItem = inventoryBySku.get(sku)
      const offer = offersBySku.get(sku)

      // Get quantity from inventory or trading data
      const quantity = inventoryItem?.availability?.shipToLocationAvailability?.quantity
        ?? tradingItem.quantityAvailable
        ?? tradingItem.quantity
        ?? 0

      // Determine status based on listingStatus from Trading API
      let status: 'ACTIVE' | 'INACTIVE' | 'ENDED' | 'OUT_OF_STOCK' = 'ACTIVE'
      if (tradingItem.listingStatus === 'ENDED') {
        status = 'ENDED'
      } else if (quantity === 0) {
        status = 'OUT_OF_STOCK'
      }

      // Get end date and calculate days remaining
      let listingEndDate: string | null = null
      let daysRemaining: number | null = null
      if (tradingItem.listingDetails?.endTime) {
        listingEndDate = tradingItem.listingDetails.endTime
        const endDate = new Date(listingEndDate)
        const nowDate = new Date()
        const diffMs = endDate.getTime() - nowDate.getTime()
        daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
        if (daysRemaining < 0) daysRemaining = 0
      }

      // Get price from trading data or offer
      const price = tradingItem.sellingStatus?.currentPrice
        ? { value: tradingItem.sellingStatus.currentPrice.value, currency: tradingItem.sellingStatus.currentPrice.currencyID || 'USD' }
        : offer?.pricingSummary?.price || { value: '0.00', currency: 'USD' }

      const listing: EbayListing = {
        listingId: tradingItem.itemId || offer?.listingId || offer?.offerId || sku,
        sku,
        title: tradingItem.title || inventoryItem?.product?.title || sku,
        price,
        quantity,
        quantitySold: tradingItem.sellingStatus?.quantitySold || tradingItem.quantitySold || 0,
        status,
        views30Days: 0, // Would need Analytics API
        watcherCount: tradingItem.watchCount || 0,
        questionCount: tradingItem.questionCount || 0,
        soldQuantity: tradingItem.sellingStatus?.quantitySold || tradingItem.quantitySold || 0,
        listingStartDate: tradingItem.listingDetails?.startTime || now,
        listingEndDate,
        daysRemaining,
        imageUrl: tradingItem.pictureDetails?.galleryURL || inventoryItem?.product?.imageUrls?.[0] || null,
        categoryId: offer?.categoryId || '',
        categoryName: '',
        condition: inventoryItem?.condition || 'NEW',
        listingFormat: offer?.format || 'FIXED_PRICE',
        fetchedAt: now,
      }

      listings.push(listing)
    }

    // Second pass: Process items with offers but not in Trading API
    // (might be INACTIVE or UNPUBLISHED)
    for (const [sku, offer] of offersBySku) {
      if (processedSkus.has(sku)) continue
      processedSkus.add(sku)

      const inventoryItem = inventoryBySku.get(sku)
      const quantity = inventoryItem?.availability?.shipToLocationAvailability?.quantity || 0

      // Determine status from offer
      let status: 'ACTIVE' | 'INACTIVE' | 'ENDED' | 'OUT_OF_STOCK' = 'INACTIVE'
      if (offer.status === 'PUBLISHED') {
        status = quantity === 0 ? 'OUT_OF_STOCK' : 'ACTIVE'
      } else if (offer.status === 'ENDED') {
        status = 'ENDED'
      }

      const listing: EbayListing = {
        listingId: offer.listingId || offer.offerId,
        sku,
        title: inventoryItem?.product?.title || sku,
        price: offer.pricingSummary?.price || { value: '0.00', currency: 'USD' },
        quantity,
        quantitySold: 0,
        status,
        views30Days: 0,
        watcherCount: 0,
        questionCount: 0,
        soldQuantity: 0,
        listingStartDate: now,
        listingEndDate: null,
        daysRemaining: null,
        imageUrl: inventoryItem?.product?.imageUrls?.[0] || null,
        categoryId: offer.categoryId || '',
        categoryName: '',
        condition: inventoryItem?.condition || 'NEW',
        listingFormat: offer.format || 'FIXED_PRICE',
        fetchedAt: now,
      }

      listings.push(listing)
    }

    return listings
  }

  /**
   * Save listings to JSON file
   */
  private saveListings(listings: EbayListing[]): string {
    const date = new Date().toISOString().split('T')[0]
    const filename = `listings_${date}.json`
    const filepath = path.join(this.outputFolder, filename)

    const exportData: ListingDataExport = {
      exportedAt: new Date().toISOString(),
      accountId: this.account.id,
      accountName: this.accountName,
      totalListings: listings.length,
      listings,
    }

    fs.writeFileSync(filepath, JSON.stringify(exportData, null, 2))
    console.log(`Saved ${listings.length} listings to: ${filepath}`)

    return filepath
  }

  /**
   * Load existing listings from the most recent export
   */
  private loadExistingListings(): ListingDataExport | null {
    try {
      const files = fs.readdirSync(this.outputFolder)
      const listingFiles = files
        .filter((f) => f.startsWith('listings_') && f.endsWith('.json'))
        .sort()
        .reverse()

      if (listingFiles.length === 0) {
        return null
      }

      const latestFile = path.join(this.outputFolder, listingFiles[0])
      const data = fs.readFileSync(latestFile, 'utf-8')
      return JSON.parse(data) as ListingDataExport
    } catch (error) {
      console.error('Error loading existing listings:', error)
      return null
    }
  }

  /**
   * Update history file with today's snapshots
   */
  private updateHistory(listings: EbayListing[]): void {
    const historyFile = path.join(this.historyFolder, 'history.json')
    const today = new Date().toISOString().split('T')[0]

    let history: ListingHistoryFile
    try {
      if (fs.existsSync(historyFile)) {
        history = JSON.parse(fs.readFileSync(historyFile, 'utf-8'))
      } else {
        history = {
          accountId: this.account.id,
          lastUpdated: new Date().toISOString(),
          snapshots: [],
        }
      }
    } catch {
      history = {
        accountId: this.account.id,
        lastUpdated: new Date().toISOString(),
        snapshots: [],
      }
    }

    // Remove any existing snapshots for today (we'll replace them)
    history.snapshots = history.snapshots.filter((s) => s.date !== today)

    // Add today's snapshots
    for (const listing of listings) {
      history.snapshots.push({
        listingId: listing.listingId,
        sku: listing.sku,
        date: today,
        views30Days: listing.views30Days,
        watcherCount: listing.watcherCount,
        soldQuantity: listing.soldQuantity,
        quantity: listing.quantity,
        price: listing.price,
      })
    }

    // Prune old history (keep last 365 days, but thin out older data)
    history.snapshots = this.pruneHistory(history.snapshots)
    history.lastUpdated = new Date().toISOString()

    fs.writeFileSync(historyFile, JSON.stringify(history, null, 2))
    console.log(`Updated history with ${listings.length} snapshots for ${today}`)
  }

  /**
   * Prune history to manage file size
   * - Keep all from last 30 days
   * - Keep weekly (Sundays) from 30-90 days
   * - Keep monthly (1st of month) from 90-365 days
   * - Discard older than 1 year
   */
  private pruneHistory(snapshots: ListingSnapshot[]): ListingSnapshot[] {
    const now = new Date()
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
    const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)

    return snapshots.filter((snapshot) => {
      const date = new Date(snapshot.date)

      // Keep all from last 30 days
      if (date >= thirtyDaysAgo) return true

      // Keep weekly (Sundays) from 30-90 days
      if (date >= ninetyDaysAgo) {
        return date.getDay() === 0 // Sunday
      }

      // Keep monthly (1st of month) from 90-365 days
      if (date >= oneYearAgo) {
        return date.getDate() === 1
      }

      // Discard older than 1 year
      return false
    })
  }

  /**
   * Fetch all listings and return them
   */
  async fetchAllListings(): Promise<FetchListingsResult> {
    console.log('='.repeat(70))
    console.log(`eBay Listing Fetch - ${this.accountName}`)
    console.log('='.repeat(70))

    // Load access token
    if (!(await this.loadAccessToken())) {
      return {
        success: false,
        accountName: this.accountName,
        totalListings: 0,
        listings: [],
        newListings: 0,
        updatedListings: 0,
        error: 'Failed to load access token. Please re-authorize the account.',
      }
    }

    try {
      // Load existing listings to track new/updated counts
      const existingData = this.loadExistingListings()
      const existingSkus = new Set(existingData?.listings.map((l) => l.sku) || [])

      // Fetch from all APIs
      this.reportProgress('start', 0, 4, 'Starting listing fetch...')

      // 1. Fetch inventory items
      this.reportProgress('inventory', 0, 0, 'Fetching inventory items...')
      const inventoryItems = await this.fetchInventoryItems()

      // 2. Fetch offers
      this.reportProgress('offers', 0, 0, 'Fetching offers...')
      const offers = await this.fetchOffers()

      // 3. Fetch detailed metrics from Trading API
      this.reportProgress('trading', 0, 0, 'Fetching detailed metrics...')
      const tradingData = await this.fetchActiveListingsFromTrading()

      // 4. Merge all data
      this.reportProgress('merge', 0, 0, 'Merging listing data...')
      const listings = this.mergeListingData(inventoryItems, offers, tradingData)

      console.log(`Total listings merged: ${listings.length}`)

      // Calculate new/updated counts
      let newListings = 0
      let updatedListings = 0
      for (const listing of listings) {
        if (existingSkus.has(listing.sku)) {
          updatedListings++
        } else {
          newListings++
        }
      }

      // Save listings
      this.reportProgress('save', 0, 0, 'Saving listings...')
      const exportPath = this.saveListings(listings)

      // Update history
      this.reportProgress('history', 0, 0, 'Updating history...')
      this.updateHistory(listings)

      this.reportProgress('complete', listings.length, listings.length, 'Listing fetch complete!')

      return {
        success: true,
        accountName: this.accountName,
        totalListings: listings.length,
        listings,
        newListings,
        updatedListings,
        exportPath,
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error('Listing fetch failed:', errorMessage)
      return {
        success: false,
        accountName: this.accountName,
        totalListings: 0,
        listings: [],
        newListings: 0,
        updatedListings: 0,
        error: errorMessage,
      }
    }
  }

  /**
   * Get the output folder path
   */
  getOutputFolder(): string {
    return this.outputFolder
  }

  /**
   * Get the history folder path
   */
  getHistoryFolder(): string {
    return this.historyFolder
  }

  /**
   * Load previously exported listings
   */
  static loadExportedListings(filePath: string): ListingDataExport | null {
    try {
      if (!fs.existsSync(filePath)) {
        return null
      }
      const data = fs.readFileSync(filePath, 'utf-8')
      return JSON.parse(data) as ListingDataExport
    } catch (error) {
      console.error('Error loading exported listings:', error)
      return null
    }
  }

  /**
   * Load history file
   */
  static loadHistory(filePath: string): ListingHistoryFile | null {
    try {
      if (!fs.existsSync(filePath)) {
        return null
      }
      const data = fs.readFileSync(filePath, 'utf-8')
      return JSON.parse(data) as ListingHistoryFile
    } catch (error) {
      console.error('Error loading history:', error)
      return null
    }
  }

  /**
   * List all exported listing files
   */
  listExportedListingFiles(): string[] {
    try {
      const files = fs.readdirSync(this.outputFolder)
      return files
        .filter((f) => f.startsWith('listings_') && f.endsWith('.json'))
        .sort()
        .reverse() // Most recent first
    } catch (error) {
      console.error('Error listing export files:', error)
      return []
    }
  }

  /**
   * Get the latest stored listings for this account
   */
  getStoredListings(): ListingDataExport | null {
    return this.loadExistingListings()
  }

  /**
   * Get listing history for an account
   */
  getListingHistory(
    listingId?: string,
    dateRange?: { start: string; end: string }
  ): ListingSnapshot[] {
    const historyFile = path.join(this.historyFolder, 'history.json')

    if (!fs.existsSync(historyFile)) {
      return []
    }

    try {
      const history: ListingHistoryFile = JSON.parse(fs.readFileSync(historyFile, 'utf-8'))
      let snapshots = history.snapshots

      // Filter by listing ID if specified
      if (listingId) {
        snapshots = snapshots.filter((s) => s.listingId === listingId)
      }

      // Filter by date range if specified
      if (dateRange) {
        const startDate = new Date(dateRange.start)
        const endDate = new Date(dateRange.end)
        snapshots = snapshots.filter((s) => {
          const date = new Date(s.date)
          return date >= startDate && date <= endDate
        })
      }

      return snapshots
    } catch (error) {
      console.error('Error getting listing history:', error)
      return []
    }
  }
}
