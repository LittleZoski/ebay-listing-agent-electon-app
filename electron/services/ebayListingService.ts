/**
 * eBay Listing Service
 * Handles complete end-to-end flow for creating eBay listings
 * Uses Vector DB + LLM hybrid for category selection (ported from Python)
 */

import fs from 'fs'
import { CategoryCache, EbayCredentials } from './categoryCache'
import { SemanticCategorySelector, FilledAspects } from './semanticCategorySelector'
import { VectorCategoryDB } from './vectorCategoryDB'
import {
  processProduct,
  buildHtmlDescription,
  GlobalSettings,
  AmazonProduct,
} from './productMapper'

export interface EbayAccount {
  id: string
  ebayAppId: string
  ebayCertId: string
  ebayEnvironment: 'SANDBOX' | 'PRODUCTION'
  paymentPolicyId: string
  returnPolicyId: string
  fulfillmentPolicyId: string
  tokenFile: string
}

export interface TokenData {
  access_token: string
  refresh_token?: string
  expires_in?: number
  token_expiry?: number
  timestamp?: string
}

export interface ListingResult {
  sku: string
  status: 'success' | 'failed'
  stage?: string
  error?: string
  categoryId?: string
  categoryName?: string
  offerId?: string
  listingId?: string
  ebayPrice?: number
}

export interface ListingProgress {
  currentProduct: number
  totalProducts: number
  currentSku: string
  stage: string
  message: string
}

/**
 * eBay Listing Service class
 */
export class EbayListingService {
  private account: EbayAccount
  private settings: GlobalSettings
  private categoryCache: CategoryCache
  private vectorDB: VectorCategoryDB
  private categorySelector: SemanticCategorySelector | null = null
  private accessToken: string | null = null
  private baseUrl: string
  private locationKey = 'us_warehouse'

  private onProgress: ((progress: ListingProgress) => void) | null = null

  constructor(
    account: EbayAccount,
    settings: GlobalSettings,
    categoryCache: CategoryCache,
    vectorDB: VectorCategoryDB
  ) {
    this.account = account
    this.settings = settings
    this.categoryCache = categoryCache
    this.vectorDB = vectorDB
    this.baseUrl =
      account.ebayEnvironment === 'PRODUCTION'
        ? 'https://api.ebay.com'
        : 'https://api.sandbox.ebay.com'
  }

  /**
   * Set progress callback
   */
  setProgressCallback(callback: (progress: ListingProgress) => void): void {
    this.onProgress = callback
  }

  /**
   * Report progress
   */
  private reportProgress(
    currentProduct: number,
    totalProducts: number,
    currentSku: string,
    stage: string,
    message: string
  ): void {
    if (this.onProgress) {
      this.onProgress({ currentProduct, totalProducts, currentSku, stage, message })
    }
    console.log(`[${currentProduct}/${totalProducts}] ${stage}: ${message}`)
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

      const tokenData = JSON.parse(fs.readFileSync(this.account.tokenFile, 'utf-8')) as TokenData

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
      'Content-Language': 'en-US',
      'Accept-Language': 'en-US',
    }
  }

  /**
   * Initialize the Semantic category selector (Vector DB + LLM hybrid)
   */
  private initializeCategorySelector(anthropicApiKey: string): void {
    const credentials: EbayCredentials = {
      appId: this.account.ebayAppId,
      certId: this.account.ebayCertId,
      environment: this.account.ebayEnvironment,
    }

    this.categorySelector = new SemanticCategorySelector(
      anthropicApiKey,
      this.vectorDB,
      this.categoryCache,
      credentials
    )
  }

  /**
   * Ensure merchant location exists
   */
  private async ensureMerchantLocation(): Promise<boolean> {
    const locationUrl = `${this.baseUrl}/sell/inventory/v1/location/${this.locationKey}`

    const response = await fetch(locationUrl, { headers: this.getHeaders() })

    if (response.status === 404) {
      console.log(`Creating merchant location '${this.locationKey}'...`)

      const locationData = {
        location: {
          address: {
            postalCode: '10001',
            country: 'US',
          },
        },
        locationTypes: ['WAREHOUSE'],
        name: 'US Warehouse',
        merchantLocationStatus: 'ENABLED',
      }

      const createResponse = await fetch(locationUrl, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(locationData),
      })

      if (![200, 201, 204].includes(createResponse.status)) {
        console.error('Failed to create location:', await createResponse.text())
        return false
      }

      console.log(`Created location '${this.locationKey}'`)
    } else {
      console.log(`Location '${this.locationKey}' already exists`)
    }

    return true
  }

  /**
   * Create inventory item
   */
  private async createInventoryItem(
    sku: string,
    title: string,
    description: string,
    images: string[],
    aspects: Record<string, string[]>,
    weight: { value: string; unit: 'POUND' }
  ): Promise<{ success: boolean; error?: string }> {
    const inventoryItem = {
      sku,
      locale: 'en_US',
      product: {
        title,
        description,
        imageUrls: images.slice(0, 12),
        aspects,
      },
      condition: 'NEW',
      packageWeightAndSize: {
        weight,
      },
      availability: {
        shipToLocationAvailability: {
          quantity: this.settings.defaultInventoryQuantity,
          availabilityDistributions: [
            {
              merchantLocationKey: this.locationKey,
              quantity: this.settings.defaultInventoryQuantity,
            },
          ],
        },
      },
    }

    const invUrl = `${this.baseUrl}/sell/inventory/v1/inventory_item/${sku}`
    const response = await fetch(invUrl, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify(inventoryItem),
    })

    if ([200, 201, 204].includes(response.status)) {
      console.log('  Inventory item created')
      return { success: true }
    } else {
      const errorText = await response.text()
      console.error('  Inventory item error:', errorText)
      return { success: false, error: errorText }
    }
  }

  /**
   * Create or update offer
   */
  private async createOrUpdateOffer(
    sku: string,
    categoryId: string,
    listingDescription: string,
    ebayPrice: number
  ): Promise<{ success: boolean; offerId?: string; error?: string }> {
    // Check for existing offer
    const checkUrl = `${this.baseUrl}/sell/inventory/v1/offer?sku=${sku}`
    const checkResponse = await fetch(checkUrl, { headers: this.getHeaders() })

    let existingOfferId: string | null = null
    if (checkResponse.status === 200) {
      const existingOffers = await checkResponse.json()
      if (existingOffers.offers?.length > 0) {
        existingOfferId = existingOffers.offers[0].offerId
        console.log(`  Found existing offer (ID: ${existingOfferId}), will update`)
      }
    }

    const offer = {
      sku,
      marketplaceId: 'EBAY_US',
      format: 'FIXED_PRICE',
      availableQuantity: this.settings.defaultInventoryQuantity,
      categoryId,
      listingDescription,
      listingPolicies: {
        paymentPolicyId: this.account.paymentPolicyId,
        returnPolicyId: this.account.returnPolicyId,
        fulfillmentPolicyId: this.account.fulfillmentPolicyId,
      },
      pricingSummary: {
        price: {
          value: ebayPrice.toFixed(2),
          currency: 'USD',
        },
      },
      merchantLocationKey: this.locationKey,
    }

    let response: Response
    let offerId: string

    if (existingOfferId) {
      // Update existing offer
      const offerUrl = `${this.baseUrl}/sell/inventory/v1/offer/${existingOfferId}`
      response = await fetch(offerUrl, {
        method: 'PUT',
        headers: this.getHeaders(),
        body: JSON.stringify(offer),
      })
      offerId = existingOfferId
    } else {
      // Create new offer
      const offerUrl = `${this.baseUrl}/sell/inventory/v1/offer`
      response = await fetch(offerUrl, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(offer),
      })

      if ([200, 201].includes(response.status)) {
        const data = await response.json()
        offerId = data.offerId
      } else {
        return { success: false, error: await response.text() }
      }
    }

    if ([200, 201, 204].includes(response.status)) {
      console.log(`  Offer ${existingOfferId ? 'updated' : 'created'} (ID: ${offerId!})`)
      return { success: true, offerId: offerId! }
    } else {
      return { success: false, error: await response.text() }
    }
  }

  /**
   * Publish offer
   */
  private async publishOffer(
    offerId: string
  ): Promise<{ success: boolean; listingId?: string; error?: string }> {
    const publishUrl = `${this.baseUrl}/sell/inventory/v1/offer/${offerId}/publish`
    const response = await fetch(publishUrl, {
      method: 'POST',
      headers: this.getHeaders(),
    })

    if ([200, 201].includes(response.status)) {
      const data = await response.json()
      return { success: true, listingId: data.listingId }
    } else {
      return { success: false, error: await response.text() }
    }
  }

  /**
   * Process a single product
   */
  private async processProduct(
    product: AmazonProduct,
    index: number,
    total: number
  ): Promise<ListingResult> {
    const sku = product.asin

    this.reportProgress(index, total, sku, 'Starting', `Processing ${product.title.substring(0, 50)}...`)

    try {
      // Step 1: Process product data (sanitize, calculate price, etc.)
      const processed = processProduct(product, this.settings)

      if (processed.violations.length > 0) {
        console.log(`  Sanitized ${processed.violations.length} policy violations`)
      }

      // Step 2: Vector DB + LLM optimizes title, extracts brand, selects category
      this.reportProgress(index, total, sku, 'Category', 'Vector DB + LLM selecting category...')

      if (!this.categorySelector) {
        throw new Error('Category selector not initialized')
      }

      const optimization = await this.categorySelector.optimizeTitleAndSelectCategory(
        product.title,
        processed.description,
        processed.bulletPoints,
        processed.specifications
      )

      console.log(`  Optimized Title: ${optimization.optimizedTitle}`)
      console.log(`  Brand: ${optimization.brand}`)
      console.log(`  Category: ${optimization.categoryName} (ID: ${optimization.categoryId})`)

      // Step 3: Get and fill category requirements
      this.reportProgress(index, total, sku, 'Requirements', 'Fetching category requirements...')

      const requirements = await this.categorySelector.getCategoryRequirements(optimization.categoryId)

      let filledAspects: FilledAspects = {}
      if (requirements.required.length > 0 || requirements.recommended.length > 0) {
        this.reportProgress(index, total, sku, 'Aspects', 'LLM filling aspects...')

        filledAspects = await this.categorySelector.fillCategoryRequirements(
          {
            title: optimization.optimizedTitle,
            description: processed.description,
            bulletPoints: processed.bulletPoints,
            specifications: processed.specifications,
          },
          requirements,
          true // Include recommended aspects
        )
      }

      // Build aspects object
      const aspects: Record<string, string[]> = {
        Brand: [optimization.brand],
        MPN: [sku],
        Condition: ['New'],
      }

      // Add filled aspects (don't overwrite protected ones)
      const protectedAspects = new Set(['Brand', 'MPN', 'Condition'])
      for (const [name, value] of Object.entries(filledAspects)) {
        if (protectedAspects.has(name)) continue
        if (!value || (typeof value === 'string' && !value.trim())) continue

        aspects[name] = Array.isArray(value) ? value : [value]
      }

      // Step 4: Create inventory item
      this.reportProgress(index, total, sku, 'Inventory', 'Creating inventory item...')

      const inventoryResult = await this.createInventoryItem(
        sku,
        optimization.optimizedTitle,
        processed.description,
        processed.images,
        aspects,
        processed.weight || { value: '1.0', unit: 'POUND' }
      )

      if (!inventoryResult.success) {
        return { sku, status: 'failed', stage: 'inventory', error: inventoryResult.error || 'Failed to create inventory item' }
      }

      // Step 5: Build HTML description
      const listingDescription = buildHtmlDescription({
        title: optimization.optimizedTitle,
        description: processed.description,
        bulletPoints: processed.bulletPoints,
        bulletPointImages: processed.bulletPointImages,
        images: processed.images,
        specifications: processed.specifications,
      })

      // Step 6: Create or update offer
      this.reportProgress(index, total, sku, 'Offer', 'Creating offer...')

      const offerResult = await this.createOrUpdateOffer(
        sku,
        optimization.categoryId,
        listingDescription,
        processed.ebayPrice
      )

      if (!offerResult.success) {
        return {
          sku,
          status: 'failed',
          stage: 'offer',
          error: offerResult.error,
          categoryId: optimization.categoryId,
        }
      }

      // Step 7: Publish offer
      this.reportProgress(index, total, sku, 'Publish', 'Publishing listing...')

      const publishResult = await this.publishOffer(offerResult.offerId!)

      if (publishResult.success) {
        console.log(`  SUCCESS! Listing ID: ${publishResult.listingId}`)
        console.log(`  View at: https://www.ebay.com/itm/${publishResult.listingId}`)

        return {
          sku,
          status: 'success',
          categoryId: optimization.categoryId,
          categoryName: optimization.categoryName,
          offerId: offerResult.offerId,
          listingId: publishResult.listingId,
          ebayPrice: processed.ebayPrice,
        }
      } else {
        return {
          sku,
          status: 'failed',
          stage: 'publish',
          error: publishResult.error,
          categoryId: optimization.categoryId,
          offerId: offerResult.offerId,
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error(`  Error processing ${sku}:`, errorMessage)
      return { sku, status: 'failed', stage: 'processing', error: errorMessage }
    }
  }

  /**
   * Process all products from a JSON file
   */
  async processProducts(
    products: AmazonProduct[],
    anthropicApiKey: string
  ): Promise<ListingResult[]> {
    console.log('=' .repeat(70))
    console.log('Complete eBay Listing Flow with Vector DB + LLM Hybrid')
    console.log(`Account: ${this.account.id}`)
    console.log('=' .repeat(70))

    // Load access token
    if (!(await this.loadAccessToken())) {
      throw new Error('Failed to load access token. Please re-authorize the account.')
    }

    // Initialize category cache
    const credentials: EbayCredentials = {
      appId: this.account.ebayAppId,
      certId: this.account.ebayCertId,
      environment: this.account.ebayEnvironment,
    }

    console.log('\nInitializing category cache...')
    await this.categoryCache.initialize(credentials)
    console.log(`  Category cache loaded with ${this.categoryCache.getCategoryCount()} categories`)

    // Initialize vector DB from category cache (if not already initialized)
    console.log('\nInitializing vector database...')
    if (!this.vectorDB.hasData()) {
      console.log('  Building vector index from category cache (first run)...')
      await this.vectorDB.initializeFromCache(this.categoryCache)
    }
    console.log(`  Vector DB loaded with ${this.vectorDB.getCategoryCount()} categories`)

    // Initialize Semantic category selector (Vector DB + LLM hybrid)
    console.log('\nInitializing semantic category selector...')
    this.initializeCategorySelector(anthropicApiKey)
    console.log('  Semantic selector initialized (Vector DB + LLM hybrid)')

    // Ensure merchant location exists
    console.log('\nEnsuring merchant location exists...')
    if (!(await this.ensureMerchantLocation())) {
      throw new Error('Failed to create merchant location')
    }

    // Process each product
    console.log(`\nProcessing ${products.length} products...`)
    const results: ListingResult[] = []

    for (let i = 0; i < products.length; i++) {
      console.log('\n' + '=' .repeat(70))
      console.log(`Processing Product ${i + 1}/${products.length}`)
      console.log('=' .repeat(70))

      const result = await this.processProduct(products[i], i + 1, products.length)
      results.push(result)
    }

    // Summary
    const successful = results.filter((r) => r.status === 'success')
    const failed = results.filter((r) => r.status === 'failed')

    console.log('\n' + '=' .repeat(70))
    console.log('FINAL SUMMARY')
    console.log('=' .repeat(70))
    console.log(`\nTotal products processed: ${products.length}`)
    console.log(`Successfully published: ${successful.length}`)
    console.log(`Failed: ${failed.length}`)

    if (successful.length > 0) {
      console.log('\n[SUCCESS] Published listings:')
      for (const result of successful) {
        console.log(`  - ${result.sku}: ${result.categoryName} (ID: ${result.categoryId})`)
        console.log(`    https://www.ebay.com/itm/${result.listingId}`)
      }
    }

    if (failed.length > 0) {
      console.log('\n[FAILED] Failed listings:')
      for (const result of failed) {
        console.log(`  - ${result.sku}: Failed at ${result.stage}`)
        if (result.error) {
          console.log(`    Error: ${result.error.substring(0, 100)}...`)
        }
      }
    }

    return results
  }
}