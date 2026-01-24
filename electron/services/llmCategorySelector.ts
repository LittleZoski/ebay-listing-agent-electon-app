/**
 * LLM-powered Category Selection and Requirements Handler
 * Uses Claude Haiku for fast, cost-effective category decisions
 * Ported from Python: llm_category_selector.py and semantic_category_selector.py
 */

import Anthropic from '@anthropic-ai/sdk'
import { CategoryCache, Category, EbayCredentials } from './categoryCache'

export interface CategoryRequirements {
  required: AspectInfo[]
  recommended: AspectInfo[]
  optional: AspectInfo[]
}

export interface AspectInfo {
  name: string
  required: boolean
  cardinality: 'SINGLE' | 'MULTI'
  mode: 'FREE_TEXT' | 'SELECTION_ONLY'
  dataType: string
  values: string[]
}

export interface OptimizationResult {
  optimizedTitle: string
  brand: string
  categoryId: string
  categoryName: string
  confidence: number
  reasoning: string
}

export interface FilledAspects {
  [aspectName: string]: string | string[]
}

/**
 * LLM Category Selector using Claude Haiku
 */
export class LLMCategorySelector {
  private client: Anthropic
  private cache: CategoryCache
  private credentials: EbayCredentials

  constructor(anthropicApiKey: string, cache: CategoryCache, credentials: EbayCredentials) {
    if (!anthropicApiKey || anthropicApiKey === 'your_claude_api_key_here') {
      throw new Error('ANTHROPIC_API_KEY not configured')
    }

    this.client = new Anthropic({ apiKey: anthropicApiKey })
    this.cache = cache
    this.credentials = credentials
  }

  /**
   * Get optimized list of leaf categories with smart sampling
   */
  private getLeafCategories(): Array<{ id: string; name: string; path: string; level: number }> {
    const allCategories = this.cache.getLeafCategories(2, 4)

    // Group by level
    const byLevel: Record<number, Category[]> = {}
    for (const cat of allCategories) {
      if (!byLevel[cat.level]) byLevel[cat.level] = []
      byLevel[cat.level].push(cat)
    }

    // Stratified sampling for good coverage
    const stratifiedSample = (categories: Category[], targetCount: number): Category[] => {
      if (categories.length <= targetCount) return categories

      const sorted = [...categories].sort((a, b) => a.name.localeCompare(b.name))
      const step = sorted.length / targetCount
      return Array.from({ length: targetCount }, (_, i) => sorted[Math.floor(i * step)])
    }

    const level2Sample = stratifiedSample(byLevel[2] || [], 50)
    const level3Sample = stratifiedSample(byLevel[3] || [], 70)
    const level4Sample = stratifiedSample(byLevel[4] || [], 30)

    const result = [...level2Sample, ...level3Sample, ...level4Sample]

    return result.map((cat) => ({
      id: cat.id,
      name: cat.name,
      path: this.cache.getCategoryPath(cat.id),
      level: cat.level,
    }))
  }

  /**
   * COST-EFFICIENT: Use single LLM call for THREE tasks:
   * 1. Optimize title (80 chars max)
   * 2. Select category
   * 3. Extract brand name
   */
  async optimizeTitleAndSelectCategory(
    productTitle: string,
    productDescription: string = '',
    bulletPoints: string[] = [],
    specifications: Record<string, string> = {}
  ): Promise<OptimizationResult> {
    console.log(`LLM optimizing title and selecting category for: ${productTitle.substring(0, 60)}...`)

    const leafCategories = this.getLeafCategories()
    const prompt = this.buildCombinedPrompt(
      productTitle,
      productDescription,
      bulletPoints,
      specifications,
      leafCategories
    )

    try {
      const response = await this.client.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 700,
        temperature: 0.3,
        messages: [{ role: 'user', content: prompt }],
      })

      const resultText = (response.content[0] as { type: string; text: string }).text.trim()
      console.log('LLM response:', resultText)

      const result = JSON.parse(resultText)

      // Get optimized title and enforce 80 char limit
      let optimizedTitle = result.optimized_title || productTitle
      if (optimizedTitle.length > 80) {
        optimizedTitle = this.smartTruncateTitle(optimizedTitle, 80)
        console.log(`Title exceeded 80 chars, truncated to: ${optimizedTitle}`)
      }

      const brand = this.validateBrand(result.brand || 'Generic')
      const categoryId = result.category_id

      // Validate category exists
      const categoryInfo = this.cache.getCategory(categoryId)
      if (!categoryInfo) {
        console.warn(`LLM selected invalid category ${categoryId}, using fallback`)
        const fallback = this.fallbackCategorySelection(productTitle)
        return {
          optimizedTitle,
          brand,
          categoryId: fallback.categoryId,
          categoryName: fallback.categoryName,
          confidence: fallback.confidence,
          reasoning: 'Fallback selection',
        }
      }

      const confidence = result.confidence || 0.7

      console.log(`  Optimized Title: ${optimizedTitle}`)
      console.log(`  Extracted Brand: ${brand}`)
      console.log(`  Selected Category: ${categoryInfo.name} (ID: ${categoryId})`)
      console.log(`  Confidence: ${confidence}`)

      return {
        optimizedTitle,
        brand,
        categoryId,
        categoryName: categoryInfo.name,
        confidence,
        reasoning: result.reasoning || '',
      }
    } catch (error) {
      console.error(`LLM optimization failed: ${error}`)
      // Fallback
      const truncatedTitle = productTitle.length > 80 ? productTitle.substring(0, 77) + '...' : productTitle
      const fallback = this.fallbackCategorySelection(productTitle)
      return {
        optimizedTitle: truncatedTitle,
        brand: 'Generic',
        categoryId: fallback.categoryId,
        categoryName: fallback.categoryName,
        confidence: fallback.confidence,
        reasoning: 'Fallback due to error',
      }
    }
  }

  /**
   * Build cost-efficient prompt for THREE tasks
   */
  private buildCombinedPrompt(
    title: string,
    description: string,
    bulletPoints: string[],
    specifications: Record<string, string>,
    categories: Array<{ id: string; name: string; path: string; level: number }>
  ): string {
    const bulletText = bulletPoints.slice(0, 3).join('\n') || 'N/A'
    const descText = description.substring(0, 200) || 'N/A'
    const specsText = Object.keys(specifications).length > 0 ? JSON.stringify(specifications, null, 2) : 'N/A'
    const categoriesJson = JSON.stringify(categories.slice(0, 100), null, 2)

    return `You are an eBay listing optimization expert. Perform THREE tasks in ONE response:

TASK 1: EXTRACT BRAND NAME
- Identify the actual brand/manufacturer from the product data
- Check specifications for: "Brand", "Brand Name", "BrandName", "Manufacturer" fields
- Use context to find the real brand (e.g., in "Waterproof Sony Headphones", brand is "Sony" not "Waterproof")
- Avoid generic terms like: Custom, Personalized, Handmade, Vintage, New, Unique, etc.
- If no clear brand exists, use "Generic"

TASK 2: OPTIMIZE TITLE (Max 80 characters)
- Make it compelling and keyword-rich for eBay search
- Include brand, key features, and product type
- Front-load important keywords
- Use natural language, avoid keyword stuffing
- MUST be ≤80 characters

TASK 3: SELECT CATEGORY
- Choose the MOST SPECIFIC matching eBay category
- Prefer Level 2-3 categories (fewer requirements)
- CRITICAL: AVOID Book/Media categories (Books, Music, Movies, etc.) UNLESS the product is clearly a physical book, DVD, or music album
- For beauty, skincare, health products → use Health & Beauty categories
- For cosmetics, patches, skincare tools → NOT books!

ORIGINAL PRODUCT DATA:
Title: ${title}
Description: ${descText}
Key Features:
${bulletText}
Specifications:
${specsText}

AVAILABLE EBAY CATEGORIES (top 100 leaf categories):
${categoriesJson}

OPTIMIZATION GUIDELINES:
1. Brand should be the actual manufacturer/company name
2. Title should capture buyer intent and eBay search algorithm
3. Include: Brand + Type + Key Feature + Size/Spec (if relevant)
4. Remove filler words like "perfect for", "great", etc.
5. Category should match the product's primary purpose

OUTPUT FORMAT (JSON only, no explanations):
{
  "brand": "extracted brand name or 'Generic'",
  "optimized_title": "your optimized title here (max 80 chars)",
  "category_id": "the category ID",
  "reasoning": "brief 1-sentence explanation for all three decisions",
  "confidence": 0.0-1.0
}`
  }

  /**
   * Smart truncate title to max_length, breaking at word boundaries
   */
  private smartTruncateTitle(title: string, maxLength: number = 80): string {
    if (title.length <= maxLength) return title

    const truncated = title.substring(0, maxLength)
    const lastSpace = truncated.lastIndexOf(' ')

    if (lastSpace > 0) {
      return title.substring(0, lastSpace).trim()
    }

    return title.substring(0, maxLength).trim()
  }

  /**
   * Validate and clean brand name
   */
  private validateBrand(brand: string): string {
    if (!brand || !brand.trim()) return 'Generic'

    brand = brand.trim()

    const invalidBrands = new Set([
      'custom', 'personalized', 'handmade', 'vintage', 'unique',
      'new', 'brand', 'the', 'a', 'an', 'with', 'for', 'and',
      'n/a', 'none', 'unknown', 'generic',
    ])

    if (invalidBrands.has(brand.toLowerCase())) return 'Generic'
    if (brand.length <= 2) return 'Generic'

    return brand
  }

  /**
   * Fallback category selection using keyword matching
   */
  private fallbackCategorySelection(title: string): {
    categoryId: string
    categoryName: string
    confidence: number
  } {
    console.warn('Using fallback category selection')

    const keywords = title.toLowerCase().split(/\s+/).slice(0, 5)

    for (const keyword of keywords) {
      const results = this.cache.searchCategories(keyword, true)
      for (const cat of results) {
        if (cat.level >= 2 && cat.level <= 3) {
          return { categoryId: cat.id, categoryName: cat.name, confidence: 0.5 }
        }
      }
    }

    // Ultimate fallback - Art Prints (360) - minimal requirements
    return { categoryId: '360', categoryName: 'Art Prints', confidence: 0.3 }
  }

  /**
   * Fetch category-specific requirements (item aspects) from eBay API
   */
  async getCategoryRequirements(categoryId: string): Promise<CategoryRequirements> {
    console.log(`Fetching requirements for category ${categoryId}...`)

    try {
      // Get application token
      const tokenUrl =
        this.credentials.environment === 'PRODUCTION'
          ? 'https://api.ebay.com/identity/v1/oauth2/token'
          : 'https://api.sandbox.ebay.com/identity/v1/oauth2/token'

      const b64Credentials = Buffer.from(
        `${this.credentials.appId}:${this.credentials.certId}`
      ).toString('base64')

      const tokenResponse = await fetch(tokenUrl, {
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

      if (!tokenResponse.ok) {
        throw new Error(`Failed to get token: ${await tokenResponse.text()}`)
      }

      const tokenData = await tokenResponse.json()
      const token = tokenData.access_token

      // Fetch category aspects
      const baseUrl =
        this.credentials.environment === 'PRODUCTION'
          ? 'https://api.ebay.com'
          : 'https://api.sandbox.ebay.com'

      const url = `${baseUrl}/commerce/taxonomy/v1/category_tree/0/get_item_aspects_for_category?category_id=${categoryId}`

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(30000),
      })

      if (response.status === 200) {
        const data = await response.json()
        const aspects = data.aspects || []

        const required: AspectInfo[] = []
        const recommended: AspectInfo[] = []
        const optional: AspectInfo[] = []

        for (const aspect of aspects) {
          const aspectName = aspect.localizedAspectName
          const constraint = aspect.aspectConstraint || {}

          const aspectInfo: AspectInfo = {
            name: aspectName,
            required: constraint.aspectRequired || false,
            cardinality: constraint.itemToAspectCardinality || 'SINGLE',
            mode: constraint.aspectMode || 'SELECTION_ONLY',
            dataType: constraint.aspectDataType || 'STRING',
            values: (aspect.aspectValues || []).slice(0, 50).map((v: { localizedValue: string }) => v.localizedValue),
          }

          if (aspectInfo.required) {
            required.push(aspectInfo)
          } else if (constraint.aspectUsage === 'RECOMMENDED') {
            recommended.push(aspectInfo)
          } else {
            optional.push(aspectInfo)
          }
        }

        console.log(`  Found ${required.length} required, ${recommended.length} recommended aspects`)

        return { required, recommended, optional }
      } else if (response.status === 204) {
        console.log('  No specific requirements for this category')
        return { required: [], recommended: [], optional: [] }
      } else {
        console.error(`  Failed to fetch requirements: ${response.status}`)
        return { required: [], recommended: [], optional: [] }
      }
    } catch (error) {
      console.error(`Exception fetching requirements: ${error}`)
      return { required: [], recommended: [], optional: [] }
    }
  }

  /**
   * Use LLM to fill required (and optionally recommended) category-specific fields
   */
  async fillCategoryRequirements(
    productData: {
      title: string
      description: string
      bulletPoints: string[]
      specifications: Record<string, string>
    },
    requirements: CategoryRequirements,
    includeRecommended: boolean = false
  ): Promise<FilledAspects> {
    const required = requirements.required
    const recommended = includeRecommended ? requirements.recommended : []

    if (required.length === 0 && recommended.length === 0) {
      console.log('No aspects to fill')
      return {}
    }

    const totalAspects = required.length + recommended.length
    console.log(`LLM filling ${required.length} required + ${recommended.length} recommended aspects (total: ${totalAspects})...`)

    const prompt = this.buildRequirementsFillingPrompt(productData, required, recommended)

    try {
      const response = await this.client.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 3000,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }],
      })

      let resultText = (response.content[0] as { type: string; text: string }).text.trim()

      // Handle markdown code blocks
      if (resultText.includes('```json')) {
        const start = resultText.indexOf('```json') + 7
        const end = resultText.indexOf('```', start)
        resultText = resultText.substring(start, end).trim()
      } else if (resultText.includes('```')) {
        const start = resultText.indexOf('```') + 3
        const end = resultText.indexOf('```', start)
        resultText = resultText.substring(start, end).trim()
      }

      // Find JSON object
      if (!resultText.startsWith('{')) {
        const start = resultText.indexOf('{')
        if (start >= 0) {
          resultText = resultText.substring(start)
        }
      }

      // Parse and validate
      const filledAspects = JSON.parse(resultText) as FilledAspects

      // Validate and truncate aspect values to 65-char limit
      const validated = this.validateAndTruncateAspects(filledAspects)

      console.log(`  Filled ${Object.keys(validated).length} aspects total`)

      return validated
    } catch (error) {
      console.error(`LLM requirements filling failed: ${error}`)
      return {}
    }
  }

  /**
   * Build prompt for filling requirements
   */
  private buildRequirementsFillingPrompt(
    productData: {
      title: string
      description: string
      bulletPoints: string[]
      specifications: Record<string, string>
    },
    requiredAspects: AspectInfo[],
    recommendedAspects: AspectInfo[]
  ): string {
    const requiredInfo = requiredAspects.map((aspect) => {
      const info: Record<string, unknown> = {
        name: aspect.name,
        mode: aspect.mode,
        cardinality: aspect.cardinality,
        priority: 'REQUIRED',
      }
      if (aspect.values.length > 0 && aspect.mode !== 'FREE_TEXT') {
        info.allowed_values = aspect.values.slice(0, 20)
      }
      return info
    })

    const recommendedInfo = recommendedAspects
      .filter((aspect) => aspect.mode === 'FREE_TEXT' || aspect.values.length <= 50)
      .map((aspect) => {
        const info: Record<string, unknown> = {
          name: aspect.name,
          mode: aspect.mode,
          cardinality: aspect.cardinality,
          priority: 'RECOMMENDED',
        }
        if (aspect.values.length > 0 && aspect.mode !== 'FREE_TEXT') {
          info.allowed_values = aspect.values.slice(0, 30)
        }
        return info
      })

    const allAspects = [...requiredInfo, ...recommendedInfo]
    const bulletPoints = productData.bulletPoints.slice(0, 5)
    const description = productData.description.substring(0, 500)

    return `You are filling out eBay listing fields based on product information.

PRODUCT DATA:
Title: ${productData.title}
Description: ${description}
Key Features: ${JSON.stringify(bulletPoints)}

ASPECTS TO FILL:
${JSON.stringify(allAspects, null, 2)}

INSTRUCTIONS:
1. For REQUIRED aspects: MUST provide values, use best reasonable default if not found
2. For RECOMMENDED aspects: Only fill if information is clearly available in product data
3. If mode is SELECTION_ONLY, MUST choose from allowed_values (case-sensitive match)
4. If mode is FREE_TEXT, extract relevant information from product data
5. If cardinality is MULTI, return array; if SINGLE, return string or single value
6. Skip RECOMMENDED aspects if product data doesn't clearly provide the information

CRITICAL - CHARACTER LIMIT:
- ALL aspect values MUST be ≤65 characters (eBay hard limit)
- Be concise: extract key information only, remove filler words
- Examples:
  * BAD (128 chars): "SAFE AND GENTLE: The spray is made with plant extracts and contains no alcohol or harsh chemicals. It's suitable for both puppies and adults."
  * GOOD (62 chars): "Made with plant extracts, no alcohol, safe for puppies/adults"

OUTPUT FORMAT (JSON only):
{
  "aspect_name": "value",
  "another_aspect": ["value1", "value2"],
  ...
}`
  }

  /**
   * Validate and truncate aspect values to eBay's 65-character limit
   */
  private validateAndTruncateAspects(aspects: FilledAspects): FilledAspects {
    const MAX_LENGTH = 65
    const validated: FilledAspects = {}

    for (const [aspectName, aspectValue] of Object.entries(aspects)) {
      if (Array.isArray(aspectValue)) {
        validated[aspectName] = aspectValue.map((val) => {
          if (typeof val === 'string' && val.length > MAX_LENGTH) {
            return this.smartTruncate(val, MAX_LENGTH)
          }
          return val
        })
      } else if (typeof aspectValue === 'string') {
        if (aspectValue.length > MAX_LENGTH) {
          validated[aspectName] = this.smartTruncate(aspectValue, MAX_LENGTH)
        } else {
          validated[aspectName] = aspectValue
        }
      } else {
        validated[aspectName] = aspectValue
      }
    }

    return validated
  }

  /**
   * Intelligently truncate text to max_length while preserving meaning
   */
  private smartTruncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text

    const truncateAt = maxLength - 3

    // Try to break at sentence/phrase boundaries
    for (const delimiter of ['. ', ': ', '; ', ', ']) {
      const pos = text.substring(0, truncateAt).lastIndexOf(delimiter)
      if (pos > maxLength / 2) {
        return text.substring(0, pos).trim()
      }
    }

    // Break at word boundary
    if (text.substring(0, truncateAt).includes(' ')) {
      const lastSpace = text.substring(0, truncateAt).lastIndexOf(' ')
      return text.substring(0, lastSpace).trim() + '...'
    }

    // Hard truncate
    return text.substring(0, truncateAt).trim() + '...'
  }
}