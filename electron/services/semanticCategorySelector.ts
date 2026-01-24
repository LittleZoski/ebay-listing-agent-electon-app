/**
 * Semantic Category Selector - Vector DB + LLM Hybrid
 * Uses local vector database for fast, free category matching.
 * LLM picks best from top candidates + optimizes title + extracts brand.
 *
 * Ported from Python: semantic_category_selector.py
 *
 * Cost Optimization:
 * - Vector DB semantic search: FREE, instant
 * - LLM only used for: title optimization, brand extraction, picking best from top 3
 */

import Anthropic from '@anthropic-ai/sdk'
import { VectorCategoryDB } from './vectorCategoryDB'
import { CategoryCache, EbayCredentials } from './categoryCache'

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

interface CategoryCandidate {
  categoryId: string
  name: string
  path: string
  level: number
  similarityScore: number
}

/**
 * Semantic Category Selector using Vector DB + LLM hybrid approach
 */
export class SemanticCategorySelector {
  private client: Anthropic
  private vectorDB: VectorCategoryDB
  private categoryCache: CategoryCache
  private credentials: EbayCredentials
  private topK: number = 3 // Number of top candidates from vector DB

  constructor(
    anthropicApiKey: string,
    vectorDB: VectorCategoryDB,
    categoryCache: CategoryCache,
    credentials: EbayCredentials
  ) {
    if (!anthropicApiKey || anthropicApiKey === 'your_claude_api_key_here') {
      throw new Error('ANTHROPIC_API_KEY not configured')
    }

    this.client = new Anthropic({ apiKey: anthropicApiKey })
    this.vectorDB = vectorDB
    this.categoryCache = categoryCache
    this.credentials = credentials
  }

  /**
   * IMPROVED Hybrid approach:
   * - Vector DB: Get top 3 most semantically similar categories (fast, free)
   * - LLM: Pick best category from top 3 + optimize title + extract brand (accurate, cheap)
   */
  async optimizeTitleAndSelectCategory(
    productTitle: string,
    productDescription: string = '',
    bulletPoints: string[] = [],
    specifications: Record<string, string> = {}
  ): Promise<OptimizationResult> {
    console.log(`[SemanticSelector] Optimizing: ${productTitle.substring(0, 60)}...`)

    // STEP 1: Get top K categories from Vector DB
    let topMatches: CategoryCandidate[] = []

    // Build enhanced query for better semantic matching
    let enhancedDescription = ''
    if (bulletPoints && bulletPoints.length > 0) {
      enhancedDescription += bulletPoints.slice(0, 5).join(' ')
    }
    if (productDescription) {
      enhancedDescription += ' ' + productDescription.substring(0, 300)
    }

    try {
      topMatches = await this.vectorDB.searchCategory(
        productTitle,
        enhancedDescription.trim(),
        this.topK
      )

      console.log(`[SemanticSelector] Top ${this.topK} Vector DB candidates:`)
      for (let i = 0; i < topMatches.length; i++) {
        const match = topMatches[i]
        console.log(`  ${i + 1}. ${match.similarityScore.toFixed(3)} - ${match.name} (ID: ${match.categoryId})`)
      }

      if (topMatches.length === 0) {
        throw new Error('No category matches found in vector DB')
      }
    } catch (error) {
      console.error('[SemanticSelector] Vector DB search failed:', error)
      // Fallback to simple category
      topMatches = [{
        categoryId: '360',
        name: 'Art Prints',
        path: 'Art > Art Prints',
        level: 2,
        similarityScore: 0.3,
      }]
    }

    // STEP 2: LLM picks best category from top K + optimizes title + extracts brand
    try {
      console.log(`[SemanticSelector] LLM analyzing product and picking best from top ${this.topK}...`)

      const result = await this.llmOptimizeTitleBrandAndPickCategory(
        productTitle,
        productDescription,
        bulletPoints,
        specifications,
        topMatches
      )

      // Find the selected category details
      let categoryName = ''
      let confidence = 0.0

      for (const match of topMatches) {
        if (match.categoryId === result.categoryId) {
          categoryName = match.name
          confidence = match.similarityScore
          break
        }
      }

      if (!categoryName) {
        // LLM picked something not in top 3? Use first match
        console.warn(`[SemanticSelector] LLM selected ${result.categoryId} not in top ${this.topK}, using first match`)
        categoryName = topMatches[0].name
        result.categoryId = topMatches[0].categoryId
        confidence = topMatches[0].similarityScore
      }

      console.log('[SemanticSelector] FINAL SELECTION:')
      console.log(`  Optimized Title: ${result.optimizedTitle}`)
      console.log(`  Brand: ${result.brand}`)
      console.log(`  Category: ${categoryName} (ID: ${result.categoryId})`)
      console.log(`  Similarity Score: ${confidence.toFixed(3)}`)

      return {
        optimizedTitle: result.optimizedTitle,
        brand: result.brand,
        categoryId: result.categoryId,
        categoryName,
        confidence,
        reasoning: result.reasoning,
      }
    } catch (error) {
      console.error('[SemanticSelector] LLM optimization failed:', error)

      // Fallback
      const truncatedTitle = productTitle.length > 80
        ? productTitle.substring(0, 77) + '...'
        : productTitle
      const brand = this.extractBrandSimple(productTitle, specifications)

      return {
        optimizedTitle: truncatedTitle,
        brand,
        categoryId: topMatches[0].categoryId,
        categoryName: topMatches[0].name,
        confidence: topMatches[0].similarityScore,
        reasoning: 'Fallback due to LLM error',
      }
    }
  }

  /**
   * Use LLM for title, brand, AND picking best category from top K vector DB results.
   * This combines vector DB speed with LLM reasoning for maximum accuracy.
   */
  private async llmOptimizeTitleBrandAndPickCategory(
    title: string,
    description: string,
    bulletPoints: string[],
    specifications: Record<string, string>,
    topCategories: CategoryCandidate[]
  ): Promise<{ optimizedTitle: string; brand: string; categoryId: string; reasoning: string }> {
    const bulletText = bulletPoints.slice(0, 3).join('\n') || 'N/A'
    const descText = description.substring(0, 200) || 'N/A'
    const specsText = Object.keys(specifications).length > 0
      ? JSON.stringify(specifications, null, 2)
      : 'N/A'

    // Format top categories for LLM
    const categoriesInfo = topCategories.map((cat, i) => ({
      id: cat.categoryId,
      name: cat.name,
      path: cat.path,
      similarity_score: cat.similarityScore,
    }))
    const categoriesJson = JSON.stringify(categoriesInfo, null, 2)
    const topK = topCategories.length

    const prompt = `You are an eBay listing optimization expert. Perform THREE tasks:

TASK 1: EXTRACT BRAND NAME
- Identify the actual brand/manufacturer from the product data
- Check specifications for: "Brand", "Brand Name", "BrandName", "Manufacturer" fields
- Use context to find the real brand (e.g., in "Waterproof Sony Headphones", brand is "Sony")
- Avoid generic terms like: Custom, Personalized, Handmade, Vintage, New, Unique, etc.
- If no clear brand exists, use "Generic"

TASK 2: OPTIMIZE TITLE (Max 80 characters)
- Make it compelling and keyword-rich for eBay search
- Include brand, key features, and product type
- Front-load important keywords
- Use natural language, avoid keyword stuffing
- MUST be ≤80 characters

TASK 3: SELECT BEST CATEGORY FROM TOP ${topK} CANDIDATES
- You are given the top ${topK} semantically similar categories from vector search
- Review the FULL product context (title, description, features, specs)
- Pick the MOST APPROPRIATE category based on:
  * Product's primary purpose and intended use
  * Target audience (baby/adult/pet/automotive/etc)
  * Specific product type (tool vs toy vs food vs accessory)
  * Category PATH HIERARCHY (check the full path, not just the final category name!)

- CRITICAL: Always examine the ROOT CATEGORY (first level after "Root >") in the path:
  * Common root categories: "Pet Supplies", "Health & Beauty", "Baby", "Home & Garden", "Automotive", "Electronics", etc.
  * The ROOT CATEGORY must match the product's target audience/domain
  * Example: If final category is "Vitamins & Supplements", check the ROOT:
    - "Root > Pet Supplies > ... > Vitamins & Supplements" = for PETS
    - "Root > Health & Beauty > ... > Vitamins & Supplements" = for HUMANS
  * Example: If product is "Astaxanthin supplement for skin/eye health":
    - WRONG: "Root > Pet Supplies > Dog Supplies > ... > Vitamins & Supplements" (pet root)
    - CORRECT: "Root > Health & Beauty > Vitamins & Lifestyle Supplements > ..." (human root)

- IMPORTANT: High similarity score ≠ correct category!
  * Vector search matches on word overlap, which can be misleading
  * Example: "Baby Nail Clipper" might match "Pet Grooming Clippers" (0.51) due to word overlap,
    but "Manicure & Pedicure Tools" (0.50) is CORRECT based on product context
  * Always prioritize ROOT CATEGORY match over similarity score

- Decision Process:
  1. Identify the product's target domain (human, pet, baby, automotive, etc.)
  2. For each candidate, check if the ROOT CATEGORY matches the target domain
  3. Eliminate candidates with mismatched root categories
  4. From remaining valid candidates, pick the most specific and appropriate one

PRODUCT DATA:
Title: ${title}
Description: ${descText}
Key Features:
${bulletText}
Specifications:
${specsText}

TOP ${topK} CANDIDATE CATEGORIES (from vector search):
${categoriesJson}

ANALYSIS INSTRUCTIONS:
1. Read the product title, description, and features carefully
2. Identify the product's TARGET DOMAIN:
   - Is it for humans? (Health & Beauty, Home & Garden, Clothing, etc.)
   - Is it for pets? (Pet Supplies)
   - Is it for babies? (Baby)
   - Is it for vehicles? (Automotive, Motorcycle)
   - Is it electronics? (Electronics, Computers)
3. For EACH of the ${topK} candidates, examine the ROOT CATEGORY (first level in path):
   - Extract: "Root > [ROOT_CATEGORY] > ..."
   - Does this ROOT match the product's target domain?
   - Example: Human supplement needs "Health & Beauty" root, NOT "Pet Supplies" root
4. ELIMINATE all candidates where ROOT CATEGORY doesn't match target domain
5. From the REMAINING valid candidates, pick the most specific and appropriate sub-category
6. NEVER pick based on highest similarity score alone - ROOT CATEGORY match is mandatory

OUTPUT FORMAT (JSON only, no explanations outside JSON):
{
  "brand": "extracted brand name or 'Generic'",
  "optimized_title": "your optimized title here (max 80 chars)",
  "category_id": "selected category ID from the ${topK} candidates",
  "reasoning": "1-2 sentence explanation mentioning why the ROOT CATEGORY matches and why this specific path is best"
}`

    const response = await this.client.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 500,
      temperature: 0.2,
      messages: [{ role: 'user', content: prompt }],
    })

    let resultText = (response.content[0] as { type: string; text: string }).text.trim()

    // Parse JSON response
    let result: { brand?: string; optimized_title?: string; category_id?: string; reasoning?: string }
    try {
      result = JSON.parse(resultText)
    } catch {
      // Try to extract JSON if wrapped in markdown
      if (resultText.includes('```json')) {
        const start = resultText.indexOf('```json') + 7
        const end = resultText.indexOf('```', start)
        resultText = resultText.substring(start, end).trim()
        result = JSON.parse(resultText)
      } else if (resultText.includes('```')) {
        const start = resultText.indexOf('```') + 3
        const end = resultText.indexOf('```', start)
        resultText = resultText.substring(start, end).trim()
        result = JSON.parse(resultText)
      } else {
        throw new Error('Failed to parse LLM response')
      }
    }

    console.log(`[SemanticSelector] LLM Reasoning: ${result.reasoning || 'N/A'}`)

    // Get optimized title and enforce 80 char limit with smart truncation
    let optimizedTitle = result.optimized_title || title
    if (optimizedTitle.length > 80) {
      optimizedTitle = this.smartTruncateTitle(optimizedTitle, 80)
      console.warn(`[SemanticSelector] Title exceeded 80 chars, truncated to: ${optimizedTitle}`)
    }

    return {
      optimizedTitle,
      brand: result.brand || 'Generic',
      categoryId: result.category_id || topCategories[0].categoryId,
      reasoning: result.reasoning || '',
    }
  }

  /**
   * Smart truncate title to max_length, breaking at word boundaries
   */
  private smartTruncateTitle(title: string, maxLength: number = 80): string {
    if (title.length <= maxLength) return title

    const truncated = title.substring(0, maxLength)
    const lastSpace = truncated.lastIndexOf(' ')

    if (lastSpace > 0) {
      let result = title.substring(0, lastSpace).trim()
      // Remove trailing punctuation
      result = result.replace(/[-–—,:;|/\\]+$/, '').trim()
      return result
    }

    return title.substring(0, maxLength).trim()
  }

  /**
   * Simple brand extraction without LLM
   */
  private extractBrandSimple(title: string, specifications: Record<string, string> = {}): string {
    // Try to extract from specifications first
    const brandFields = ['Brand', 'brand', 'Brand Name', 'BrandName', 'Manufacturer', 'manufacturer']
    for (const key of brandFields) {
      if (specifications[key] && specifications[key].length > 2) {
        return specifications[key]
      }
    }

    // Fallback: use first word of title if it looks like a brand
    const words = title.split(/\s+/)
    if (words.length > 0) {
      const firstWord = words[0]
      if (firstWord.length > 2 && /^[A-Z]/.test(firstWord)) {
        return firstWord
      }
    }

    return 'Generic'
  }

  /**
   * Get category requirements (item aspects) from eBay API
   */
  async getCategoryRequirements(categoryId: string): Promise<CategoryRequirements> {
    console.log(`[SemanticSelector] Fetching requirements for category ${categoryId}...`)

    try {
      // Get application token
      const tokenUrl = this.credentials.environment === 'PRODUCTION'
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
      const baseUrl = this.credentials.environment === 'PRODUCTION'
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

        console.log(`[SemanticSelector] Found ${required.length} required, ${recommended.length} recommended aspects`)

        return { required, recommended, optional }
      } else if (response.status === 204) {
        console.log('[SemanticSelector] No specific requirements for this category')
        return { required: [], recommended: [], optional: [] }
      } else {
        console.error(`[SemanticSelector] Failed to fetch requirements: ${response.status}`)
        return { required: [], recommended: [], optional: [] }
      }
    } catch (error) {
      console.error('[SemanticSelector] Exception fetching requirements:', error)
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
      console.log('[SemanticSelector] No aspects to fill')
      return {}
    }

    const totalAspects = required.length + recommended.length
    console.log(`[SemanticSelector] LLM filling ${required.length} required + ${recommended.length} recommended aspects (total: ${totalAspects})...`)

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
        if (end > start) {
          resultText = resultText.substring(start, end).trim()
        }
      } else if (resultText.includes('```')) {
        const start = resultText.indexOf('```') + 3
        const end = resultText.indexOf('```', start)
        if (end > start) {
          resultText = resultText.substring(start, end).trim()
        }
      }

      // Find JSON object start
      if (!resultText.startsWith('{')) {
        const start = resultText.indexOf('{')
        if (start >= 0) {
          resultText = resultText.substring(start)
        }
      }

      // Find the closing brace - handle nested braces by counting
      if (resultText.startsWith('{')) {
        let braceCount = 0
        for (let i = 0; i < resultText.length; i++) {
          const char = resultText[i]
          if (char === '{') {
            braceCount++
          } else if (char === '}') {
            braceCount--
            if (braceCount === 0) {
              // Found the closing brace
              resultText = resultText.substring(0, i + 1)
              break
            }
          }
        }
      }

      // Parse and validate
      const filledAspects = JSON.parse(resultText) as FilledAspects

      // Validate and truncate aspect values to 65-char limit
      const validated = this.validateAndTruncateAspects(filledAspects)

      console.log(`[SemanticSelector] Filled ${Object.keys(validated).length} aspects total`)

      return validated
    } catch (error) {
      console.error('[SemanticSelector] LLM requirements filling failed:', error)
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

  /**
   * Get top category matches with similarity scores.
   * Useful for debugging or showing alternatives.
   */
  async getTopCategoryMatches(
    productTitle: string,
    productDescription: string = '',
    topK: number = 5
  ): Promise<CategoryCandidate[]> {
    return this.vectorDB.searchCategory(productTitle, productDescription, topK)
  }
}
