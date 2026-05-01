/**
 * eBay Listing Update Service
 * Uses the Inventory API to revise prices and withdraw (end) listings.
 */

import fs from 'fs'

interface AccountCredentials {
  ebayAppId: string
  ebayCertId: string
  ebayEnvironment: 'SANDBOX' | 'PRODUCTION'
  tokenFile: string
}

interface TokenData {
  access_token: string
  refresh_token?: string
  expires_in?: number
  token_expiry?: number
  timestamp?: string
}

export interface UpdatePriceResult {
  success: boolean
  sku: string
  newPrice: number
  offerId?: string
  error?: string
}

export interface EndListingResult {
  success: boolean
  sku: string
  offerId?: string
  error?: string
}

function getBaseUrl(environment: 'SANDBOX' | 'PRODUCTION'): string {
  return environment === 'PRODUCTION' ? 'https://api.ebay.com' : 'https://api.sandbox.ebay.com'
}

export async function getAccessToken(account: AccountCredentials): Promise<string | null> {
  try {
    if (!fs.existsSync(account.tokenFile)) return null
    const tokenData = JSON.parse(fs.readFileSync(account.tokenFile, 'utf-8')) as TokenData
    if (!tokenData.access_token) return null

    // Refresh if expired
    if (tokenData.token_expiry) {
      const now = Date.now() / 1000
      if (now >= tokenData.token_expiry - 300 && tokenData.refresh_token) {
        const baseUrl = getBaseUrl(account.ebayEnvironment)
        const credentials = Buffer.from(`${account.ebayAppId}:${account.ebayCertId}`).toString('base64')
        const resp = await fetch(`${baseUrl}/identity/v1/oauth2/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${credentials}` },
          body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokenData.refresh_token }).toString(),
        })
        if (!resp.ok) return null
        const refreshed = await resp.json()
        const updated: TokenData = {
          access_token: refreshed.access_token,
          refresh_token: refreshed.refresh_token || tokenData.refresh_token,
          expires_in: refreshed.expires_in,
          token_expiry: Date.now() / 1000 + (refreshed.expires_in || 7200),
          timestamp: new Date().toISOString(),
        }
        fs.writeFileSync(account.tokenFile, JSON.stringify(updated, null, 2))
        return updated.access_token
      }
    }

    return tokenData.access_token
  } catch {
    return null
  }
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'Accept-Language': 'en-US',
    'Content-Language': 'en-US',
  }
}

async function getOfferIdBySku(
  baseUrl: string,
  token: string,
  sku: string
): Promise<string | null> {
  const resp = await fetch(`${baseUrl}/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}`, {
    headers: authHeaders(token),
  })
  if (!resp.ok) return null
  const data = await resp.json()
  return data.offers?.[0]?.offerId ?? null
}

export async function updateListingPrice(
  account: AccountCredentials,
  sku: string,
  newPrice: number,
  accessToken?: string
): Promise<UpdatePriceResult> {
  const token = accessToken ?? await getAccessToken(account)
  if (!token) return { success: false, sku, newPrice, error: 'Failed to load access token' }

  const baseUrl = getBaseUrl(account.ebayEnvironment)

  // Get current offer to retrieve full payload
  const offerResp = await fetch(`${baseUrl}/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}`, {
    headers: authHeaders(token),
  })
  if (!offerResp.ok) {
    const body = await offerResp.text()
    return { success: false, sku, newPrice, error: `Offer lookup failed: ${body}` }
  }

  const offerData = await offerResp.json()
  const offer = offerData.offers?.[0]
  if (!offer) return { success: false, sku, newPrice, error: 'No offer found for SKU' }

  const offerId: string = offer.offerId

  // Build update body preserving all existing fields, just change price
  const updateBody = {
    ...offer,
    pricingSummary: {
      ...offer.pricingSummary,
      price: { value: newPrice.toFixed(2), currency: 'USD' },
    },
  }
  // Remove read-only fields that eBay rejects in PUT
  delete updateBody.offerId
  delete updateBody.listingId
  delete updateBody.status
  delete updateBody.listingStatus

  const putResp = await fetch(`${baseUrl}/sell/inventory/v1/offer/${offerId}`, {
    method: 'PUT',
    headers: authHeaders(token),
    body: JSON.stringify(updateBody),
  })

  if (putResp.status === 200 || putResp.status === 204) {
    return { success: true, sku, newPrice, offerId }
  }

  const errBody = await putResp.text()
  return { success: false, sku, newPrice, offerId, error: `PUT offer failed (${putResp.status}): ${errBody}` }
}

export async function endListing(
  account: AccountCredentials,
  sku: string,
  accessToken?: string
): Promise<EndListingResult> {
  const token = accessToken ?? await getAccessToken(account)
  if (!token) return { success: false, sku, error: 'Failed to load access token' }

  const baseUrl = getBaseUrl(account.ebayEnvironment)
  const offerId = await getOfferIdBySku(baseUrl, token, sku)
  if (!offerId) return { success: false, sku, error: 'No offer found for SKU' }

  const resp = await fetch(`${baseUrl}/sell/inventory/v1/offer/${offerId}/withdraw`, {
    method: 'POST',
    headers: authHeaders(token),
    body: '{}',
  })

  if (resp.status === 200 || resp.status === 202 || resp.status === 204) {
    return { success: true, sku, offerId }
  }

  const errBody = await resp.text()
  return { success: false, sku, offerId, error: `Withdraw failed (${resp.status}): ${errBody}` }
}
