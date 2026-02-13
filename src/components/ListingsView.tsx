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
