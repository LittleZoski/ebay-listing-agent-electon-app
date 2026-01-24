/**
 * Product Data Mapper: Amazon -> eBay
 * Maps Amazon product data to eBay Inventory API format
 * Ported from Python: product_mapper.py
 */

import { sanitizeProductData } from './dataSanitizer'

export interface GlobalSettings {
  // Amazon Pricing Tiers
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

  // Yami Pricing Tiers
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
  defaultInventoryQuantity: number
}

export interface AmazonProduct {
  asin: string
  title: string
  description?: string
  bulletPoints?: string[]
  specifications?: Record<string, string>
  images?: string[]
  price?: string
  deliveryFee?: string
  source?: string
  price_multiplier?: number
}

export interface PricingTier {
  maxPrice: number
  multiplier: number
}

/**
 * Parse numeric price from price string
 * Examples: "$29.99", "$1,299.00", "£19.99"
 */
export function parsePrice(priceStr: string | undefined): number {
  if (!priceStr) return 0.0

  // Remove currency symbols and commas
  const cleaned = priceStr.replace(/[£$€,]/g, '').trim()

  const parsed = parseFloat(cleaned)
  return isNaN(parsed) ? 0.0 : parsed
}

/**
 * Build pricing tiers from settings for a specific source
 */
function buildPricingTiers(settings: GlobalSettings, source: string): PricingTier[] {
  if (source === 'yami') {
    return [
      { maxPrice: settings.yamiTier1MaxPrice, multiplier: settings.yamiTier1Multiplier },
      { maxPrice: settings.yamiTier2MaxPrice, multiplier: settings.yamiTier2Multiplier },
      { maxPrice: settings.yamiTier3MaxPrice, multiplier: settings.yamiTier3Multiplier },
      { maxPrice: settings.yamiTier4MaxPrice, multiplier: settings.yamiTier4Multiplier },
      { maxPrice: settings.yamiTier5MaxPrice, multiplier: settings.yamiTier5Multiplier },
      { maxPrice: settings.yamiTier6MaxPrice, multiplier: settings.yamiTier6Multiplier },
      { maxPrice: Infinity, multiplier: settings.yamiTier7Multiplier },
    ]
  }

  // Default to Amazon tiers
  return [
    { maxPrice: settings.amazonTier1MaxPrice, multiplier: settings.amazonTier1Multiplier },
    { maxPrice: settings.amazonTier2MaxPrice, multiplier: settings.amazonTier2Multiplier },
    { maxPrice: settings.amazonTier3MaxPrice, multiplier: settings.amazonTier3Multiplier },
    { maxPrice: settings.amazonTier4MaxPrice, multiplier: settings.amazonTier4Multiplier },
    { maxPrice: settings.amazonTier5MaxPrice, multiplier: settings.amazonTier5Multiplier },
    { maxPrice: settings.amazonTier6MaxPrice, multiplier: settings.amazonTier6Multiplier },
    { maxPrice: Infinity, multiplier: settings.amazonTier7Multiplier },
  ]
}

/**
 * Get the appropriate price multiplier based on source-specific tiered pricing strategy
 */
export function getTieredMultiplier(
  price: number,
  settings: GlobalSettings,
  source?: string
): number {
  const tiers = buildPricingTiers(settings, source || 'amazon')

  for (const tier of tiers) {
    if (price < tier.maxPrice) {
      return tier.multiplier
    }
  }

  // If we reach here, use the last tier's multiplier
  return tiers[tiers.length - 1].multiplier
}

/**
 * Apply charm pricing strategy to make prices more psychologically appealing
 *
 * Strategies:
 * - always_99: Round to .99 (e.g., $23.67 -> $23.99)
 * - always_49: Round to .49 (e.g., $23.67 -> $23.49)
 * - tiered: Under $20 use .99, $20+ use .95
 */
export function applyCharmPricing(
  price: number,
  strategy: GlobalSettings['charmPricingStrategy']
): number {
  if (price <= 0) return 0.0

  const dollarAmount = Math.floor(price)

  switch (strategy) {
    case 'always_99':
      return dollarAmount + 0.99

    case 'always_49':
      return dollarAmount + 0.49

    case 'tiered':
      // Under $20 use .99 (impulse buys), $20+ use .95 (quality signal)
      return price < 20 ? dollarAmount + 0.99 : dollarAmount + 0.95

    default:
      return Math.round(price * 100) / 100
  }
}

/**
 * Calculate eBay listing price with source-specific multiplier or markup, including delivery fee
 *
 * Calculation flow:
 * 1. Apply source-specific tiered multiplier to (product price + delivery fee)
 * 2. Apply charm pricing strategy (.99, .49, or tiered)
 * 3. This ensures you profit on both the item cost AND shipping cost
 */
export function calculateEbayPrice(
  amazonPrice: number,
  settings: GlobalSettings,
  options: {
    deliveryFee?: number
    multiplier?: number
    source?: string
  } = {}
): number {
  if (amazonPrice <= 0) return 0.0

  const { deliveryFee = 0, multiplier, source } = options

  // Total cost = product price + delivery fee
  const totalCost = amazonPrice + deliveryFee

  let calculatedPrice: number

  if (multiplier !== undefined && multiplier !== null) {
    // Use the multiplier directly (from product data)
    calculatedPrice = totalCost * multiplier
  } else {
    // Use source-specific tiered pricing strategy based on total cost
    const tieredMultiplier = getTieredMultiplier(totalCost, settings, source)
    calculatedPrice = totalCost * tieredMultiplier
  }

  // Apply charm pricing strategy
  return applyCharmPricing(calculatedPrice, settings.charmPricingStrategy)
}

/**
 * Generate unique SKU for eBay listing (uses ASIN)
 */
export function generateSku(asin: string): string {
  return asin
}

/**
 * Truncate title to eBay's 80 character limit
 */
export function truncateTitle(title: string, maxLength: number = 80): string {
  if (title.length <= maxLength) return title

  // Smart truncate: break at word boundary
  const truncated = title.substring(0, maxLength - 3)
  const lastSpace = truncated.lastIndexOf(' ')

  if (lastSpace > 0) {
    return truncated.substring(0, lastSpace) + '...'
  }

  return truncated + '...'
}

/**
 * Extract brand from title or description
 */
export function extractBrand(title: string, specifications?: Record<string, string>): string {
  // Invalid brand names that eBay rejects
  const invalidBrands = new Set([
    'custom',
    'personalized',
    'handmade',
    'vintage',
    'unique',
    'new',
    'brand',
    'the',
    'a',
    'an',
    'with',
    'for',
    'and',
  ])

  // Check specifications first
  if (specifications) {
    for (const [key, value] of Object.entries(specifications)) {
      const keyLower = key.toLowerCase()
      if (
        (keyLower === 'brand' || keyLower === 'brand name' || keyLower === 'manufacturer') &&
        value
      ) {
        const brand = value.trim()
        if (!invalidBrands.has(brand.toLowerCase())) {
          return brand
        }
      }
    }
  }

  // Try to extract first word if it looks like a brand
  const words = title.split(/\s+/)
  if (words.length > 0) {
    const firstWord = words[0]
    // Check if first word is likely a brand name (capitalized or all caps)
    if (
      firstWord.length > 1 &&
      (firstWord === firstWord.toUpperCase() || firstWord[0] === firstWord[0].toUpperCase())
    ) {
      if (!invalidBrands.has(firstWord.toLowerCase())) {
        return firstWord
      }
    }
  }

  return 'Generic'
}

/**
 * Filter out unwanted images (UI elements, play buttons, etc.)
 */
export function filterImages(images: string[]): string[] {
  return images.filter((imgUrl) => {
    // Skip AC_SL pattern images (high-res variants)
    if (imgUrl.includes('_AC_SL') || imgUrl.includes('AC_SL')) return false

    // Skip UI elements from /images/G/ directory
    if (imgUrl.includes('/images/G/') || imgUrl.includes('/G/01/')) return false

    // Skip play button overlays
    if (
      imgUrl.includes('PKplay-button') ||
      imgUrl.includes('play-icon') ||
      imgUrl.includes('play_button')
    )
      return false

    // Skip 360-degree view icons
    if (imgUrl.includes('360_icon') || imgUrl.includes('360-icon') || imgUrl.includes('imageBlock'))
      return false

    // Skip transparent pixel placeholders
    if (imgUrl.includes('transparent-pixel') || imgUrl.includes('transparent_pixel')) return false

    return true
  })
}

/**
 * Parse weight from specification string
 * Examples: "1.96 pounds", "12.3 ounces"
 */
export function parseWeight(
  weightStr: string | undefined
): { value: string; unit: 'POUND' } | null {
  if (!weightStr) return null

  const match = weightStr.toLowerCase().match(/([\d.]+)\s*(pound|lb|ounce|oz)/)
  if (!match) return null

  let value = parseFloat(match[1])
  const unit = match[2]

  // Convert ounces to pounds
  if (unit.includes('oz') || unit.includes('ounce')) {
    value = value / 16
  }

  return {
    value: value.toFixed(2),
    unit: 'POUND',
  }
}

/**
 * Build HTML description for eBay listing
 */
export function buildHtmlDescription(product: {
  title: string
  description: string
  bulletPoints: string[]
  images: string[]
  specifications: Record<string, string>
}): string {
  const htmlParts: string[] = [
    '<div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto;">',
    `<h2 style="color: #333;">${escapeHtml(product.title)}</h2>`,
  ]

  // Add main image
  if (product.images.length > 0) {
    htmlParts.push(
      `<div style="text-align: center; margin: 20px 0;">` +
        `<img src="${product.images[0]}" alt="Product Image" style="max-width: 100%; height: auto;" />` +
        `</div>`
    )
  }

  // Add bullet points
  if (product.bulletPoints.length > 0) {
    htmlParts.push('<h3 style="color: #555;">Key Features:</h3>')
    htmlParts.push('<ul style="line-height: 1.8;">')
    for (const bullet of product.bulletPoints.slice(0, 10)) {
      if (bullet.trim()) {
        htmlParts.push(`<li>${escapeHtml(bullet.trim())}</li>`)
      }
    }
    htmlParts.push('</ul>')
  }

  // Add description
  if (product.description && product.description.trim()) {
    htmlParts.push('<h3 style="color: #555;">Product Description:</h3>')
    htmlParts.push(`<p style="line-height: 1.6;">${escapeHtml(product.description.trim())}</p>`)
  }

  // Add specifications
  const specs = Object.entries(product.specifications).filter(([_, v]) => v && v.trim())
  if (specs.length > 0) {
    htmlParts.push('<h3 style="color: #555;">Specifications:</h3>')
    htmlParts.push(
      '<table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">'
    )
    for (const [key, value] of specs) {
      htmlParts.push(
        `<tr style="border-bottom: 1px solid #ddd;">` +
          `<td style="padding: 10px; font-weight: bold; width: 40%;">${escapeHtml(key)}:</td>` +
          `<td style="padding: 10px;">${escapeHtml(value)}</td>` +
          `</tr>`
      )
    }
    htmlParts.push('</table>')
  }

  // Add shipping note
  htmlParts.push(
    '<div style="background: #f0f0f0; padding: 15px; margin-top: 20px; border-radius: 5px;">' +
      '<p style="margin: 0; font-size: 14px;"><strong>Shipping:</strong> ' +
      'Fast and reliable shipping. Item will be carefully packaged and shipped promptly.</p>' +
      '</div>'
  )

  htmlParts.push('</div>')

  return htmlParts.join('')
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/**
 * Process a product for eBay listing
 * Returns all the data needed for the listing flow
 */
export function processProduct(
  product: AmazonProduct,
  settings: GlobalSettings
): {
  sku: string
  title: string
  description: string
  bulletPoints: string[]
  images: string[]
  specifications: Record<string, string>
  brand: string
  amazonPrice: number
  deliveryFee: number
  ebayPrice: number
  multiplierUsed: number
  weight: { value: string; unit: 'POUND' } | null
  violations: string[]
} {
  // Sanitize product data first
  const sanitized = sanitizeProductData({
    title: product.title,
    description: product.description,
    bulletPoints: product.bulletPoints,
    specifications: product.specifications,
  })

  // Filter images
  const images = filterImages(product.images || [])

  // Parse prices
  const amazonPrice = parsePrice(product.price)
  const deliveryFee = parsePrice(product.deliveryFee)

  // Calculate eBay price
  const totalCost = amazonPrice + deliveryFee
  const multiplierUsed =
    product.price_multiplier ?? getTieredMultiplier(totalCost, settings, product.source)
  const ebayPrice = calculateEbayPrice(amazonPrice, settings, {
    deliveryFee,
    multiplier: product.price_multiplier,
    source: product.source,
  })

  // Extract brand
  const brand = extractBrand(sanitized.title, sanitized.specifications)

  // Parse weight
  const weight = parseWeight(sanitized.specifications['Item Weight'])

  // Build description from bullet points if empty
  let description = sanitized.description
  if (!description || description.trim() === '') {
    if (sanitized.bulletPoints.length > 0) {
      description = sanitized.bulletPoints.join('\n\n')
    } else {
      description = sanitized.title
    }
  }

  return {
    sku: generateSku(product.asin),
    title: truncateTitle(sanitized.title),
    description,
    bulletPoints: sanitized.bulletPoints,
    images: images.slice(0, 12), // eBay limit
    specifications: sanitized.specifications,
    brand,
    amazonPrice,
    deliveryFee,
    ebayPrice,
    multiplierUsed,
    weight: weight || { value: '1.0', unit: 'POUND' }, // Default weight
    violations: sanitized.violations,
  }
}