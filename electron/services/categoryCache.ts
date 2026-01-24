/**
 * eBay Category Cache System using Taxonomy API
 * Downloads and caches the complete category tree for fast lookups
 * Ported from Python: category_cache.py
 */

import fs from 'fs'
import path from 'path'
import { app } from 'electron'

export interface Category {
  id: string
  name: string
  parentId: string | null
  level: number
  leaf: boolean
}

export interface CategoryCacheData {
  categories: Record<string, Category>
  version: string | null
  lastUpdated: string | null
}

export interface EbayCredentials {
  appId: string
  certId: string
  environment: 'SANDBOX' | 'PRODUCTION'
}

/**
 * Category Cache class for managing eBay category tree
 */
export class CategoryCache {
  private cacheFile: string
  private categories: Record<string, Category> = {}
  private categoryTreeVersion: string | null = null
  private lastUpdated: Date | null = null
  private appToken: string | null = null
  private tokenExpiresAt: number = 0

  constructor(cacheFileName: string = 'ebay_categories_cache.json') {
    // Store cache in app data directory
    const appDataPath = app.getPath('userData')
    this.cacheFile = path.join(appDataPath, cacheFileName)
  }

  /**
   * Get application token for Taxonomy API
   */
  private async getApplicationToken(credentials: EbayCredentials): Promise<string> {
    // Check if we have a valid cached token
    if (this.appToken && Date.now() < this.tokenExpiresAt) {
      return this.appToken
    }

    console.log('Requesting new eBay application token...')

    const tokenUrl =
      credentials.environment === 'PRODUCTION'
        ? 'https://api.ebay.com/identity/v1/oauth2/token'
        : 'https://api.sandbox.ebay.com/identity/v1/oauth2/token'

    const b64Credentials = Buffer.from(
      `${credentials.appId}:${credentials.certId}`
    ).toString('base64')

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${b64Credentials}`,
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        scope: 'https://api.ebay.com/oauth/api_scope',
      }).toString(),
    })

    if (!response.ok) {
      throw new Error(`Failed to get application token: ${response.status} - ${await response.text()}`)
    }

    const tokenData = await response.json()
    this.appToken = tokenData.access_token
    // Set expiration (typically 7200 seconds = 2 hours), refresh 5 minutes early
    const expiresIn = tokenData.expires_in || 7200
    this.tokenExpiresAt = Date.now() + (expiresIn - 300) * 1000

    console.log('Successfully obtained application token')
    return this.appToken!
  }

  /**
   * Check if cached data is still valid
   */
  isCacheValid(maxAgeDays: number = 90): boolean {
    if (!fs.existsSync(this.cacheFile)) {
      return false
    }

    if (!this.lastUpdated) {
      this.loadCache()
    }

    if (!this.lastUpdated) {
      return false
    }

    const ageMs = Date.now() - this.lastUpdated.getTime()
    const ageDays = ageMs / (1000 * 60 * 60 * 24)
    return ageDays < maxAgeDays
  }

  /**
   * Load category data from cache file
   */
  loadCache(): boolean {
    try {
      if (!fs.existsSync(this.cacheFile)) {
        console.log('No category cache file found')
        return false
      }

      const data = JSON.parse(fs.readFileSync(this.cacheFile, 'utf-8')) as CategoryCacheData
      this.categories = data.categories || {}
      this.categoryTreeVersion = data.version || null

      if (data.lastUpdated) {
        this.lastUpdated = new Date(data.lastUpdated)
      }

      console.log(`Loaded ${Object.keys(this.categories).length} categories from cache`)
      console.log(`Cache version: ${this.categoryTreeVersion}, Last updated: ${this.lastUpdated}`)

      return true
    } catch (error) {
      console.error('Failed to load category cache:', error)
      return false
    }
  }

  /**
   * Save category data to cache file
   */
  private saveCache(): void {
    try {
      const data: CategoryCacheData = {
        categories: this.categories,
        version: this.categoryTreeVersion,
        lastUpdated: this.lastUpdated?.toISOString() || null,
      }

      fs.writeFileSync(this.cacheFile, JSON.stringify(data, null, 2))
      console.log(`Saved ${Object.keys(this.categories).length} categories to cache`)
    } catch (error) {
      console.error('Failed to save category cache:', error)
    }
  }

  /**
   * Download complete category tree from eBay Taxonomy API
   */
  async downloadCategories(
    credentials: EbayCredentials,
    marketplaceId: string = 'EBAY_US'
  ): Promise<boolean> {
    try {
      console.log(`Downloading category tree for ${marketplaceId}...`)

      const token = await this.getApplicationToken(credentials)
      const baseUrl =
        credentials.environment === 'PRODUCTION'
          ? 'https://api.ebay.com'
          : 'https://api.sandbox.ebay.com'

      const headers = {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      }

      // Get category tree (ID 0 = EBAY_US)
      const categoryTreeId = '0'
      const treeUrl = `${baseUrl}/commerce/taxonomy/v1/category_tree/${categoryTreeId}`

      const response = await fetch(treeUrl, { headers, signal: AbortSignal.timeout(60000) })

      if (!response.ok) {
        console.error(`Failed to get category tree: ${response.status} - ${await response.text()}`)
        return false
      }

      const treeData = await response.json()
      this.categoryTreeVersion = treeData.categoryTreeVersion

      console.log(`Category tree version: ${this.categoryTreeVersion}`)

      // Parse the entire category tree
      const rootNode = treeData.rootCategoryNode
      if (!rootNode) {
        console.error('No root category node found')
        return false
      }

      // Parse and store categories
      this.categories = {}
      this.parseCategoryTree(rootNode, null)

      this.lastUpdated = new Date()

      console.log(`Successfully downloaded ${Object.keys(this.categories).length} categories`)

      // Save to cache
      this.saveCache()

      return true
    } catch (error) {
      console.error('Exception downloading categories:', error)
      return false
    }
  }

  /**
   * Recursively parse category tree node
   */
  private parseCategoryTree(
    node: { category?: { categoryId?: string; categoryName?: string }; categoryTreeNodeLevel?: number; childCategoryTreeNodes?: unknown[] },
    parentId: string | null
  ): void {
    if (!node) return

    const category = node.category || {}
    const categoryId = category.categoryId

    if (categoryId) {
      this.categories[categoryId] = {
        id: categoryId,
        name: category.categoryName || '',
        parentId,
        level: node.categoryTreeNodeLevel || 0,
        leaf: !node.childCategoryTreeNodes || node.childCategoryTreeNodes.length === 0,
      }
    }

    // Recurse into children
    const children = node.childCategoryTreeNodes || []
    for (const child of children) {
      this.parseCategoryTree(child as typeof node, categoryId || null)
    }
  }

  /**
   * Get category information by ID
   */
  getCategory(categoryId: string): Category | null {
    return this.categories[categoryId] || null
  }

  /**
   * Check if category is a leaf category (can be used for listings)
   */
  isLeafCategory(categoryId: string): boolean {
    const category = this.getCategory(categoryId)
    return category?.leaf || false
  }

  /**
   * Search for categories by name keyword
   */
  searchCategories(keyword: string, leafOnly: boolean = true): Category[] {
    const keywordLower = keyword.toLowerCase()
    const results: Category[] = []

    for (const category of Object.values(this.categories)) {
      if (category.name.toLowerCase().includes(keywordLower)) {
        if (!leafOnly || category.leaf) {
          results.push(category)
        }
      }
    }

    // Sort by name
    results.sort((a, b) => a.name.localeCompare(b.name))

    return results
  }

  /**
   * Get full category path (e.g., "eBay Motors > Parts & Accessories > Wiper Blades")
   */
  getCategoryPath(categoryId: string): string {
    const pathParts: string[] = []
    let currentId: string | null = categoryId

    while (currentId) {
      const category = this.getCategory(currentId)
      if (!category) break

      pathParts.unshift(category.name)
      currentId = category.parentId
    }

    return pathParts.join(' > ')
  }

  /**
   * Initialize category cache (load from file or download if needed)
   */
  async initialize(credentials: EbayCredentials, forceRefresh: boolean = false): Promise<boolean> {
    if (!forceRefresh && this.isCacheValid()) {
      console.log('Using existing category cache')
      return true
    }

    console.log('Category cache is stale or missing, downloading...')
    return this.downloadCategories(credentials)
  }

  /**
   * Get all leaf categories at specific levels (2-4)
   */
  getLeafCategories(minLevel: number = 2, maxLevel: number = 4): Category[] {
    return Object.values(this.categories).filter(
      (cat) => cat.leaf && cat.level >= minLevel && cat.level <= maxLevel
    )
  }

  /**
   * Get category count
   */
  getCategoryCount(): number {
    return Object.keys(this.categories).length
  }

  /**
   * Get all categories as array
   */
  getAllCategories(): Category[] {
    return Object.values(this.categories)
  }
}

// Singleton instance
let categoryCacheInstance: CategoryCache | null = null

export function getCategoryCache(): CategoryCache {
  if (!categoryCacheInstance) {
    categoryCacheInstance = new CategoryCache()
  }
  return categoryCacheInstance
}