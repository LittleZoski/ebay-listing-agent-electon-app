import { useState, useMemo, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  Package,
  RefreshCw,
  Eye,
  Heart,
  ShoppingCart,
  AlertCircle,
  Search,
  ExternalLink,
  Clock,
  TrendingUp,
  Archive,
  HelpCircle,
  Filter,
  ArrowUpDown,
  Loader2,
  CheckCircle,
  XCircle,
  DollarSign,
  ChevronDown,
  ChevronUp,
  LogIn,
  Play,
  Square,
  AlertTriangle,
  ShieldCheck,
  Minus,
} from 'lucide-react'

// Types from preload
interface EbayListing {
  listingId: string
  sku: string
  title: string
  price: { value: string; currency: string }
  quantity: number
  quantitySold: number
  status: 'ACTIVE' | 'INACTIVE' | 'ENDED' | 'OUT_OF_STOCK'
  views30Days: number
  watcherCount: number
  questionCount: number
  soldQuantity: number
  listingStartDate: string
  listingEndDate: string | null
  daysRemaining: number | null
  imageUrl: string | null
  categoryId: string
  categoryName: string
  condition: string
  listingFormat: string
  fetchedAt: string
}

interface ListingDataExport {
  exportedAt: string
  accountId: string
  accountName: string
  totalListings: number
  listings: EbayListing[]
}

interface ListingProgress {
  stage: string
  current: number
  total: number
  message: string
}

interface FetchListingsResult {
  success: boolean
  accountName: string
  totalListings: number
  listings: EbayListing[]
  newListings: number
  updatedListings: number
  exportPath?: string
  error?: string
}

interface AmazonPriceResult {
  sku: string
  ebayListingId: string
  listingSource: 'amazon' | 'yami' | 'costco' | 'unknown'
  sourceId: string | null
  sourcePrice: number | null
  sourceTitle: string | null
  sourceUrl: string | null
  isAvailable: boolean
  ebayPrice: number
  multiplier: number | null
  method: 'direct' | 'search' | 'not_checkable' | 'error'
  error?: string
  checkedAt: string
}

interface AmazonPriceCheckBatch {
  results: AmazonPriceResult[]
  totalChecked: number
  checkableListings: number
  needsAttention: number
  cachedCount?: number
}

interface AmazonPriceCheckProgress {
  current: number
  total: number
  sku: string
  status: string
}

interface SavedFailure {
  sku: string
  ebayListingId: string
  ebayTitle: string
  listingSource: 'amazon' | 'yami' | 'costco' | 'unknown'
  ebayPrice: number
  sourcePrice: number | null
  multiplier: number | null
  isAvailable: boolean
  sourceUrl: string | null
  failureReason: 'price' | 'unavailable' | 'both' | 'error'
  error?: string
  checkedAt: string
}

interface PersistedFailures {
  failures: SavedFailure[]
  savedAt: string
  totalChecked: number
  source: 'all' | 'amazon' | 'yami' | 'costco'
}

interface ListingUpdateResult {
  success: boolean
  sku: string
  newPrice?: number
  offerId?: string
  error?: string
}

function formatCurrency(amount: string | number, currency: string = 'USD'): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(num)
}

function formatDate(dateString: string): string {
  try {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  } catch {
    return dateString
  }
}

function formatRelativeTime(dateString: string): string {
  try {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return formatDate(dateString)
  } catch {
    return dateString
  }
}

// Status badge component
function StatusBadge({ status }: { status: EbayListing['status'] }) {
  const statusConfig = {
    ACTIVE: { bg: 'bg-green-100', text: 'text-green-800', icon: CheckCircle },
    INACTIVE: { bg: 'bg-gray-100', text: 'text-gray-800', icon: Archive },
    ENDED: { bg: 'bg-red-100', text: 'text-red-800', icon: XCircle },
    OUT_OF_STOCK: { bg: 'bg-yellow-100', text: 'text-yellow-800', icon: AlertCircle },
  }
  const config = statusConfig[status] || statusConfig.INACTIVE
  const Icon = config.icon

  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${config.bg} ${config.text}`}>
      <Icon className="w-3 h-3" />
      {status.replace('_', ' ')}
    </span>
  )
}

// Metric badge component
function MetricBadge({
  icon,
  value,
  label,
  warning,
}: {
  icon: React.ReactNode
  value: number
  label: string
  warning?: boolean
}) {
  return (
    <div className={`flex items-center gap-1 text-xs ${warning ? 'text-red-600' : 'text-gray-500'}`}>
      {icon}
      <span className="font-medium">{value}</span>
      <span className="hidden sm:inline">{label}</span>
    </div>
  )
}

// Multiplier badge for price check results
function MultiplierBadge({ multiplier }: { multiplier: number | null }) {
  if (multiplier === null) {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
        <Minus className="w-3 h-3" />
        N/A
      </span>
    )
  }
  if (multiplier >= 2) {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-800 font-semibold">
        <ShieldCheck className="w-3 h-3" />
        {multiplier.toFixed(2)}x
      </span>
    )
  }
  if (multiplier >= 1.5) {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800 font-semibold">
        <AlertTriangle className="w-3 h-3" />
        {multiplier.toFixed(2)}x
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-800 font-semibold">
      <AlertTriangle className="w-3 h-3" />
      {multiplier.toFixed(2)}x
    </span>
  )
}

type SourceFilter = 'all' | 'amazon' | 'yami' | 'costco'

function isAmazonSku(sku: string) {
  const s = sku.trim()
  return /^AMZN-[A-Z0-9]{10}$/i.test(s) || /^B[0-9A-Z]{9}$/.test(s.toUpperCase())
}
function isYamiSku(sku: string) { return /^[15]\d{7,11}$/.test(sku.trim()) }
function isCostcoSku(sku: string) { return /^4\d{7,11}$/.test(sku.trim()) }

function skuMatchesFilter(sku: string, filter: SourceFilter) {
  if (filter === 'amazon') return isAmazonSku(sku)
  if (filter === 'yami') return isYamiSku(sku)
  if (filter === 'costco') return isCostcoSku(sku)
  return isAmazonSku(sku) || isYamiSku(sku) || isCostcoSku(sku)
}

function sourceColor(source: string) {
  if (source === 'amazon') return 'bg-orange-100 text-orange-700'
  if (source === 'yami') return 'bg-red-100 text-red-700'
  if (source === 'costco') return 'bg-blue-100 text-blue-700'
  return 'bg-gray-100 text-gray-500'
}

function ResultsTable({
  rows,
  skuToListingId,
  skuToTitle,
}: {
  rows: AmazonPriceResult[]
  skuToListingId: Map<string, string>
  skuToTitle: Map<string, string>
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-gray-200 text-xs text-gray-500 text-left">
            <th className="pb-2 pr-3 font-medium">SKU / Title</th>
            <th className="pb-2 pr-3 font-medium">Src</th>
            <th className="pb-2 pr-3 font-medium">eBay</th>
            <th className="pb-2 pr-3 font-medium">Source</th>
            <th className="pb-2 pr-3 font-medium">Mult.</th>
            <th className="pb-2 pr-3 font-medium">In Stock</th>
            <th className="pb-2 pr-3 font-medium">Method</th>
            <th className="pb-2 pr-3 font-medium">Src Link</th>
            <th className="pb-2 font-medium">eBay Link</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const lid = skuToListingId.get(r.sku) || r.ebayListingId
            const title = skuToTitle.get(r.sku)
            const rowBg =
              r.method === 'error' ? 'bg-gray-50' :
              !r.isAvailable && r.method !== 'not_checkable' ? 'bg-orange-50' :
              r.multiplier !== null && r.multiplier < 2 ? 'bg-red-50' : ''
            return (
              <tr key={r.sku} className={`border-b border-gray-100 last:border-0 ${rowBg}`}>
                <td className="py-2 pr-3 max-w-[180px]">
                  <code className="text-xs font-mono bg-gray-100 px-1.5 py-0.5 rounded block truncate">
                    {r.sku}
                  </code>
                  {title && (
                    <span className="text-xs text-gray-400 truncate block mt-0.5" title={title}>
                      {title.slice(0, 50)}{title.length > 50 ? '…' : ''}
                    </span>
                  )}
                </td>
                <td className="py-2 pr-3">
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${sourceColor(r.listingSource)}`}>
                    {r.listingSource}
                  </span>
                </td>
                <td className="py-2 pr-3 font-medium text-gray-900 whitespace-nowrap">
                  {formatCurrency(r.ebayPrice)}
                </td>
                <td className="py-2 pr-3 whitespace-nowrap">
                  {r.sourcePrice !== null ? (
                    <span className="font-medium text-gray-900">{formatCurrency(r.sourcePrice)}</span>
                  ) : (
                    <span className="text-gray-400 text-xs">—</span>
                  )}
                </td>
                <td className="py-2 pr-3">
                  <MultiplierBadge multiplier={r.multiplier} />
                </td>
                <td className="py-2 pr-3">
                  {r.method === 'error' || r.method === 'not_checkable' ? (
                    <span className="text-gray-400 text-xs">—</span>
                  ) : r.isAvailable ? (
                    <span className="text-xs text-green-700 flex items-center gap-1">
                      <CheckCircle className="w-3 h-3" /> Yes
                    </span>
                  ) : (
                    <span className="text-xs text-red-700 flex items-center gap-1">
                      <XCircle className="w-3 h-3" /> No
                    </span>
                  )}
                </td>
                <td className="py-2 pr-3">
                  <span className="text-xs text-gray-500 capitalize">{r.method}</span>
                  {r.error && (
                    <span className="block text-xs text-red-500 truncate max-w-[100px]" title={r.error}>
                      {r.error}
                    </span>
                  )}
                </td>
                <td className="py-2 pr-3">
                  {r.sourceUrl ? (
                    <button
                      onClick={() => window.electronAPI.openExternalUrl(r.sourceUrl!)}
                      className="p-1 hover:bg-gray-100 rounded transition-colors"
                      title={`View on ${r.listingSource}`}
                    >
                      <ExternalLink className={`w-3.5 h-3.5 ${
                        r.listingSource === 'amazon' ? 'text-orange-500' :
                        r.listingSource === 'yami' ? 'text-red-500' : 'text-blue-500'
                      }`} />
                    </button>
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </td>
                <td className="py-2">
                  {lid ? (
                    <button
                      onClick={() => window.electronAPI.openExternalUrl(`https://www.ebay.com/itm/${lid}`)}
                      className="p-1 hover:bg-gray-100 rounded transition-colors"
                      title={`View eBay listing ${lid}`}
                    >
                      <ExternalLink className="w-3.5 h-3.5 text-blue-500" />
                    </button>
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// Price/Inventory Checker panel
function PriceCheckerPanel({ listings, accountId }: { listings: EbayListing[]; accountId: string }) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [progress, setProgress] = useState<AmazonPriceCheckProgress | null>(null)
  const [results, setResults] = useState<AmazonPriceResult[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [persistedFailures, setPersistedFailures] = useState<SavedFailure[] | null>(null)
  const [persistedMeta, setPersistedMeta] = useState<{ savedAt: string; totalChecked: number; source: SourceFilter } | null>(null)
  const [showFailures, setShowFailures] = useState(false)
  const [fixingSkus, setFixingSkus] = useState<Set<string>>(new Set())
  const [fixResults, setFixResults] = useState<Map<string, ListingUpdateResult>>(new Map())
  const [isAutoFixing, setIsAutoFixing] = useState(false)
  const [autoFixProgress, setAutoFixProgress] = useState<{ current: number; total: number; succeeded: number; failed: number; sku: string } | null>(null)
  const [targetMultiplier, setTargetMultiplier] = useState(2.1)
  const [cachedCount, setCachedCount] = useState(0)
  const [marginFilterThreshold, setMarginFilterThreshold] = useState('')
  const [savedFilter, setSavedFilter] = useState<'all' | 'price' | 'oos' | 'error'>('all')
  const [savedPage, setSavedPage] = useState(0)
  const SAVED_PAGE_SIZE = 50
  const [resultsPage, setResultsPage] = useState(0)
  const [failuresPage, setFailuresPage] = useState(0)
  const RESULTS_PAGE_SIZE = 50
  const FAILURES_PAGE_SIZE = 50

  const skuToListingId = useMemo(() => {
    const map = new Map<string, string>()
    listings.forEach((l) => { if (l.listingId) map.set(l.sku, l.listingId) })
    return map
  }, [listings])

  const skuToTitle = useMemo(() => {
    const map = new Map<string, string>()
    listings.forEach((l) => { if (l.title) map.set(l.sku, l.title) })
    return map
  }, [listings])

  // Listings that match the selected source filter and are ACTIVE
  const filteredCheckableListings = useMemo(
    () => listings.filter((l) => l.status === 'ACTIVE' && skuMatchesFilter(l.sku, sourceFilter)),
    [listings, sourceFilter]
  )

  // Per-source counts for filter tabs
  const sourceCounts = useMemo(() => ({
    all: listings.filter((l) => l.status === 'ACTIVE' && (isAmazonSku(l.sku) || isYamiSku(l.sku) || isCostcoSku(l.sku))).length,
    amazon: listings.filter((l) => l.status === 'ACTIVE' && isAmazonSku(l.sku)).length,
    yami: listings.filter((l) => l.status === 'ACTIVE' && isYamiSku(l.sku)).length,
    costco: listings.filter((l) => l.status === 'ACTIVE' && isCostcoSku(l.sku)).length,
  }), [listings])

  // Persisted failures: filtered + sorted + paginated
  const savedFilteredSorted = useMemo(() => {
    if (!persistedFailures) return []
    const filtered = savedFilter === 'all'
      ? persistedFailures
      : savedFilter === 'oos'
        ? persistedFailures.filter(f => f.failureReason === 'unavailable' || f.failureReason === 'both')
        : persistedFailures.filter(f => f.failureReason === savedFilter)
    // Sort: OOS/both most critical, then price, then error
    const order: Record<string, number> = { unavailable: 0, both: 0, price: 1, error: 2 }
    return [...filtered].sort((a, b) => (order[a.failureReason] ?? 2) - (order[b.failureReason] ?? 2))
  }, [persistedFailures, savedFilter])

  const savedTotalPages = Math.ceil(savedFilteredSorted.length / SAVED_PAGE_SIZE)
  const savedPageData = useMemo(
    () => savedFilteredSorted.slice(savedPage * SAVED_PAGE_SIZE, (savedPage + 1) * SAVED_PAGE_SIZE),
    [savedFilteredSorted, savedPage]
  )

  const resultsTotalPages = results ? Math.ceil(results.length / RESULTS_PAGE_SIZE) : 0
  const resultsPageData = useMemo(
    () => results ? results.slice(resultsPage * RESULTS_PAGE_SIZE, (resultsPage + 1) * RESULTS_PAGE_SIZE) : [],
    [results, resultsPage]
  )

  const savedCounts = useMemo(() => {
    if (!persistedFailures) return { all: 0, price: 0, oos: 0, error: 0 }
    return {
      all: persistedFailures.length,
      price: persistedFailures.filter(f => f.failureReason === 'price').length,
      oos: persistedFailures.filter(f => f.failureReason === 'unavailable' || f.failureReason === 'both').length,
      error: persistedFailures.filter(f => f.failureReason === 'error').length,
    }
  }, [persistedFailures])

  const handleSavedFilterChange = (f: 'all' | 'price' | 'oos' | 'error') => {
    setSavedFilter(f)
    setSavedPage(0)
  }

  // Load persisted failures when panel expands
  useEffect(() => {
    if (!isExpanded || !accountId) return
    window.electronAPI.loadPriceCheckFailures(accountId).then((data) => {
      if (data) {
        setPersistedFailures(data.failures)
        setPersistedMeta({ savedAt: data.savedAt, totalChecked: data.totalChecked, source: data.source as SourceFilter })
      }
    }).catch(() => {})
  }, [isExpanded, accountId])

  useEffect(() => {
    const cleanup = window.electronAPI.onAmazonPriceCheckProgress((data) => {
      setProgress(data)
    })
    return cleanup
  }, [])

  useEffect(() => {
    const cleanup = window.electronAPI.onAutoFixProgress((data) => {
      // Update progress bar
      setAutoFixProgress({ current: data.current, total: data.total, succeeded: data.succeeded, failed: data.failed, sku: data.sku })
      // Apply individual result live so the row updates immediately
      if (data.result) {
        setFixResults((prev) => new Map(prev).set(data.result.sku, data.result as ListingUpdateResult))
        if (data.result.success) {
          setPersistedFailures((prev) => prev ? prev.filter(f => f.sku !== data.result.sku) : prev)
        }
      }
    })
    return cleanup
  }, [])

  const saveFailures = async (batchResults: AmazonPriceResult[], totalChecked: number) => {
    const failures: SavedFailure[] = batchResults
      .filter((r) => {
        if (r.method === 'error') return true
        if (!r.isAvailable) return true
        if (r.multiplier !== null && r.multiplier < 2) return true
        return false
      })
      .map((r) => {
        let failureReason: SavedFailure['failureReason'] = 'error'
        if (r.method !== 'error') {
          const badPrice = r.multiplier !== null && r.multiplier < 2
          const unavailable = !r.isAvailable
          if (badPrice && unavailable) failureReason = 'both'
          else if (badPrice) failureReason = 'price'
          else failureReason = 'unavailable'
        }
        return {
          sku: r.sku,
          ebayListingId: skuToListingId.get(r.sku) || r.ebayListingId,
          ebayTitle: skuToTitle.get(r.sku) || '',
          listingSource: r.listingSource,
          ebayPrice: r.ebayPrice,
          sourcePrice: r.sourcePrice,
          multiplier: r.multiplier,
          isAvailable: r.isAvailable,
          sourceUrl: r.sourceUrl,
          failureReason,
          error: r.error,
          checkedAt: r.checkedAt,
        }
      })

    const payload: PersistedFailures = {
      failures,
      savedAt: new Date().toISOString(),
      totalChecked,
      source: sourceFilter,
    }
    try {
      await window.electronAPI.savePriceCheckFailures(accountId, payload)
      setPersistedFailures(failures)
      setPersistedMeta({ savedAt: payload.savedAt, totalChecked, source: sourceFilter })
    } catch { /* non-critical */ }
  }

  const handleRun = async () => {
    setIsRunning(true)
    setError(null)
    setResults(null)
    setProgress(null)
    setResultsPage(0)
    setFailuresPage(0)
    try {
      const batch = await window.electronAPI.checkAmazonPrices(
        accountId,
        filteredCheckableListings.map((l) => ({
          sku: l.sku,
          listingId: l.listingId,
          title: l.title,
          price: l.price,
          imageUrl: l.imageUrl ?? null,
        }))
      ) as AmazonPriceCheckBatch
      setResults(batch.results)
      setCachedCount(batch.cachedCount ?? 0)
      await saveFailures(batch.results, batch.results.length)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIsRunning(false)
      setProgress(null)
    }
  }

  const handleAbort = async () => {
    await window.electronAPI.abortAmazonPriceCheck()
    setIsRunning(false)
    setProgress(null)
  }

  const handleLogin = () => { window.electronAPI.openAmazonLogin() }

  // Remove successfully fixed SKUs from persisted failures and re-save to disk
  const pruneFixedFromPersisted = async (successSkus: string[]) => {
    if (!persistedFailures || successSkus.length === 0) return
    const remaining = persistedFailures.filter(f => !successSkus.includes(f.sku))
    setPersistedFailures(remaining)
    if (persistedMeta) {
      const payload: PersistedFailures = {
        failures: remaining,
        savedAt: persistedMeta.savedAt,
        totalChecked: persistedMeta.totalChecked,
        source: persistedMeta.source,
      }
      try { await window.electronAPI.savePriceCheckFailures(accountId, payload) } catch { /* non-critical */ }
    }
  }

  const handleAutoFixSaved = async () => {
    const actionable = (persistedFailures ?? []).filter(f => f.failureReason !== 'error')
    if (actionable.length === 0) return
    setIsAutoFixing(true)
    setAutoFixProgress(null)
    try {
      const payload = actionable.map(f => ({
        sku: f.sku,
        sourcePrice: f.sourcePrice,
        failureReason: f.failureReason,
      }))
      const { results: batchResults } = await window.electronAPI.autoFixListings(accountId, payload, targetMultiplier)
      // Do a single disk save at the end with all successful SKUs pruned
      const fixedSkus = batchResults.filter(r => r.success).map(r => r.sku)
      await pruneFixedFromPersisted(fixedSkus)
    } catch (err) {
      console.error('Auto-fix saved failed:', err)
    } finally {
      setIsAutoFixing(false)
      setAutoFixProgress(null)
    }
  }

  const handleUpdatePrice = async (sku: string, sourcePrice: number | null) => {
    if (sourcePrice === null) return
    setFixingSkus((prev) => new Set(prev).add(sku))
    try {
      const result = await window.electronAPI.updateListingPrice(accountId, sku, sourcePrice, targetMultiplier)
      setFixResults((prev) => new Map(prev).set(sku, result))
      if (result.success) await pruneFixedFromPersisted([sku])
    } catch (err) {
      setFixResults((prev) => new Map(prev).set(sku, { success: false, sku, error: (err as Error).message }))
    } finally {
      setFixingSkus((prev) => { const s = new Set(prev); s.delete(sku); return s })
    }
  }

  const handleEndListing = async (sku: string) => {
    setFixingSkus((prev) => new Set(prev).add(sku))
    try {
      const result = await window.electronAPI.endListing(accountId, sku)
      setFixResults((prev) => new Map(prev).set(sku, result))
      if (result.success) await pruneFixedFromPersisted([sku])
    } catch (err) {
      setFixResults((prev) => new Map(prev).set(sku, { success: false, sku, error: (err as Error).message }))
    } finally {
      setFixingSkus((prev) => { const s = new Set(prev); s.delete(sku); return s })
    }
  }

  const handleAutoFix = async (failureList: AmazonPriceResult[]) => {
    setIsAutoFixing(true)
    setAutoFixProgress(null)
    try {
      const payload = failureList.map((r) => ({
        sku: r.sku,
        sourcePrice: r.sourcePrice,
        failureReason: !r.isAvailable && (r.multiplier === null || r.multiplier >= 2) ? 'unavailable' : 'price',
      }))
      const { results: batchResults } = await window.electronAPI.autoFixListings(accountId, payload, targetMultiplier)
      const fixedSkus = batchResults.filter(r => r.success).map(r => r.sku)
      await pruneFixedFromPersisted(fixedSkus)
    } catch (err) {
      console.error('Auto-fix failed:', err)
    } finally {
      setIsAutoFixing(false)
      setAutoFixProgress(null)
    }
  }

  const handleUpdatePriceForMarginFiltered = async (filteredList: AmazonPriceResult[]) => {
    const priceable = filteredList.filter(r => r.sourcePrice !== null)
    if (priceable.length === 0) return
    setIsAutoFixing(true)
    setAutoFixProgress(null)
    try {
      const payload = priceable.map(r => ({ sku: r.sku, sourcePrice: r.sourcePrice, failureReason: 'price' }))
      const { results: batchResults } = await window.electronAPI.autoFixListings(accountId, payload, targetMultiplier)
      const fixedSkus = batchResults.filter(r => r.success).map(r => r.sku)
      await pruneFixedFromPersisted(fixedSkus)
    } catch (err) {
      console.error('Margin update failed:', err)
    } finally {
      setIsAutoFixing(false)
      setAutoFixProgress(null)
    }
  }

  const failures = useMemo(
    () => results
      ? results.filter((r) =>
          r.method === 'error' || !r.isAvailable || (r.multiplier !== null && r.multiplier < 2)
        )
      : null,
    [results]
  )
  const needsAttention = failures?.length ?? 0
  const checked = results?.length ?? 0

  const failuresTotalPages = failures ? Math.ceil(failures.length / FAILURES_PAGE_SIZE) : 0
  const failuresPageData = useMemo(
    () => failures ? failures.slice(failuresPage * FAILURES_PAGE_SIZE, (failuresPage + 1) * FAILURES_PAGE_SIZE) : [],
    [failures, failuresPage]
  )

  const marginThresholdValue = parseFloat(marginFilterThreshold)
  const marginFiltered = failures && !isNaN(marginThresholdValue)
    ? failures.filter(r => r.multiplier !== null && r.multiplier < marginThresholdValue)
    : null

  const SOURCE_TABS: { key: SourceFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'amazon', label: 'Amazon' },
    { key: 'yami', label: 'Yami' },
    { key: 'costco', label: 'Costco' },
  ]

  return (
    <div className="mb-4 border border-gray-200 rounded-lg overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setIsExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          <DollarSign className="w-4 h-4 text-blue-600" />
          <span className="font-medium text-gray-900 text-sm">Price / Inventory Checker</span>
          {sourceCounts.all > 0 && (
            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
              {sourceCounts.all} active
            </span>
          )}
          {checked > 0 && needsAttention > 0 && (
            <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
              {needsAttention} need attention
            </span>
          )}
          {checked > 0 && needsAttention === 0 && (
            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
              All OK
            </span>
          )}
          {!results && persistedFailures && persistedFailures.length > 0 && (
            <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">
              {persistedFailures.length} saved failures
            </span>
          )}
        </div>
        {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
      </button>

      {/* Body */}
      {isExpanded && (
        <div className="p-4 bg-white">
          {/* Source filter tabs */}
          <div className="flex items-center gap-1 mb-4 border-b border-gray-200 pb-3">
            {SOURCE_TABS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setSourceFilter(key)}
                disabled={isRunning}
                className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors disabled:opacity-50 ${
                  sourceFilter === key
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {label}
                {sourceCounts[key] > 0 && (
                  <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-xs ${
                    sourceFilter === key ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-500'
                  }`}>
                    {sourceCounts[key]}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Controls */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <button
              onClick={handleLogin}
              disabled={isRunning}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
              title="Open Amazon login window"
            >
              <LogIn className="w-3.5 h-3.5" />
              Amazon Login
            </button>

            {!isRunning ? (
              <button
                onClick={handleRun}
                disabled={filteredCheckableListings.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Play className="w-3.5 h-3.5" />
                Check {filteredCheckableListings.length} {sourceFilter === 'all' ? '' : sourceFilter.charAt(0).toUpperCase() + sourceFilter.slice(1) + ' '}Listings
              </button>
            ) : (
              <button
                onClick={handleAbort}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                <Square className="w-3.5 h-3.5" />
                Cancel
              </button>
            )}

            <div className="flex items-center gap-1.5 ml-auto">
              <span className="text-xs text-gray-500">Target multiplier:</span>
              <select
                value={targetMultiplier}
                onChange={(e) => setTargetMultiplier(parseFloat(e.target.value))}
                disabled={isRunning}
                className="text-xs border border-gray-300 rounded px-1.5 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
              >
                {[1.5, 1.8, 1.9, 2.0, 2.1, 2.2, 2.3, 2.5, 3.0].map(v => (
                  <option key={v} value={v}>{v}×</option>
                ))}
              </select>
            </div>
          </div>

          {/* Cache notice */}
          {!isRunning && results && cachedCount > 0 && (
            <div className="mb-3 text-xs text-gray-400 flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-gray-300" />
              {cachedCount} item{cachedCount !== 1 ? 's' : ''} loaded from cache (scanned within 48 h) · {results.length - cachedCount} freshly checked
            </div>
          )}

          {/* Progress */}
          {isRunning && progress && (
            <div className="mb-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
              <div className="flex items-center gap-2 text-sm text-blue-800 mb-1">
                <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
                <span className="font-mono text-xs truncate">{progress.sku}</span>
                <span className="text-xs text-blue-600 flex-shrink-0">{progress.status}</span>
              </div>
              {progress.total > 0 && (
                <>
                  <div className="w-full bg-blue-200 rounded-full h-1.5">
                    <div
                      className="bg-blue-600 h-1.5 rounded-full transition-all duration-300"
                      style={{ width: `${(progress.current / progress.total) * 100}%` }}
                    />
                  </div>
                  <div className="text-xs text-blue-600 mt-1">{progress.current} / {progress.total} checked</div>
                </>
              )}
            </div>
          )}

          {/* Auto-fix progress */}
          {isAutoFixing && (
            <div className="mb-4 p-3 bg-orange-50 rounded-lg border border-orange-200">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2 text-sm text-orange-800">
                  <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
                  <span className="font-medium">Auto-fixing…</span>
                  {autoFixProgress && (
                    <span className="font-mono text-xs text-orange-600 truncate max-w-[180px]">{autoFixProgress.sku}</span>
                  )}
                </div>
                {autoFixProgress && (
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-green-700 font-medium">✓ {autoFixProgress.succeeded} fixed</span>
                    {autoFixProgress.failed > 0 && (
                      <span className="text-red-600 font-medium">✗ {autoFixProgress.failed} failed</span>
                    )}
                    <span className="text-orange-600">{autoFixProgress.current} / {autoFixProgress.total}</span>
                  </div>
                )}
              </div>
              {autoFixProgress && autoFixProgress.total > 0 && (
                <>
                  <div className="w-full bg-orange-200 rounded-full h-2">
                    <div
                      className="bg-orange-500 h-2 rounded-full transition-all duration-150"
                      style={{ width: `${(autoFixProgress.current / autoFixProgress.total) * 100}%` }}
                    />
                  </div>
                  <div className="text-xs text-orange-500 mt-1">
                    {Math.round((autoFixProgress.current / autoFixProgress.total) * 100)}% complete · {autoFixProgress.total - autoFixProgress.current} remaining
                  </div>
                </>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="mb-4 p-3 bg-red-50 rounded-lg border border-red-200 text-sm text-red-800 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Failures summary — from current run */}
          {results && failures && failures.length > 0 && (
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <AlertTriangle className="w-4 h-4 text-red-600" />
                <span className="text-sm font-medium text-red-700">
                  {failures.length} item{failures.length !== 1 ? 's' : ''} need attention
                </span>
                <span className="text-xs text-gray-400">· saved to disk</span>
                <button
                  onClick={() => handleAutoFix(failures)}
                  disabled={isAutoFixing || fixingSkus.size > 0}
                  className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isAutoFixing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                  Auto-fix all {failures.length} issues
                </button>
              </div>

              {/* Margin filter row */}
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className="text-xs text-gray-500">Filter low margin: multiplier &lt;</span>
                <input
                  type="number"
                  min="0"
                  max="10"
                  step="0.1"
                  placeholder="e.g. 1.8"
                  value={marginFilterThreshold}
                  onChange={e => setMarginFilterThreshold(e.target.value)}
                  className="w-20 text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
                {marginFiltered && (
                  <>
                    <span className="text-xs text-gray-500">{marginFiltered.length} item{marginFiltered.length !== 1 ? 's' : ''} match</span>
                    <button
                      onClick={() => handleUpdatePriceForMarginFiltered(marginFiltered)}
                      disabled={isAutoFixing || fixingSkus.size > 0 || marginFiltered.filter(r => r.sourcePrice !== null).length === 0}
                      className="flex items-center gap-1.5 px-3 py-1 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {isAutoFixing ? <Loader2 className="w-3 h-3 animate-spin" /> : <DollarSign className="w-3 h-3" />}
                      Update Price for {marginFiltered.filter(r => r.sourcePrice !== null).length} items
                    </button>
                  </>
                )}
              </div>

              <div className="border border-red-200 rounded-lg overflow-hidden">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-red-50 text-red-700 text-left">
                      <th className="px-3 py-2 font-medium">SKU</th>
                      <th className="px-3 py-2 font-medium">Src</th>
                      <th className="px-3 py-2 font-medium">Issue</th>
                      <th className="px-3 py-2 font-medium">eBay</th>
                      <th className="px-3 py-2 font-medium">Source</th>
                      <th className="px-3 py-2 font-medium">Mult.</th>
                      <th className="px-3 py-2 font-medium">Links</th>
                      <th className="px-3 py-2 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {failuresPageData.map((r) => {
                      const lid = skuToListingId.get(r.sku) || r.ebayListingId
                      const badPrice = r.multiplier !== null && r.multiplier < 2
                      const unavail = !r.isAvailable && r.method !== 'not_checkable'
                      const isError = r.method === 'error'
                      const fixing = fixingSkus.has(r.sku)
                      const fixResult = fixResults.get(r.sku)
                      return (
                        <tr key={r.sku} className="border-t border-red-100">
                          <td className="px-3 py-2">
                            <code className="font-mono bg-gray-100 px-1 rounded">{r.sku}</code>
                          </td>
                          <td className="px-3 py-2">
                            <span className={`px-1.5 py-0.5 rounded font-medium ${sourceColor(r.listingSource)}`}>
                              {r.listingSource}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            {isError ? (
                              <span className="text-gray-500">error</span>
                            ) : (
                              <div className="flex flex-col gap-0.5">
                                {badPrice && <span className="text-red-600 font-medium">low margin</span>}
                                {unavail && <span className="text-orange-600 font-medium">out of stock</span>}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2 font-medium">{formatCurrency(r.ebayPrice)}</td>
                          <td className="px-3 py-2">
                            {r.sourcePrice !== null ? (
                              <span>
                                {formatCurrency(r.sourcePrice)}
                                {badPrice && r.sourcePrice && (
                                  <span className="block text-green-700">→ {formatCurrency(Math.floor(r.sourcePrice * 2.1) + 0.99)}</span>
                                )}
                              </span>
                            ) : '—'}
                          </td>
                          <td className="px-3 py-2">
                            <MultiplierBadge multiplier={r.multiplier} />
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex gap-1">
                              {r.sourceUrl && (
                                <button onClick={() => window.electronAPI.openExternalUrl(r.sourceUrl!)} className="p-1 hover:bg-gray-100 rounded" title="Source">
                                  <ExternalLink className="w-3 h-3 text-gray-500" />
                                </button>
                              )}
                              {lid && (
                                <button onClick={() => window.electronAPI.openExternalUrl(`https://www.ebay.com/itm/${lid}`)} className="p-1 hover:bg-gray-100 rounded" title="eBay listing">
                                  <ExternalLink className="w-3 h-3 text-blue-500" />
                                </button>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2 min-w-[180px]">
                            {fixResult ? (
                              <div className="flex flex-col gap-1">
                                {fixResult.success ? (
                                  <span className="text-green-600 flex items-center gap-1 text-xs font-medium">
                                    <CheckCircle className="w-3 h-3" />
                                    {fixResult.newPrice ? `Repriced → ${formatCurrency(fixResult.newPrice)}` : 'Listing ended'}
                                  </span>
                                ) : (
                                  <span className="text-red-500 text-xs" title={fixResult.error}>
                                    {fixResult.error?.slice(0, 50)}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <div className="flex gap-1 flex-wrap">
                                <button
                                  onClick={() => handleUpdatePrice(r.sku, r.sourcePrice)}
                                  disabled={fixing || isAutoFixing || r.sourcePrice === null}
                                  className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                  title={r.sourcePrice !== null ? `Reprice to ${formatCurrency(Math.floor(r.sourcePrice * 2.1) + 0.99)} (2.1×)` : 'No source price available'}
                                >
                                  {fixing ? <Loader2 className="w-3 h-3 animate-spin" /> : <DollarSign className="w-3 h-3" />}
                                  Update Price
                                </button>
                                <button
                                  onClick={() => handleEndListing(r.sku)}
                                  disabled={fixing || isAutoFixing}
                                  className="flex items-center gap-1 px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200 disabled:opacity-50 transition-colors"
                                  title="End this eBay listing"
                                >
                                  {fixing ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
                                  End Listing
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {failuresTotalPages > 1 && (
                <div className="flex items-center justify-between mt-2">
                  <button
                    onClick={() => setFailuresPage(p => Math.max(0, p - 1))}
                    disabled={failuresPage === 0}
                    className="px-3 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    ← Prev
                  </button>
                  <span className="text-xs text-gray-400">
                    page {failuresPage + 1} / {failuresTotalPages}
                  </span>
                  <button
                    onClick={() => setFailuresPage(p => Math.min(failuresTotalPages - 1, p + 1))}
                    disabled={failuresPage >= failuresTotalPages - 1}
                    className="px-3 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Next →
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Persisted failures — historical scan results */}
          {!results && persistedFailures && persistedFailures.length > 0 && (
            <div className="mb-4">
              {/* Header row: toggle + meta + auto-fix button */}
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <button
                  onClick={() => setShowFailures((v) => !v)}
                  className="flex items-center gap-1.5 text-sm font-medium text-yellow-700 hover:text-yellow-800 transition-colors"
                >
                  {showFailures ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  <AlertTriangle className="w-4 h-4" />
                  Last scan: {persistedFailures.length} failure{persistedFailures.length !== 1 ? 's' : ''}
                </button>
                {persistedMeta && (
                  <span className="text-xs text-gray-400">
                    · {persistedMeta.source !== 'all' ? persistedMeta.source + ' · ' : ''}{persistedMeta.totalChecked} checked · {new Date(persistedMeta.savedAt).toLocaleDateString()}
                  </span>
                )}
                {showFailures && (
                  <button
                    onClick={handleAutoFixSaved}
                    disabled={isAutoFixing || fixingSkus.size > 0}
                    className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {isAutoFixing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                    Auto-fix all {persistedFailures.filter(f => f.failureReason !== 'error').length} actionable
                  </button>
                )}
              </div>

              {showFailures && (
                <>
                  {/* Filter tabs */}
                  <div className="flex items-center gap-1 mb-2 flex-wrap">
                    {([
                      { key: 'all',   label: 'All',          count: savedCounts.all },
                      { key: 'oos',   label: 'Out of Stock', count: savedCounts.oos },
                      { key: 'price', label: 'Low Margin',   count: savedCounts.price },
                      { key: 'error', label: 'Error',        count: savedCounts.error },
                    ] as const).map(tab => (
                      <button
                        key={tab.key}
                        onClick={() => handleSavedFilterChange(tab.key)}
                        className={`flex items-center gap-1 px-2.5 py-1 text-xs rounded-full border transition-colors ${
                          savedFilter === tab.key
                            ? 'bg-yellow-600 text-white border-yellow-600'
                            : 'bg-white text-gray-600 border-gray-300 hover:border-yellow-400'
                        }`}
                      >
                        {tab.label}
                        <span className={`px-1 py-0.5 rounded text-[10px] font-medium ${savedFilter === tab.key ? 'bg-yellow-500 text-white' : 'bg-gray-100 text-gray-500'}`}>
                          {tab.count}
                        </span>
                      </button>
                    ))}
                    <span className="ml-auto text-xs text-gray-400">
                      {savedFilteredSorted.length} shown · page {savedPage + 1}/{Math.max(1, savedTotalPages)}
                    </span>
                  </div>

                <div className="border border-yellow-200 rounded-lg overflow-hidden">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-yellow-50 text-yellow-800 text-left">
                        <th className="px-3 py-2 font-medium">SKU</th>
                        <th className="px-3 py-2 font-medium">Src</th>
                        <th className="px-3 py-2 font-medium">Issue</th>
                        <th className="px-3 py-2 font-medium">eBay</th>
                        <th className="px-3 py-2 font-medium">Source</th>
                        <th className="px-3 py-2 font-medium">Mult.</th>
                        <th className="px-3 py-2 font-medium">Links</th>
                        <th className="px-3 py-2 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {savedPageData.map((f) => {
                        const fixing = fixingSkus.has(f.sku)
                        const fixResult = fixResults.get(f.sku)
                        return (
                          <tr key={f.sku} className="border-t border-yellow-100">
                            <td className="px-3 py-2">
                              <code className="font-mono bg-gray-100 px-1 rounded">{f.sku}</code>
                              {f.ebayTitle && (
                                <span className="block text-gray-400 truncate max-w-[150px]" title={f.ebayTitle}>
                                  {f.ebayTitle.slice(0, 40)}…
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <span className={`px-1.5 py-0.5 rounded font-medium ${sourceColor(f.listingSource)}`}>
                                {f.listingSource}
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              <span className={`font-medium ${
                                f.failureReason === 'error' ? 'text-gray-500' :
                                f.failureReason === 'unavailable' ? 'text-orange-600' : 'text-red-600'
                              }`}>
                                {f.failureReason === 'both' ? 'low margin + OOS' :
                                 f.failureReason === 'price' ? 'low margin' :
                                 f.failureReason === 'unavailable' ? 'out of stock' : 'error'}
                              </span>
                            </td>
                            <td className="px-3 py-2 font-medium">{formatCurrency(f.ebayPrice)}</td>
                            <td className="px-3 py-2">
                              {f.sourcePrice !== null ? (
                                <span>
                                  {formatCurrency(f.sourcePrice)}
                                  {(f.failureReason === 'price' || f.failureReason === 'both') && f.sourcePrice && (
                                    <span className="block text-green-700">→ {formatCurrency(Math.floor(f.sourcePrice * 2.1) + 0.99)}</span>
                                  )}
                                </span>
                              ) : '—'}
                            </td>
                            <td className="px-3 py-2">
                              <MultiplierBadge multiplier={f.multiplier} />
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex gap-1">
                                {f.sourceUrl && (
                                  <button onClick={() => window.electronAPI.openExternalUrl(f.sourceUrl!)} className="p-1 hover:bg-gray-100 rounded" title="Source">
                                    <ExternalLink className="w-3 h-3 text-gray-500" />
                                  </button>
                                )}
                                {f.ebayListingId && (
                                  <button onClick={() => window.electronAPI.openExternalUrl(`https://www.ebay.com/itm/${f.ebayListingId}`)} className="p-1 hover:bg-gray-100 rounded" title="eBay listing">
                                    <ExternalLink className="w-3 h-3 text-blue-500" />
                                  </button>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2 min-w-[180px]">
                              {fixResult ? (
                                fixResult.success ? (
                                  <span className="text-green-600 flex items-center gap-1 font-medium">
                                    <CheckCircle className="w-3 h-3" />
                                    {fixResult.newPrice ? `→ ${formatCurrency(fixResult.newPrice)}` : 'Ended'}
                                  </span>
                                ) : (
                                  <span className="text-red-500 truncate block max-w-[160px]" title={fixResult.error}>
                                    {fixResult.error?.slice(0, 50)}
                                  </span>
                                )
                              ) : (
                                <div className="flex gap-1 flex-wrap">
                                  <button
                                    onClick={() => handleUpdatePrice(f.sku, f.sourcePrice)}
                                    disabled={fixing || isAutoFixing || f.sourcePrice === null}
                                    className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                    title={f.sourcePrice !== null ? `Reprice to ${formatCurrency(Math.floor(f.sourcePrice * 2.1) + 0.99)}` : 'No source price'}
                                  >
                                    {fixing ? <Loader2 className="w-3 h-3 animate-spin" /> : <DollarSign className="w-3 h-3" />}
                                    Update Price
                                  </button>
                                  <button
                                    onClick={() => handleEndListing(f.sku)}
                                    disabled={fixing || isAutoFixing}
                                    className="flex items-center gap-1 px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200 disabled:opacity-50 transition-colors"
                                    title="End this eBay listing"
                                  >
                                    {fixing ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
                                    End Listing
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                  {/* Pagination */}
                  {savedTotalPages > 1 && (
                    <div className="flex items-center justify-between mt-2">
                      <button
                        onClick={() => setSavedPage(p => Math.max(0, p - 1))}
                        disabled={savedPage === 0}
                        className="px-3 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        ← Prev
                      </button>
                      <div className="flex items-center gap-1">
                        {Array.from({ length: Math.min(7, savedTotalPages) }, (_, i) => {
                          const page = savedTotalPages <= 7 ? i
                            : savedPage < 4 ? i
                            : savedPage > savedTotalPages - 5 ? savedTotalPages - 7 + i
                            : savedPage - 3 + i
                          return (
                            <button
                              key={page}
                              onClick={() => setSavedPage(page)}
                              className={`w-6 h-6 text-xs rounded ${page === savedPage ? 'bg-yellow-600 text-white' : 'hover:bg-gray-100 text-gray-600'}`}
                            >
                              {page + 1}
                            </button>
                          )
                        })}
                      </div>
                      <button
                        onClick={() => setSavedPage(p => Math.min(savedTotalPages - 1, p + 1))}
                        disabled={savedPage >= savedTotalPages - 1}
                        className="px-3 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Next →
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Full results table */}
          {results && results.length > 0 && (
            <div>
              <div className="text-xs text-gray-500 mb-2 flex gap-3 flex-wrap">
                <span>{checked} checked</span>
                <span>·</span>
                <span className={needsAttention > 0 ? 'text-red-600 font-medium' : 'text-green-600'}>
                  {needsAttention} need attention
                </span>
                <span>·</span>
                <span>{results.filter(r => r.listingSource === 'amazon').length} Amazon</span>
                <span>{results.filter(r => r.listingSource === 'yami').length} Yami</span>
                <span>{results.filter(r => r.listingSource === 'costco').length} Costco</span>
                {resultsTotalPages > 1 && (
                  <span className="ml-auto">page {resultsPage + 1} / {resultsTotalPages}</span>
                )}
              </div>
              <ResultsTable rows={resultsPageData} skuToListingId={skuToListingId} skuToTitle={skuToTitle} />
              {resultsTotalPages > 1 && (
                <div className="flex items-center justify-between mt-2">
                  <button
                    onClick={() => setResultsPage(p => Math.max(0, p - 1))}
                    disabled={resultsPage === 0}
                    className="px-3 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    ← Prev
                  </button>
                  <div className="flex items-center gap-1">
                    {Array.from({ length: Math.min(7, resultsTotalPages) }, (_, i) => {
                      const page = resultsTotalPages <= 7 ? i
                        : resultsPage < 4 ? i
                        : resultsPage > resultsTotalPages - 5 ? resultsTotalPages - 7 + i
                        : resultsPage - 3 + i
                      return (
                        <button
                          key={page}
                          onClick={() => setResultsPage(page)}
                          className={`w-6 h-6 text-xs rounded ${page === resultsPage ? 'bg-blue-600 text-white' : 'hover:bg-gray-100 text-gray-600'}`}
                        >
                          {page + 1}
                        </button>
                      )
                    })}
                  </div>
                  <button
                    onClick={() => setResultsPage(p => Math.min(resultsTotalPages - 1, p + 1))}
                    disabled={resultsPage >= resultsTotalPages - 1}
                    className="px-3 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Next →
                  </button>
                </div>
              )}
            </div>
          )}

          {results && results.length === 0 && (
            <div className="text-center py-6 text-gray-500 text-sm">
              No checkable listings found for selected source.
            </div>
          )}

          {!results && !isRunning && filteredCheckableListings.length === 0 && !persistedFailures && (
            <div className="text-center py-6 text-gray-500 text-sm">
              No active listings found for this source. Load listings first.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Single listing card component
function ListingCard({
  listing,
  style,
}: {
  listing: EbayListing
  style?: React.CSSProperties
}) {
  return (
    <div style={style} className="px-1 py-1.5">
      <div className="bg-white rounded-lg border border-gray-200 p-4 hover:border-gray-300 transition-colors">
        <div className="flex gap-4">
          {/* Thumbnail */}
          <div className="w-16 h-16 sm:w-20 sm:h-20 bg-gray-100 rounded-lg overflow-hidden flex-shrink-0">
            {listing.imageUrl ? (
              <img
                src={listing.imageUrl}
                alt=""
                className="w-full h-full object-cover"
                loading="lazy"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-gray-400">
                <Package className="w-8 h-8" />
              </div>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <h3 className="font-medium text-gray-900 text-sm sm:text-base line-clamp-2">
                  {listing.title}
                </h3>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs sm:text-sm text-gray-500">
                  <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs font-mono">
                    {listing.sku}
                  </code>
                  <span className="font-semibold text-gray-900">
                    {formatCurrency(listing.price.value, listing.price.currency)}
                  </span>
                  <span>Qty: {listing.quantity}</span>
                </div>
              </div>
              <StatusBadge status={listing.status} />
            </div>

            {/* Metrics */}
            <div className="mt-3 flex flex-wrap items-center gap-3 sm:gap-4">
              <MetricBadge
                icon={<Eye className="w-3.5 h-3.5" />}
                value={listing.views30Days}
                label="views"
                warning={listing.views30Days === 0 && listing.status === 'ACTIVE'}
              />
              <MetricBadge
                icon={<Heart className="w-3.5 h-3.5" />}
                value={listing.watcherCount}
                label="watchers"
              />
              <MetricBadge
                icon={<ShoppingCart className="w-3.5 h-3.5" />}
                value={listing.soldQuantity}
                label="sold"
              />
              {listing.questionCount > 0 && (
                <MetricBadge
                  icon={<HelpCircle className="w-3.5 h-3.5" />}
                  value={listing.questionCount}
                  label="questions"
                />
              )}
            </div>

            {/* End Date / Time Left */}
            {listing.status === 'ACTIVE' && listing.listingEndDate && (
              <div className="mt-2 flex items-center gap-2 text-xs">
                <Clock className={`w-3.5 h-3.5 ${listing.daysRemaining !== null && listing.daysRemaining <= 3 ? 'text-red-500' : listing.daysRemaining !== null && listing.daysRemaining <= 7 ? 'text-orange-500' : 'text-gray-400'}`} />
                {listing.daysRemaining !== null ? (
                  <span className={`font-medium ${listing.daysRemaining <= 3 ? 'text-red-600' : listing.daysRemaining <= 7 ? 'text-orange-600' : 'text-gray-600'}`}>
                    {listing.daysRemaining} days left
                  </span>
                ) : null}
                <span className="text-gray-400">•</span>
                <span className="text-gray-500">
                  Ends {formatDate(listing.listingEndDate)}
                </span>
              </div>
            )}
            {listing.status === 'ENDED' && listing.listingEndDate && (
              <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
                <Clock className="w-3.5 h-3.5 text-gray-400" />
                <span>Ended {formatDate(listing.listingEndDate)}</span>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex-shrink-0 flex flex-col items-end gap-2">
            <button
              onClick={() => window.electronAPI.openExternalUrl(`https://www.ebay.com/itm/${listing.listingId}`)}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              title="View on eBay"
            >
              <ExternalLink className="w-4 h-4 text-blue-500" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Sort options
type SortField = 'views' | 'watchers' | 'price' | 'quantity' | 'sold' | 'date' | 'endDate'
type SortOrder = 'asc' | 'desc'

export function ListingsView() {
  const queryClient = useQueryClient()
  const parentRef = useRef<HTMLDivElement>(null)

  // Local state
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [sortBy, setSortBy] = useState<SortField>('views')
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')
  const [progress, setProgress] = useState<ListingProgress | null>(null)

  // Fetch stored listings on mount
  const {
    data: listingsData,
    isLoading: listingsLoading,
    error: listingsError,
  } = useQuery<ListingDataExport | null>({
    queryKey: ['listings'],
    queryFn: () => window.electronAPI.getStoredListings(),
    staleTime: 60000, // 1 minute
  })

  // Fetch fresh listings mutation
  const fetchMutation = useMutation<FetchListingsResult>({
    mutationFn: () => window.electronAPI.fetchListings(),
    onSuccess: (result) => {
      if (result.success) {
        queryClient.invalidateQueries({ queryKey: ['listings'] })
      }
      setProgress(null)
    },
    onError: () => {
      setProgress(null)
    },
  })

  // Listen for progress updates
  useEffect(() => {
    const cleanup = window.electronAPI.onListingsProgress((data) => {
      setProgress(data)
    })
    return cleanup
  }, [])

  // Filter and sort listings
  const filteredListings = useMemo(() => {
    if (!listingsData?.listings) return []

    return listingsData.listings
      .filter((listing) => {
        // Status filter
        if (statusFilter !== 'all' && listing.status !== statusFilter) {
          return false
        }

        // Search filter
        if (searchQuery) {
          const query = searchQuery.toLowerCase()
          return (
            listing.title.toLowerCase().includes(query) ||
            listing.sku.toLowerCase().includes(query) ||
            listing.listingId.includes(query)
          )
        }

        return true
      })
      .sort((a, b) => {
        let comparison = 0
        switch (sortBy) {
          case 'views':
            comparison = a.views30Days - b.views30Days
            break
          case 'watchers':
            comparison = a.watcherCount - b.watcherCount
            break
          case 'price':
            comparison = parseFloat(a.price.value) - parseFloat(b.price.value)
            break
          case 'quantity':
            comparison = a.quantity - b.quantity
            break
          case 'sold':
            comparison = a.soldQuantity - b.soldQuantity
            break
          case 'date':
            comparison = new Date(a.listingStartDate).getTime() - new Date(b.listingStartDate).getTime()
            break
          case 'endDate':
            // Sort by days remaining (null values go to the end)
            const aEnd = a.daysRemaining ?? 9999
            const bEnd = b.daysRemaining ?? 9999
            comparison = aEnd - bEnd
            break
        }
        return sortOrder === 'desc' ? -comparison : comparison
      })
  }, [listingsData, searchQuery, statusFilter, sortBy, sortOrder])

  // Virtual scrolling setup
  const virtualizer = useVirtualizer({
    count: filteredListings.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 140, // Estimated row height
    overscan: 5,
  })

  // Calculate summary stats
  const stats = useMemo(() => {
    const listings = listingsData?.listings || []
    const activeListings = listings.filter((l) => l.status === 'ACTIVE')
    const endedListings = listings.filter((l) => l.status === 'ENDED')
    const totalValue = listings.reduce(
      (sum, l) => sum + parseFloat(l.price.value) * l.quantity,
      0
    )
    const totalViews = listings.reduce((sum, l) => sum + l.views30Days, 0)
    const totalWatchers = listings.reduce((sum, l) => sum + l.watcherCount, 0)
    const zeroViews = activeListings.filter((l) => l.views30Days === 0).length
    const outOfStock = listings.filter((l) => l.status === 'OUT_OF_STOCK').length

    return {
      total: listings.length,
      active: activeListings.length,
      ended: endedListings.length,
      totalValue,
      totalViews,
      totalWatchers,
      zeroViews,
      outOfStock,
    }
  }, [listingsData])

  const handleRefresh = () => {
    fetchMutation.mutate()
  }

  // Status counts for filter dropdown
  const statusCounts = useMemo(() => {
    const listings = listingsData?.listings || []
    return {
      all: listings.length,
      ACTIVE: listings.filter((l) => l.status === 'ACTIVE').length,
      INACTIVE: listings.filter((l) => l.status === 'INACTIVE').length,
      OUT_OF_STOCK: listings.filter((l) => l.status === 'OUT_OF_STOCK').length,
      ENDED: listings.filter((l) => l.status === 'ENDED').length,
    }
  }, [listingsData])

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 p-6 pb-0">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Listings</h1>
            {listingsData && (
              <p className="text-sm text-gray-500 mt-1">
                Last updated: {formatRelativeTime(listingsData.exportedAt)}
              </p>
            )}
          </div>
          <button
            onClick={handleRefresh}
            disabled={fetchMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {fetchMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Fetching...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4" />
                Refresh Listings
              </>
            )}
          </button>
        </div>

        {/* Progress indicator */}
        {progress && (
          <div className="mb-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
            <div className="flex items-center gap-2 text-sm text-blue-800">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="font-medium">{progress.stage}:</span>
              <span>{progress.message}</span>
            </div>
            {progress.total > 0 && (
              <div className="mt-2 w-full bg-blue-200 rounded-full h-1.5">
                <div
                  className="bg-blue-600 h-1.5 rounded-full transition-all duration-300"
                  style={{ width: `${(progress.current / progress.total) * 100}%` }}
                />
              </div>
            )}
          </div>
        )}

        {/* Error display */}
        {fetchMutation.error && (
          <div className="mb-4 p-3 bg-red-50 rounded-lg border border-red-200">
            <div className="flex items-center gap-2 text-sm text-red-800">
              <AlertCircle className="w-4 h-4" />
              <span>Error: {(fetchMutation.error as Error).message}</span>
            </div>
          </div>
        )}

        {/* Summary Stats */}
        {listingsData && (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
            <div className="bg-white rounded-lg border border-gray-200 p-3">
              <div className="text-xl font-bold text-gray-900">{stats.total}</div>
              <div className="text-xs text-gray-500">Total Listings</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-3">
              <div className="text-xl font-bold text-green-600">{stats.active}</div>
              <div className="text-xs text-gray-500">Active</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-3">
              <div className="text-xl font-bold text-gray-500">{stats.ended}</div>
              <div className="text-xs text-gray-500">Ended</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-3">
              <div className="text-xl font-bold text-blue-600">{formatCurrency(stats.totalValue)}</div>
              <div className="text-xs text-gray-500">Inventory Value</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-3">
              <div className="text-xl font-bold text-purple-600">{stats.totalViews}</div>
              <div className="text-xs text-gray-500">Total Views</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-3">
              <div className="text-xl font-bold text-pink-600">{stats.totalWatchers}</div>
              <div className="text-xs text-gray-500">Total Watchers</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-3">
              <div className={`text-xl font-bold ${stats.zeroViews > 0 ? 'text-red-600' : 'text-gray-600'}`}>
                {stats.zeroViews}
              </div>
              <div className="text-xs text-gray-500">No Views</div>
            </div>
          </div>
        )}

        {/* Price / Inventory Checker */}
        <PriceCheckerPanel listings={listingsData?.listings ?? []} accountId={listingsData?.accountId ?? ''} />

        {/* Search and Filters */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-4">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by title, SKU, or listing ID..."
              className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-gray-400" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All ({statusCounts.all})</option>
              <option value="ACTIVE">Active ({statusCounts.ACTIVE})</option>
              <option value="OUT_OF_STOCK">Out of Stock ({statusCounts.OUT_OF_STOCK})</option>
              <option value="INACTIVE">Inactive ({statusCounts.INACTIVE})</option>
              <option value="ENDED">Ended ({statusCounts.ENDED})</option>
            </select>
          </div>

          {/* Sort */}
          <div className="flex items-center gap-2">
            <ArrowUpDown className="w-4 h-4 text-gray-400" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortField)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="views">Views</option>
              <option value="watchers">Watchers</option>
              <option value="sold">Sold</option>
              <option value="price">Price</option>
              <option value="quantity">Quantity</option>
              <option value="date">Date Listed</option>
              <option value="endDate">Time Left</option>
            </select>
            <button
              onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
              className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              title={sortOrder === 'asc' ? 'Ascending' : 'Descending'}
            >
              <TrendingUp
                className={`w-4 h-4 text-gray-600 transition-transform ${sortOrder === 'asc' ? '' : 'rotate-180'}`}
              />
            </button>
          </div>
        </div>

        {/* Results count */}
        <div className="text-sm text-gray-500 mb-2">
          Showing {filteredListings.length} of {listingsData?.listings?.length || 0} listings
        </div>
      </div>

      {/* Listings List with Virtual Scrolling */}
      <div ref={parentRef} className="flex-1 overflow-auto px-6 pb-6">
        {listingsLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          </div>
        ) : listingsError ? (
          <div className="text-center py-12">
            <AlertCircle className="w-16 h-16 text-red-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-600">Error Loading Listings</h3>
            <p className="text-sm text-gray-500 mt-1">
              {(listingsError as Error).message}
            </p>
          </div>
        ) : !listingsData || listingsData.listings.length === 0 ? (
          <div className="text-center py-12">
            <Package className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-600">No Listings Found</h3>
            <p className="text-sm text-gray-500 mt-1">
              Click "Refresh Listings" to fetch your active listings from eBay.
            </p>
          </div>
        ) : filteredListings.length === 0 ? (
          <div className="text-center py-12">
            <Search className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-600">No Matching Listings</h3>
            <p className="text-sm text-gray-500 mt-1">
              Try adjusting your search or filter criteria.
            </p>
          </div>
        ) : (
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {virtualizer.getVirtualItems().map((virtualItem) => (
              <ListingCard
                key={filteredListings[virtualItem.index].listingId}
                listing={filteredListings[virtualItem.index]}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${virtualItem.size}px`,
                  transform: `translateY(${virtualItem.start}px)`,
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
