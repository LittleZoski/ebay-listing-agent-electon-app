/**
 * eBay Order Service
 * Fetches unshipped orders from eBay and prepares them for fulfillment
 * Ported from Python orders_flow.py
 */

import fs from 'fs'
import path from 'path'
import { app } from 'electron'

// ============================================================================
// Types and Interfaces
// ============================================================================

export interface EbayOrderAccount {
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

// ============================================================================
// eBay Order Service Class
// ============================================================================

export class EbayOrderService {
  private account: EbayOrderAccount
  private accountName: string
  private accessToken: string | null = null
  private baseUrl: string
  private outputFolder: string

  constructor(account: EbayOrderAccount, accountName: string, outputFolder?: string) {
    this.account = account
    this.accountName = accountName
    this.baseUrl =
      account.ebayEnvironment === 'PRODUCTION'
        ? 'https://api.ebay.com'
        : 'https://api.sandbox.ebay.com'

    // Use provided output folder or default to user data directory
    this.outputFolder = outputFolder || path.join(app.getPath('userData'), 'ebay_orders')
    if (!fs.existsSync(this.outputFolder)) {
      fs.mkdirSync(this.outputFolder, { recursive: true })
    }
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

      fs.writeFileSync(
        this.account.tokenFile,
        JSON.stringify(newTokenData, null, 2)
      )
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
    }
  }

  /**
   * Fetch unshipped orders from eBay
   * Uses eBay Fulfillment API: getOrders
   * https://developer.ebay.com/api-docs/sell/fulfillment/resources/order/methods/getOrders
   */
  private async getUnshippedOrders(
    limit: number = 50,
    offset: number = 0
  ): Promise<{ orders: unknown[]; total: number }> {
    const endpoint = `${this.baseUrl}/sell/fulfillment/v1/order`

    // Filter for orders that are NOT_STARTED or IN_PROGRESS
    const params = new URLSearchParams({
      filter: 'orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}',
      limit: Math.min(limit, 200).toString(),
      offset: offset.toString(),
    })

    console.log(`Fetching unshipped orders (offset: ${offset})...`)

    const response = await fetch(`${endpoint}?${params}`, {
      headers: this.getHeaders(),
    })

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Authentication failed. Please re-authorize the account.')
      }
      const errorText = await response.text()
      throw new Error(`API Error: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    const orders = data.orders || []
    const total = data.total || 0

    console.log(`Found ${orders.length} orders (Total: ${total})`)
    return { orders, total }
  }

  /**
   * Extract shipping information from eBay order
   */
  private extractShippingInfo(order: Record<string, unknown>): ShippingAddress {
    const buyer = (order.buyer || {}) as Record<string, unknown>
    const buyerRegAddress = (buyer.buyerRegistrationAddress || {}) as Record<string, unknown>

    // Extract shipping address from fulfillmentStartInstructions
    const fulfillmentInstructions = (order.fulfillmentStartInstructions || []) as Array<Record<string, unknown>>

    let shippingAddress: Record<string, unknown> = {}
    let fullName = ''
    let primaryPhone = ''
    let email = (buyer.email as string) || ''

    if (fulfillmentInstructions.length > 0) {
      const firstInstruction = fulfillmentInstructions[0]
      const shippingStep = (firstInstruction.shippingStep || {}) as Record<string, unknown>
      const shipTo = (shippingStep.shipTo || {}) as Record<string, unknown>
      shippingAddress = (shipTo.contactAddress || {}) as Record<string, unknown>
      fullName = (shipTo.fullName as string) || ''
      const phoneObj = (shipTo.primaryPhone || {}) as Record<string, unknown>
      primaryPhone = (phoneObj.phoneNumber as string) || ''
      email = (shipTo.email as string) || email
    } else {
      // Fallback to buyer registration address
      shippingAddress = (buyerRegAddress.contactAddress || {}) as Record<string, unknown>
      fullName = (buyerRegAddress.fullName as string) || ''
      const phoneObj = (buyerRegAddress.primaryPhone || {}) as Record<string, unknown>
      primaryPhone = (phoneObj.phoneNumber as string) || ''
    }

    return {
      name: fullName,
      addressLine1: (shippingAddress.addressLine1 as string) || '',
      addressLine2: (shippingAddress.addressLine2 as string) || '',
      city: (shippingAddress.city as string) || '',
      stateOrProvince: (shippingAddress.stateOrProvince as string) || '',
      postalCode: (shippingAddress.postalCode as string) || '',
      countryCode: (shippingAddress.countryCode as string) || 'US',
      phoneNumber: primaryPhone,
      email: email,
    }
  }

  /**
   * Extract line items from eBay order
   */
  private extractLineItems(order: Record<string, unknown>): OrderLineItem[] {
    const lineItems = (order.lineItems || []) as Array<Record<string, unknown>>
    const extractedItems: OrderLineItem[] = []

    for (const item of lineItems) {
      const sku = (item.sku as string) || ''
      const lineItemId = (item.lineItemId as string) || ''
      const title = (item.title as string) || ''
      const quantity = (item.quantity as number) || 1

      // Extract pricing
      const lineItemCost = (item.lineItemCost || {}) as Record<string, unknown>
      const value = (lineItemCost.value as string) || '0.00'
      const currency = (lineItemCost.currency as string) || 'USD'

      extractedItems.push({
        lineItemId,
        sku,
        asin: sku, // SKU is the Amazon ASIN
        title,
        quantity,
        price: parseFloat(value),
        currency,
      })
    }

    return extractedItems
  }

  /**
   * Map eBay order to our standard format
   */
  private mapOrderToFormat(order: Record<string, unknown>): EbayOrder {
    const orderId = (order.orderId as string) || ''
    const orderDate = (order.creationDate as string) || ''
    const orderStatus = (order.orderFulfillmentStatus as string) || ''

    const shippingInfo = this.extractShippingInfo(order)
    const lineItems = this.extractLineItems(order)

    // Extract payment summary
    const paymentSummary = (order.paymentSummary || {}) as Record<string, unknown>
    const totalPaid = (paymentSummary.totalDueSeller || {}) as Record<string, unknown>

    return {
      ebayOrderId: orderId,
      ebayOrderDate: orderDate,
      ebayOrderStatus: orderStatus,
      totalPaidByBuyer: {
        amount: (totalPaid.value as string) || '0.00',
        currency: (totalPaid.currency as string) || 'USD',
      },
      shippingAddress: shippingInfo,
      items: lineItems,
      orderNote: `eBay Order ${orderId} - Ship to buyer address above`,
      processedAt: new Date().toISOString(),
    }
  }

  /**
   * Fetch all unshipped orders and return them
   */
  async fetchOrders(limit: number = 50): Promise<FetchOrdersResult> {
    console.log('='.repeat(70))
    console.log(`eBay Order Fetch - ${this.accountName}`)
    console.log('='.repeat(70))

    // Load access token
    if (!(await this.loadAccessToken())) {
      return {
        success: false,
        accountName: this.accountName,
        totalOrders: 0,
        orders: [],
        error: 'Failed to load access token. Please re-authorize the account.',
      }
    }

    try {
      // Fetch orders with pagination
      const allOrders: unknown[] = []
      let offset = 0
      let hasMore = true

      while (hasMore) {
        const { orders, total } = await this.getUnshippedOrders(limit, offset)
        allOrders.push(...orders)

        offset += orders.length
        hasMore = offset < total && orders.length > 0

        if (hasMore) {
          console.log(`Fetched ${offset}/${total} orders. Continuing...`)
        }
      }

      console.log(`Total unshipped orders fetched: ${allOrders.length}`)

      if (allOrders.length === 0) {
        return {
          success: true,
          accountName: this.accountName,
          totalOrders: 0,
          orders: [],
        }
      }

      // Map orders to our format
      console.log('Mapping orders to standard format...')
      const mappedOrders: EbayOrder[] = []

      for (const order of allOrders) {
        try {
          const mappedOrder = this.mapOrderToFormat(order as Record<string, unknown>)
          mappedOrders.push(mappedOrder)
          console.log(
            `  Mapped order ${mappedOrder.ebayOrderId} with ${mappedOrder.items.length} items`
          )
        } catch (error) {
          console.error(`  Failed to map order:`, error)
        }
      }

      // Export to JSON file
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const outputFilename = `ebay-orders-${timestamp}.json`
      const outputPath = path.join(this.outputFolder, outputFilename)

      const exportData: OrderExport = {
        exportedAt: new Date().toISOString(),
        accountId: this.account.id,
        accountName: this.accountName,
        totalOrders: mappedOrders.length,
        orders: mappedOrders,
      }

      fs.writeFileSync(outputPath, JSON.stringify(exportData, null, 2))
      console.log(`Exported ${mappedOrders.length} orders to: ${outputPath}`)

      return {
        success: true,
        accountName: this.accountName,
        totalOrders: mappedOrders.length,
        orders: mappedOrders,
        exportPath: outputPath,
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error('Order fetch failed:', errorMessage)
      return {
        success: false,
        accountName: this.accountName,
        totalOrders: 0,
        orders: [],
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
   * Load previously exported orders
   */
  static loadExportedOrders(filePath: string): OrderExport | null {
    try {
      if (!fs.existsSync(filePath)) {
        return null
      }
      const data = fs.readFileSync(filePath, 'utf-8')
      return JSON.parse(data) as OrderExport
    } catch (error) {
      console.error('Error loading exported orders:', error)
      return null
    }
  }

  /**
   * List all exported order files
   */
  listExportedOrderFiles(): string[] {
    try {
      const files = fs.readdirSync(this.outputFolder)
      return files
        .filter((f) => f.startsWith('ebay-orders-') && f.endsWith('.json'))
        .sort()
        .reverse() // Most recent first
    } catch (error) {
      console.error('Error listing export files:', error)
      return []
    }
  }
}