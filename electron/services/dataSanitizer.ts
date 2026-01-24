/**
 * Data Sanitizer Module
 * Removes eBay policy violations from product data
 * Ported from Python: data_sanitizer.py
 */

export interface SanitizationResult {
  cleanedText: string
  violations: string[]
  isClean: boolean
}

// Patterns that violate eBay policies
const VIOLATION_PATTERNS = {
  // External URLs (critical violation)
  urls: [
    /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi,
    /www\.[^\s<>"{}|\\^`\[\]]+/gi,
    /[a-zA-Z0-9.-]+\.(com|net|org|io|co|shop|store|amazon|ebay)[^\s]*/gi,
  ],

  // Contact information
  phoneNumbers: [
    /\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, // US phone numbers
    /\d{3}[-.\s]\d{4}/g, // Shorter phone formats
  ],

  emails: [/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi],

  // Social media
  socialMedia: [
    /(?:follow|like|subscribe|check out)(?:\s+(?:us|me|our))?\s+(?:on|at)\s+(?:facebook|instagram|twitter|tiktok|youtube|pinterest)/gi,
    /@[a-zA-Z0-9_]+/g, // Social handles
    /(?:facebook|instagram|twitter|tiktok|youtube|pinterest)(?:\.com)?(?:\/[^\s]*)?/gi,
  ],

  // External transaction phrases
  externalTransaction: [
    /(?:contact|message|call|text|email|reach out to)(?:\s+(?:us|me|seller))?\s+(?:for|to|about|regarding)/gi,
    /(?:pay|payment|checkout|buy|purchase)(?:\s+(?:via|through|using|on))\s+(?:paypal|venmo|zelle|cashapp|crypto)/gi,
    /(?:visit|check|see)(?:\s+(?:our|my))?\s+(?:website|site|store|shop)/gi,
  ],

  // JavaScript and code fragments
  codeFragments: [
    /<script[^>]*>[\s\S]*?<\/script>/gi,
    /javascript:/gi,
    /onclick\s*=/gi,
    /onerror\s*=/gi,
  ],

  // Competitor references
  competitors: [
    /(?:also|available|find|get|buy)\s+(?:on|at|from)\s+(?:amazon|walmart|target|aliexpress)/gi,
  ],
}

/**
 * Remove all policy violations from text
 */
export function sanitizeText(text: string): SanitizationResult {
  if (!text || typeof text !== 'string') {
    return { cleanedText: '', violations: [], isClean: true }
  }

  let cleanedText = text
  const violations: string[] = []

  // Process each category of violations
  for (const [category, patterns] of Object.entries(VIOLATION_PATTERNS)) {
    for (const pattern of patterns) {
      const matches = cleanedText.match(pattern)
      if (matches) {
        for (const match of matches) {
          violations.push(`[${category}] ${match}`)
        }
        cleanedText = cleanedText.replace(pattern, '')
      }
    }
  }

  // Clean up extra whitespace
  cleanedText = cleanedText
    .replace(/\s+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .trim()

  return {
    cleanedText,
    violations,
    isClean: violations.length === 0,
  }
}

/**
 * Sanitize product title
 */
export function sanitizeTitle(title: string): string {
  const { cleanedText } = sanitizeText(title)

  // Additional title-specific cleaning
  return cleanedText
    .replace(/[<>]/g, '') // Remove HTML-like brackets
    .replace(/\s+/g, ' ') // Normalize spaces
    .trim()
    .substring(0, 80) // eBay title limit
}

/**
 * Sanitize product description
 */
export function sanitizeDescription(description: string): string {
  const { cleanedText } = sanitizeText(description)
  return cleanedText
}

/**
 * Sanitize bullet points array
 */
export function sanitizeBulletPoints(bulletPoints: string[]): string[] {
  if (!Array.isArray(bulletPoints)) return []

  return bulletPoints
    .map((point) => sanitizeText(point).cleanedText)
    .filter((point) => point.length > 0)
}

/**
 * Sanitize entire product data object
 */
export function sanitizeProductData(product: {
  title?: string
  description?: string
  bulletPoints?: string[]
  specifications?: Record<string, string>
}): {
  title: string
  description: string
  bulletPoints: string[]
  specifications: Record<string, string>
  violations: string[]
} {
  const allViolations: string[] = []

  // Sanitize title
  const titleResult = sanitizeText(product.title || '')
  allViolations.push(...titleResult.violations)

  // Sanitize description
  const descResult = sanitizeText(product.description || '')
  allViolations.push(...descResult.violations)

  // Sanitize bullet points
  const cleanedBullets: string[] = []
  for (const bullet of product.bulletPoints || []) {
    const bulletResult = sanitizeText(bullet)
    if (bulletResult.cleanedText) {
      cleanedBullets.push(bulletResult.cleanedText)
    }
    allViolations.push(...bulletResult.violations)
  }

  // Sanitize specifications
  const cleanedSpecs: Record<string, string> = {}
  for (const [key, value] of Object.entries(product.specifications || {})) {
    const specResult = sanitizeText(value)
    if (specResult.cleanedText) {
      cleanedSpecs[key] = specResult.cleanedText
    }
    allViolations.push(...specResult.violations)
  }

  return {
    title: titleResult.cleanedText.substring(0, 80),
    description: descResult.cleanedText,
    bulletPoints: cleanedBullets,
    specifications: cleanedSpecs,
    violations: allViolations,
  }
}

/**
 * Validate that text is clean (no violations)
 */
export function validateClean(text: string): boolean {
  const { isClean } = sanitizeText(text)
  return isClean
}