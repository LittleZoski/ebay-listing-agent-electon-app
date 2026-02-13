/**
 * Listings Migration Service
 * Imports existing processed JSON files into the listings database
 * Handles both product files and their corresponding result files
 */

import fs from 'fs'
import path from 'path'
import { getListingsDatabase, AddListingInput } from './listingsDatabase'

interface ProductFile {
  exportedAt?: string
  totalProducts?: number
  products: Array<{
    asin: string
    title: string
    description?: string
    bulletPoints?: string[]
    specifications?: Record<string, string>
    images?: string[]
    price?: string
    deliveryFee?: string
    source?: string
    originalAmazonUrl?: string
  }>
}

interface ResultFile {
  source_file: string
  processed_at: string
  total_products: number
  successful: number
  failed: number
  results: Array<{
    sku: string
    status: 'success' | 'failed'
    category_id?: string
    category_name?: string
    offer_id?: string
    listing_id?: string
    processing_time?: number
    stage?: string
    error?: string
  }>
}

export interface MigrationProgress {
  phase: 'scanning' | 'processing' | 'complete'
  currentFile?: string
  totalFiles: number
  processedFiles: number
  totalProducts: number
  importedProducts: number
  skippedProducts: number
  errors: string[]
}

export interface MigrationResult {
  success: boolean
  totalFiles: number
  processedFiles: number
  totalProducts: number
  importedProducts: number
  skippedProducts: number
  updatedProducts: number
  errors: string[]
}

type ProgressCallback = (progress: MigrationProgress) => void

/**
 * Migrate existing processed files to the listings database
 */
export async function migrateProcessedFiles(
  processedFolder: string,
  accountId: string,
  onProgress?: ProgressCallback
): Promise<MigrationResult> {
  const result: MigrationResult = {
    success: false,
    totalFiles: 0,
    processedFiles: 0,
    totalProducts: 0,
    importedProducts: 0,
    skippedProducts: 0,
    updatedProducts: 0,
    errors: [],
  }

  const progress: MigrationProgress = {
    phase: 'scanning',
    totalFiles: 0,
    processedFiles: 0,
    totalProducts: 0,
    importedProducts: 0,
    skippedProducts: 0,
    errors: [],
  }

  try {
    console.log(`[Migration] Starting migration from: ${processedFolder}`)

    // Check if folder exists
    if (!fs.existsSync(processedFolder)) {
      throw new Error(`Processed folder not found: ${processedFolder}`)
    }

    // Initialize database
    const db = getListingsDatabase()
    await db.initialize()

    // Scan for product files (not _results files)
    const allFiles = fs.readdirSync(processedFolder)
    const productFiles = allFiles.filter(
      (f) =>
        f.endsWith('.json') &&
        !f.includes('_results') &&
        f.startsWith('amazon-products-')
    )

    result.totalFiles = productFiles.length
    progress.totalFiles = productFiles.length

    console.log(`[Migration] Found ${productFiles.length} product files to process`)
    onProgress?.(progress)

    progress.phase = 'processing'

    // Process each product file
    for (const productFileName of productFiles) {
      try {
        progress.currentFile = productFileName
        onProgress?.(progress)

        const productFilePath = path.join(processedFolder, productFileName)

        // Look for matching results file
        const resultsFileName = productFileName.replace('.json', '_results.json')
        const resultsFilePath = path.join(processedFolder, resultsFileName)
        const hasResults = fs.existsSync(resultsFilePath)

        // Load product file
        const productContent = fs.readFileSync(productFilePath, 'utf-8')
        const productData: ProductFile = JSON.parse(productContent)

        if (!productData.products || productData.products.length === 0) {
          console.log(`[Migration] Skipping empty file: ${productFileName}`)
          progress.skippedProducts++
          progress.processedFiles++
          continue
        }

        // Load results if available
        let resultsData: ResultFile | null = null
        if (hasResults) {
          try {
            const resultsContent = fs.readFileSync(resultsFilePath, 'utf-8')
            resultsData = JSON.parse(resultsContent)
          } catch (e) {
            console.warn(`[Migration] Failed to parse results file: ${resultsFileName}`)
          }
        }

        // Create a map of results by SKU for quick lookup
        const resultsMap = new Map<string, ResultFile['results'][0]>()
        if (resultsData?.results) {
          for (const r of resultsData.results) {
            resultsMap.set(r.sku, r)
          }
        }

        // Process each product
        const inputs: AddListingInput[] = []

        for (const product of productData.products) {
          result.totalProducts++
          progress.totalProducts++

          const resultForProduct = resultsMap.get(product.asin)

          // Create input for database
          const input: AddListingInput = {
            product: {
              asin: product.asin,
              title: product.title,
              description: product.description,
              bulletPoints: product.bulletPoints,
              specifications: product.specifications,
              images: product.images,
              price: product.price,
              deliveryFee: product.deliveryFee,
              source: product.source || 'amazon',
              originalAmazonUrl: product.originalAmazonUrl,
            },
            result: resultForProduct
              ? {
                  sku: resultForProduct.sku,
                  status: resultForProduct.status,
                  categoryId: resultForProduct.category_id,
                  categoryName: resultForProduct.category_name,
                  offerId: resultForProduct.offer_id,
                  listingId: resultForProduct.listing_id,
                  processingTime: resultForProduct.processing_time,
                  stage: resultForProduct.stage,
                  error: resultForProduct.error,
                }
              : {
                  // No results file - mark as unknown status
                  sku: product.asin,
                  status: 'success' as const, // Assume success if in processed folder
                },
            sourceFile: productFileName,
            accountId,
          }

          inputs.push(input)
        }

        // Bulk insert
        if (inputs.length > 0) {
          const bulkResult = await db.bulkUpsert(inputs)
          result.importedProducts += bulkResult.added
          result.updatedProducts += bulkResult.updated
          progress.importedProducts += bulkResult.added + bulkResult.updated

          if (bulkResult.errors > 0) {
            result.errors.push(`${bulkResult.errors} errors in ${productFileName}`)
          }
        }

        result.processedFiles++
        progress.processedFiles++

        console.log(
          `[Migration] Processed ${productFileName}: ${inputs.length} products` +
            (hasResults ? ' (with results)' : ' (no results file)')
        )

        onProgress?.(progress)
      } catch (error) {
        const errorMessage = `Error processing ${productFileName}: ${error instanceof Error ? error.message : String(error)}`
        console.error(`[Migration] ${errorMessage}`)
        result.errors.push(errorMessage)
        progress.errors.push(errorMessage)
        result.processedFiles++
        progress.processedFiles++
      }
    }

    // Force save database
    await db.save()

    result.success = true
    progress.phase = 'complete'
    onProgress?.(progress)

    console.log(`[Migration] Complete!`)
    console.log(`  Files: ${result.processedFiles}/${result.totalFiles}`)
    console.log(`  Products: ${result.importedProducts} imported, ${result.updatedProducts} updated`)
    console.log(`  Errors: ${result.errors.length}`)

    return result
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error(`[Migration] Fatal error: ${errorMessage}`)
    result.errors.push(errorMessage)
    return result
  }
}

/**
 * Get info about what would be migrated (dry run)
 */
export async function getMigrationPreview(
  processedFolder: string
): Promise<{
  totalFiles: number
  filesWithResults: number
  filesWithoutResults: number
  estimatedProducts: number
}> {
  const preview = {
    totalFiles: 0,
    filesWithResults: 0,
    filesWithoutResults: 0,
    estimatedProducts: 0,
  }

  if (!fs.existsSync(processedFolder)) {
    return preview
  }

  const allFiles = fs.readdirSync(processedFolder)
  const productFiles = allFiles.filter(
    (f) =>
      f.endsWith('.json') &&
      !f.includes('_results') &&
      f.startsWith('amazon-products-')
  )

  preview.totalFiles = productFiles.length

  for (const productFileName of productFiles) {
    const resultsFileName = productFileName.replace('.json', '_results.json')
    const hasResults = allFiles.includes(resultsFileName)

    if (hasResults) {
      preview.filesWithResults++
    } else {
      preview.filesWithoutResults++
    }

    // Estimate product count from file
    try {
      const filePath = path.join(processedFolder, productFileName)
      const content = fs.readFileSync(filePath, 'utf-8')
      const data = JSON.parse(content) as ProductFile
      preview.estimatedProducts += data.products?.length || 0
    } catch {
      // Skip on error
    }
  }

  return preview
}
