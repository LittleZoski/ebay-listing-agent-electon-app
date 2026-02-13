/**
 * File Watcher Service
 * Monitors folder for Amazon product JSON exports and processes them
 * Ported from Python: file_processor.py using chokidar
 */

import chokidar, { FSWatcher } from 'chokidar'
import path from 'path'
import fs from 'fs'
import { EventEmitter } from 'events'

export interface FileWatcherConfig {
  watchFolder: string
  processedFolder: string
  failedFolder: string
  filePattern?: RegExp
}

export interface FileWatcherEvents {
  'file-detected': (filePath: string, fileName: string) => void
  'file-queued': (filePath: string, queueSize: number) => void
  'processing-start': (filePath: string, remaining: number) => void
  'processing-complete': (filePath: string, success: boolean, error?: string) => void
  'watcher-started': (watchFolder: string) => void
  'watcher-stopped': () => void
  'error': (error: Error) => void
  'log': (message: string, level: 'info' | 'warn' | 'error') => void
}

export class FileWatcher extends EventEmitter {
  private watcher: FSWatcher | null = null
  private config: FileWatcherConfig
  private fileQueue: string[] = []
  private isProcessing = false
  private shouldStop = false
  private processCallback: ((filePath: string) => Promise<boolean>) | null = null

  constructor(config: FileWatcherConfig) {
    super()
    this.config = {
      ...config,
      filePattern: config.filePattern || /amazon-products-.*\.json$/i,
    }

    // Ensure folders exist
    this.ensureFolderExists(this.config.watchFolder)
    this.ensureFolderExists(this.config.processedFolder)
    this.ensureFolderExists(this.config.failedFolder)
  }

  private ensureFolderExists(folderPath: string): void {
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true })
      this.log(`Created folder: ${folderPath}`, 'info')
    }
  }

  private log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    this.emit('log', message, level)
  }

  /**
   * Set the callback function that processes each file
   */
  setProcessCallback(callback: (filePath: string) => Promise<boolean>): void {
    this.processCallback = callback
  }

  /**
   * Start watching the folder for new files
   */
  start(): void {
    if (this.watcher) {
      this.log('File watcher is already running', 'warn')
      return
    }

    this.shouldStop = false

    this.log(`Starting file watcher...`, 'info')
    this.log(`  Watching: ${this.config.watchFolder}`, 'info')
    this.log(`  Processed: ${this.config.processedFolder}`, 'info')
    this.log(`  Failed: ${this.config.failedFolder}`, 'info')

    // Initialize chokidar watcher
    this.watcher = chokidar.watch(this.config.watchFolder, {
      persistent: true,
      ignoreInitial: true, // Don't process existing files
      awaitWriteFinish: {
        stabilityThreshold: 2000, // Wait 2 seconds for file to be fully written
        pollInterval: 100,
      },
      depth: 0, // Only watch immediate folder, not subdirectories
    })

    // Handle new file events
    this.watcher.on('add', (filePath) => {
      this.handleNewFile(filePath)
    })

    // Handle errors
    this.watcher.on('error', (error: unknown) => {
      const err = error instanceof Error ? error : new Error(String(error))
      this.log(`Watcher error: ${err.message}`, 'error')
      this.emit('error', err)
    })

    // Start queue processor
    this.processQueue()

    this.log('=' .repeat(70), 'info')
    this.log('File Watcher Started', 'info')
    this.log('=' .repeat(70), 'info')
    this.log(`Waiting for Amazon product JSON files...`, 'info')
    this.log(`Mode: Queue-based processing (one file at a time)`, 'info')

    this.emit('watcher-started', this.config.watchFolder)
  }

  /**
   * Stop watching the folder
   */
  async stop(): Promise<void> {
    this.log('Stopping file watcher...', 'info')

    this.shouldStop = true

    // Close chokidar watcher
    if (this.watcher) {
      await this.watcher.close()
      this.watcher = null
      this.log('File system watcher stopped', 'info')
    }

    // Wait for current processing to complete (with timeout)
    if (this.isProcessing) {
      this.log('Waiting for current task to complete...', 'info')
      await this.waitForProcessing(10000) // 10 second timeout
    }

    // Report remaining items
    if (this.fileQueue.length > 0) {
      this.log(`Warning: ${this.fileQueue.length} file(s) were still in queue`, 'warn')
    }

    this.log('File watcher stopped completely', 'info')
    this.emit('watcher-stopped')
  }

  /**
   * Wait for processing to complete with timeout
   */
  private waitForProcessing(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const startTime = Date.now()
      const checkInterval = setInterval(() => {
        if (!this.isProcessing || Date.now() - startTime > timeoutMs) {
          clearInterval(checkInterval)
          resolve()
        }
      }, 100)
    })
  }

  /**
   * Handle a new file detected in the watch folder
   */
  private handleNewFile(filePath: string): void {
    const fileName = path.basename(filePath)

    // Check if file matches pattern
    if (!this.config.filePattern!.test(fileName)) {
      return
    }

    this.log(`New Amazon product file detected: ${fileName}`, 'info')
    this.emit('file-detected', filePath, fileName)

    // Check if file still exists
    if (!fs.existsSync(filePath)) {
      this.log(`File no longer exists: ${fileName}`, 'warn')
      return
    }

    // Add to queue
    this.addToQueue(filePath)
  }

  /**
   * Add a file to the processing queue
   */
  private addToQueue(filePath: string): void {
    this.fileQueue.push(filePath)
    const queueSize = this.fileQueue.length

    this.log(`Added to queue: ${path.basename(filePath)}`, 'info')
    this.log(`Queue status: ${queueSize} file(s) waiting`, 'info')

    if (queueSize > 1) {
      this.log(`File will be processed after ${queueSize - 1} other file(s)`, 'info')
    }

    this.emit('file-queued', filePath, queueSize)
  }

  /**
   * Process files from the queue one at a time
   */
  private async processQueue(): Promise<void> {
    this.log('Queue worker started', 'info')

    while (!this.shouldStop) {
      // Check if there's a file to process
      if (this.fileQueue.length === 0) {
        await this.sleep(1000) // Check every second
        continue
      }

      // Get next file from queue
      const filePath = this.fileQueue.shift()!
      const fileName = path.basename(filePath)
      const remaining = this.fileQueue.length

      this.isProcessing = true
      this.log(`\nStarting processing: ${fileName}`, 'info')
      if (remaining > 0) {
        this.log(`Files remaining in queue: ${remaining}`, 'info')
      }

      this.emit('processing-start', filePath, remaining)

      try {
        // Move file to processed folder first
        const newPath = this.moveToProcessed(filePath)

        // Process the file if callback is set
        let success = true
        if (this.processCallback) {
          success = await this.processCallback(newPath)
        }

        if (success) {
          this.log(`Completed: ${fileName}`, 'info')
          this.emit('processing-complete', filePath, true)
        } else {
          // Move to failed folder
          this.moveToFailed(newPath)
          this.log(`Failed: ${fileName}`, 'error')
          this.emit('processing-complete', filePath, false, 'Processing returned false')
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        this.log(`Error processing ${fileName}: ${errorMessage}`, 'error')
        this.emit('processing-complete', filePath, false, errorMessage)

        // Try to move to failed folder
        try {
          if (fs.existsSync(filePath)) {
            this.moveToFailed(filePath)
          }
        } catch {
          // Ignore move errors
        }
      }

      this.isProcessing = false
    }

    this.log('Queue worker stopped', 'info')
  }

  /**
   * Move file to processed folder
   */
  private moveToProcessed(filePath: string): string {
    const fileName = path.basename(filePath)
    let newPath = path.join(this.config.processedFolder, fileName)

    // Add timestamp if file already exists
    if (fs.existsSync(newPath)) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const ext = path.extname(fileName)
      const base = path.basename(fileName, ext)
      newPath = path.join(this.config.processedFolder, `${base}_${timestamp}${ext}`)
    }

    fs.renameSync(filePath, newPath)
    this.log(`Moved to: ${newPath}`, 'info')
    return newPath
  }

  /**
   * Move file to failed folder
   */
  private moveToFailed(filePath: string): void {
    const fileName = path.basename(filePath)
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const ext = path.extname(fileName)
    const base = path.basename(fileName, ext)
    const failedPath = path.join(this.config.failedFolder, `${base}_${timestamp}${ext}`)

    fs.renameSync(filePath, failedPath)
    this.log(`Moved to failed: ${failedPath}`, 'info')
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * Get current status
   */
  getStatus(): {
    running: boolean
    queueSize: number
    isProcessing: boolean
    watchFolder: string
  } {
    return {
      running: this.watcher !== null,
      queueSize: this.fileQueue.length,
      isProcessing: this.isProcessing,
      watchFolder: this.config.watchFolder,
    }
  }
}

/**
 * Load and parse a JSON file with Amazon products
 */
export function loadProductsFromFile(filePath: string): {
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
    price_multiplier?: number
    originalAmazonUrl?: string
  }>
  fileName: string
} {
  const content = fs.readFileSync(filePath, 'utf-8')
  const data = JSON.parse(content)

  return {
    products: data.products || [],
    fileName: path.basename(filePath),
  }
}