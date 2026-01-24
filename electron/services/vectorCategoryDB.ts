/**
 * Vector Database for eBay Category Semantic Search
 * Uses Transformers.js for embeddings + cosine similarity for fast, local semantic search
 * NO LLM CALLS NEEDED for category selection - completely free and fast!
 *
 * Ported from Python: vector_category_db.py
 */

import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { CategoryCache, Category } from './categoryCache'

// Transformers.js types
interface Pipeline {
  (texts: string[], options?: { pooling: string; normalize: boolean }): Promise<{ data: Float32Array; dims: number[] }>
}

interface CategoryMetadata {
  id: string
  name: string
  level: number
  path: string
  parentId: string
}

interface CategoryMatch {
  categoryId: string
  name: string
  path: string
  level: number
  similarityScore: number
}

interface VectorDBData {
  embeddings: number[][]
  metadata: CategoryMetadata[]
  modelName: string
  embeddingDim: number
  version: string
}

/**
 * Local vector database for semantic category matching.
 * Uses Transformers.js embeddings with cosine similarity search.
 */
export class VectorCategoryDB {
  private dbPath: string
  private indexFile: string
  private embeddings: number[][] = []
  private categoryMetadata: CategoryMetadata[] = []
  private embeddingDim: number = 384 // all-MiniLM-L6-v2 produces 384-dim embeddings
  private modelName: string = 'Xenova/all-MiniLM-L6-v2'
  private pipeline: Pipeline | null = null
  private isInitialized: boolean = false

  constructor(dbPath?: string) {
    // Store in app data directory
    const appDataPath = app.getPath('userData')
    this.dbPath = dbPath || path.join(appDataPath, 'vector_category_db')
    this.indexFile = path.join(this.dbPath, 'vector_index.json')

    // Ensure directory exists
    if (!fs.existsSync(this.dbPath)) {
      fs.mkdirSync(this.dbPath, { recursive: true })
    }

    // Try to load existing index
    this.loadIndex()
  }

  /**
   * Load existing vector index from disk
   */
  private loadIndex(): boolean {
    try {
      if (!fs.existsSync(this.indexFile)) {
        console.log('[VectorDB] No existing vector index found')
        return false
      }

      const data = JSON.parse(fs.readFileSync(this.indexFile, 'utf-8')) as VectorDBData
      this.embeddings = data.embeddings || []
      this.categoryMetadata = data.metadata || []
      this.embeddingDim = data.embeddingDim || 384

      console.log(`[VectorDB] Loaded existing index with ${this.categoryMetadata.length} categories`)
      return true
    } catch (error) {
      console.error('[VectorDB] Failed to load index:', error)
      return false
    }
  }

  /**
   * Save vector index to disk
   */
  private saveIndex(): void {
    try {
      const data: VectorDBData = {
        embeddings: this.embeddings,
        metadata: this.categoryMetadata,
        modelName: this.modelName,
        embeddingDim: this.embeddingDim,
        version: '1.0',
      }

      fs.writeFileSync(this.indexFile, JSON.stringify(data))
      console.log(`[VectorDB] Saved index with ${this.categoryMetadata.length} categories`)
    } catch (error) {
      console.error('[VectorDB] Failed to save index:', error)
    }
  }

  /**
   * Initialize the embedding pipeline (lazy loading)
   */
  private async initializePipeline(): Promise<void> {
    if (this.pipeline) return

    console.log('[VectorDB] Loading sentence transformer model...')
    console.log('[VectorDB] This may take a moment on first run (downloading model)...')

    try {
      // Dynamic import to avoid issues with ES modules
      const { pipeline } = await import('@xenova/transformers')

      // Use feature-extraction pipeline with the all-MiniLM-L6-v2 model
      this.pipeline = await pipeline('feature-extraction', this.modelName, {
        quantized: true, // Use quantized model for faster inference
      }) as unknown as Pipeline

      console.log('[VectorDB] Model loaded successfully')
    } catch (error) {
      console.error('[VectorDB] Failed to load model:', error)
      throw error
    }
  }

  /**
   * Generate embeddings for texts
   */
  private async generateEmbeddings(texts: string[]): Promise<number[][]> {
    await this.initializePipeline()

    if (!this.pipeline) {
      throw new Error('Pipeline not initialized')
    }

    const embeddings: number[][] = []
    const batchSize = 32

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize)

      // Process batch
      for (const text of batch) {
        const output = await this.pipeline([text], {
          pooling: 'mean',
          normalize: true,
        })

        // Convert to array and normalize
        const embedding = Array.from(output.data)
        embeddings.push(this.normalizeVector(embedding))
      }

      // Progress logging
      if ((i + batchSize) % 100 === 0 || i + batchSize >= texts.length) {
        console.log(`[VectorDB] Generated embeddings: ${Math.min(i + batchSize, texts.length)}/${texts.length}`)
      }
    }

    return embeddings
  }

  /**
   * Normalize a vector to unit length
   */
  private normalizeVector(vector: number[]): number[] {
    const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0))
    if (norm === 0) return vector
    return vector.map(val => val / norm)
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0

    let dotProduct = 0
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i]
    }

    // Vectors are already normalized, so dot product = cosine similarity
    return dotProduct
  }

  /**
   * Check if vector database is initialized with data
   */
  hasData(): boolean {
    return this.embeddings.length > 0 && this.categoryMetadata.length > 0
  }

  /**
   * Get the number of categories in the database
   */
  getCategoryCount(): number {
    return this.categoryMetadata.length
  }

  /**
   * Build vector database from CategoryCache.
   * This only needs to be run once, or when categories update.
   */
  async initializeFromCache(categoryCache: CategoryCache, forceRebuild: boolean = false): Promise<void> {
    if (!forceRebuild && this.hasData()) {
      console.log(`[VectorDB] Already initialized with ${this.categoryMetadata.length} categories`)
      this.isInitialized = true
      return
    }

    console.log('[VectorDB] Building vector database from category cache...')

    // Get all categories from cache
    const allCategories = categoryCache.getAllCategories()

    // Filter to leaf categories at levels 2-4
    const leafCategories = allCategories.filter(cat =>
      cat.leaf && cat.level >= 2 && cat.level <= 4
    )

    console.log(`[VectorDB] Found ${leafCategories.length} leaf categories (levels 2-4)`)

    // Build searchable texts and metadata
    const categoryTexts: string[] = []
    const metadata: CategoryMetadata[] = []

    for (const cat of leafCategories) {
      // Build rich text for semantic search
      // Include category name + full path for context
      const categoryPath = categoryCache.getCategoryPath(cat.id)
      const searchableText = `${cat.name} - ${categoryPath}`

      categoryTexts.push(searchableText)
      metadata.push({
        id: cat.id,
        name: cat.name,
        level: cat.level,
        path: categoryPath,
        parentId: cat.parentId || '',
      })
    }

    console.log(`[VectorDB] Generating embeddings for ${categoryTexts.length} categories...`)

    // Generate embeddings
    this.embeddings = await this.generateEmbeddings(categoryTexts)
    this.categoryMetadata = metadata

    // Save to disk
    this.saveIndex()

    this.isInitialized = true
    console.log(`[VectorDB] Vector database built with ${metadata.length} categories`)
  }

  /**
   * Semantic search for best matching categories.
   */
  async searchCategory(
    productTitle: string,
    productDescription: string = '',
    topK: number = 5
  ): Promise<CategoryMatch[]> {
    if (!this.hasData()) {
      throw new Error('Vector database not initialized. Run initializeFromCache() first.')
    }

    // Build search query - combine title and description
    // Title is weighted more heavily by putting it first
    let query = productTitle
    if (productDescription) {
      query = `${productTitle} ${productDescription.substring(0, 200)}`
    }

    // Generate embedding for query
    const queryEmbeddings = await this.generateEmbeddings([query])
    const queryEmbedding = queryEmbeddings[0]

    // Calculate similarities with all categories
    const similarities: Array<{ index: number; similarity: number }> = []

    for (let i = 0; i < this.embeddings.length; i++) {
      const similarity = this.cosineSimilarity(queryEmbedding, this.embeddings[i])
      similarities.push({ index: i, similarity })
    }

    // Sort by similarity (descending)
    similarities.sort((a, b) => b.similarity - a.similarity)

    // Return top K matches
    const matches: CategoryMatch[] = []
    for (let i = 0; i < Math.min(topK, similarities.length); i++) {
      const { index, similarity } = similarities[i]
      const metadata = this.categoryMetadata[index]

      matches.push({
        categoryId: metadata.id,
        name: metadata.name,
        path: metadata.path,
        level: metadata.level,
        similarityScore: Math.round(similarity * 1000) / 1000, // Round to 3 decimal places
      })
    }

    return matches
  }

  /**
   * Get single best matching category with confidence score.
   */
  async getBestCategory(
    productTitle: string,
    productDescription: string = '',
    minSimilarity: number = 0.5
  ): Promise<{ categoryId: string; categoryName: string; confidence: number }> {
    const matches = await this.searchCategory(productTitle, productDescription, 3)

    if (matches.length === 0) {
      console.warn('[VectorDB] No category matches found!')
      // Fallback to a generic category
      return { categoryId: '360', categoryName: 'Art Prints', confidence: 0.3 }
    }

    const best = matches[0]

    if (best.similarityScore < minSimilarity) {
      console.warn(`[VectorDB] Best match similarity ${best.similarityScore} below threshold ${minSimilarity}`)
    }

    console.log(`[VectorDB] Best match: ${best.name} (ID: ${best.categoryId}, similarity: ${best.similarityScore})`)

    return {
      categoryId: best.categoryId,
      categoryName: best.name,
      confidence: best.similarityScore,
    }
  }
}

// Singleton instance
let vectorDBInstance: VectorCategoryDB | null = null

export function getVectorCategoryDB(): VectorCategoryDB {
  if (!vectorDBInstance) {
    vectorDBInstance = new VectorCategoryDB()
  }
  return vectorDBInstance
}
