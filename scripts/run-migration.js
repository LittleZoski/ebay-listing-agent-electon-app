/**
 * Standalone Migration Script
 * Run this to import existing processed files into the listings database
 *
 * Usage: node scripts/run-migration.js [processedFolder] [accountId]
 *
 * Example:
 *   node scripts/run-migration.js "C:\Users\31243\ebay-listing-app\processed" "account_123"
 */

const path = require('path')
const fs = require('fs')

// Default paths
const DEFAULT_PROCESSED_FOLDER = 'C:\\Users\\31243\\ebay-listing-app\\processed'
const DEFAULT_ACCOUNT_ID = 'account_migration'

// We need to mock the Electron app module since we're running outside of Electron
const mockAppDataPath = path.join(process.env.APPDATA || '', 'ebay-seller-app')

// Ensure the mock app data path exists
if (!fs.existsSync(mockAppDataPath)) {
  fs.mkdirSync(mockAppDataPath, { recursive: true })
}

// Create a minimal mock of the electron app module
const mockApp = {
  getPath: (name) => {
    if (name === 'userData') {
      return mockAppDataPath
    }
    return ''
  }
}

// Inject the mock before requiring the modules
require.cache[require.resolve('electron')] = {
  id: 'electron',
  filename: 'electron',
  loaded: true,
  exports: {
    app: mockApp
  }
}

// Now we can use the modules
const Loki = require('lokijs')

// Product file structure
function parseProductFile(content) {
  try {
    return JSON.parse(content)
  } catch {
    return null
  }
}

// Result file structure
function parseResultFile(content) {
  try {
    return JSON.parse(content)
  } catch {
    return null
  }
}

async function runMigration(processedFolder, accountId) {
  console.log('='.repeat(60))
  console.log('eBay Listings Database Migration')
  console.log('='.repeat(60))
  console.log(`Source folder: ${processedFolder}`)
  console.log(`Account ID: ${accountId}`)
  console.log(`Database location: ${mockAppDataPath}`)
  console.log('')

  // Check if folder exists
  if (!fs.existsSync(processedFolder)) {
    console.error(`ERROR: Folder not found: ${processedFolder}`)
    process.exit(1)
  }

  // Initialize database
  const dbDir = path.join(mockAppDataPath, 'database')
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true })
  }

  const dbPath = path.join(dbDir, 'listings.db')
  console.log(`Database path: ${dbPath}`)

  return new Promise((resolve, reject) => {
    const db = new Loki(dbPath, {
      autoload: true,
      autosave: true,
      autosaveInterval: 5000,
      autoloadCallback: async (err) => {
        if (err) {
          console.error('Error loading database:', err)
          reject(err)
          return
        }

        // Get or create collection
        let listings = db.getCollection('listings')
        if (!listings) {
          console.log('Creating new listings collection...')
          listings = db.addCollection('listings', {
            unique: ['sku'],
            indices: ['accountId', 'source', 'status', 'categoryId', 'publishedAt', 'listingId'],
          })
        }

        console.log(`Existing listings in database: ${listings.count()}`)
        console.log('')

        // Scan for product files
        const allFiles = fs.readdirSync(processedFolder)
        const productFiles = allFiles.filter(
          f => f.endsWith('.json') && !f.includes('_results') && f.startsWith('amazon-products-')
        )

        console.log(`Found ${productFiles.length} product files to process`)
        console.log('')

        let totalProducts = 0
        let importedProducts = 0
        let updatedProducts = 0
        let errors = 0

        for (const productFileName of productFiles) {
          try {
            const productFilePath = path.join(processedFolder, productFileName)
            const resultsFileName = productFileName.replace('.json', '_results.json')
            const resultsFilePath = path.join(processedFolder, resultsFileName)
            const hasResults = fs.existsSync(resultsFilePath)

            // Load product file
            const productContent = fs.readFileSync(productFilePath, 'utf-8')
            const productData = parseProductFile(productContent)

            if (!productData || !productData.products || productData.products.length === 0) {
              console.log(`  Skipping empty file: ${productFileName}`)
              continue
            }

            // Load results if available
            let resultsData = null
            if (hasResults) {
              try {
                const resultsContent = fs.readFileSync(resultsFilePath, 'utf-8')
                resultsData = parseResultFile(resultsContent)
              } catch (e) {
                console.warn(`  Warning: Failed to parse results file: ${resultsFileName}`)
              }
            }

            // Create results map
            const resultsMap = new Map()
            if (resultsData?.results) {
              for (const r of resultsData.results) {
                resultsMap.set(r.sku, r)
              }
            }

            // Process each product
            for (const product of productData.products) {
              totalProducts++
              const resultForProduct = resultsMap.get(product.asin)

              const listing = {
                sku: product.asin,
                title: product.title,
                description: product.description,
                bulletPoints: product.bulletPoints,
                specifications: product.specifications,
                images: product.images,
                originalPrice: product.price,
                deliveryFee: product.deliveryFee,
                source: product.source || 'amazon',
                originalUrl: product.originalAmazonUrl,
                offerId: resultForProduct?.offer_id,
                listingId: resultForProduct?.listing_id,
                categoryId: resultForProduct?.category_id,
                categoryName: resultForProduct?.category_name,
                sourceFile: productFileName,
                publishedAt: resultsData?.processed_at || productData.exportedAt || new Date().toISOString(),
                accountId: accountId,
                processingTime: resultForProduct?.processing_time,
                status: resultForProduct?.status || 'success',
                failureStage: resultForProduct?.status === 'failed' ? resultForProduct.stage : undefined,
                failureError: resultForProduct?.status === 'failed' ? resultForProduct.error : undefined,
              }

              // Check if exists
              const existing = listings.findOne({ sku: listing.sku })
              if (existing) {
                Object.assign(existing, listing)
                listings.update(existing)
                updatedProducts++
              } else {
                listings.insert(listing)
                importedProducts++
              }
            }

            const resultInfo = hasResults ? 'with results' : 'no results'
            console.log(`  Processed: ${productFileName} (${productData.products.length} products, ${resultInfo})`)

          } catch (error) {
            console.error(`  ERROR processing ${productFileName}: ${error.message}`)
            errors++
          }
        }

        // Save database
        db.saveDatabase((saveErr) => {
          if (saveErr) {
            console.error('Error saving database:', saveErr)
            reject(saveErr)
            return
          }

          console.log('')
          console.log('='.repeat(60))
          console.log('Migration Complete!')
          console.log('='.repeat(60))
          console.log(`Total products found: ${totalProducts}`)
          console.log(`New products imported: ${importedProducts}`)
          console.log(`Existing products updated: ${updatedProducts}`)
          console.log(`Errors: ${errors}`)
          console.log(`Total listings in database: ${listings.count()}`)
          console.log('')
          console.log(`Database saved to: ${dbPath}`)

          db.close()
          resolve({
            totalProducts,
            importedProducts,
            updatedProducts,
            errors,
          })
        })
      }
    })
  })
}

// Main entry point
const args = process.argv.slice(2)
const processedFolder = args[0] || DEFAULT_PROCESSED_FOLDER
const accountId = args[1] || DEFAULT_ACCOUNT_ID

runMigration(processedFolder, accountId)
  .then(() => {
    console.log('Migration finished successfully!')
    process.exit(0)
  })
  .catch((error) => {
    console.error('Migration failed:', error)
    process.exit(1)
  })
