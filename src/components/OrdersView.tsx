import { useState } from 'react'
import {
  Package,
  MapPin,
  Phone,
  Mail,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Copy,
  Check,
  Clock,
  User,
} from 'lucide-react'

interface ShippingAddress {
  name: string
  addressLine1: string
  addressLine2: string
  city: string
  stateOrProvince: string
  postalCode: string
  countryCode: string
  phoneNumber: string
  email: string
}

interface OrderLineItem {
  lineItemId: string
  sku: string
  asin: string
  title: string
  quantity: number
  price: number
  currency: string
}

interface EbayOrder {
  ebayOrderId: string
  ebayOrderDate: string
  ebayOrderStatus: string
  totalPaidByBuyer: {
    amount: string
    currency: string
  }
  shippingAddress: ShippingAddress
  items: OrderLineItem[]
  orderNote: string
  processedAt: string
}

interface OrdersViewProps {
  orders: EbayOrder[]
  accountName: string
  exportPath?: string
}

function formatDate(dateString: string): string {
  try {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return dateString
  }
}

function formatCurrency(amount: string | number, currency: string = 'USD'): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(num)
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={handleCopy}
      className="p-1 hover:bg-gray-100 rounded transition-colors"
      title={`Copy ${label}`}
    >
      {copied ? (
        <Check className="w-3.5 h-3.5 text-green-500" />
      ) : (
        <Copy className="w-3.5 h-3.5 text-gray-400" />
      )}
    </button>
  )
}

function OrderCard({ order, isExpanded, onToggle }: { order: EbayOrder; isExpanded: boolean; onToggle: () => void }) {
  const address = order.shippingAddress
  const fullAddress = [
    address.addressLine1,
    address.addressLine2,
    `${address.city}, ${address.stateOrProvince} ${address.postalCode}`,
    address.countryCode,
  ]
    .filter(Boolean)
    .join('\n')

  const statusColor =
    order.ebayOrderStatus === 'NOT_STARTED'
      ? 'bg-yellow-100 text-yellow-800'
      : order.ebayOrderStatus === 'IN_PROGRESS'
        ? 'bg-blue-100 text-blue-800'
        : 'bg-gray-100 text-gray-800'

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      {/* Order Header - Always visible */}
      <div
        className="p-4 cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={onToggle}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-gray-900">{order.ebayOrderId}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${statusColor}`}>
                  {order.ebayOrderStatus.replace('_', ' ')}
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-500 mt-1">
                <Clock className="w-3.5 h-3.5" />
                {formatDate(order.ebayOrderDate)}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="font-semibold text-green-600">
                {formatCurrency(order.totalPaidByBuyer.amount, order.totalPaidByBuyer.currency)}
              </div>
              <div className="text-sm text-gray-500">
                {order.items.length} item{order.items.length !== 1 ? 's' : ''}
              </div>
            </div>
            {isExpanded ? (
              <ChevronUp className="w-5 h-5 text-gray-400" />
            ) : (
              <ChevronDown className="w-5 h-5 text-gray-400" />
            )}
          </div>
        </div>

        {/* Quick preview of items */}
        {!isExpanded && (
          <div className="mt-3 text-sm text-gray-600 truncate">
            {order.items.map((item) => item.title).join(', ')}
          </div>
        )}
      </div>

      {/* Expanded Details */}
      {isExpanded && (
        <div className="border-t border-gray-100">
          {/* Shipping Address */}
          <div className="p-4 bg-gray-50">
            <div className="flex items-start justify-between">
              <div>
                <h4 className="text-sm font-medium text-gray-700 flex items-center gap-2 mb-2">
                  <MapPin className="w-4 h-4" />
                  Shipping Address
                </h4>
                <div className="text-sm text-gray-600 space-y-1">
                  <div className="flex items-center gap-2">
                    <User className="w-3.5 h-3.5 text-gray-400" />
                    <span className="font-medium">{address.name}</span>
                    <CopyButton text={address.name} label="name" />
                  </div>
                  <div className="ml-5 whitespace-pre-line">{fullAddress}</div>
                  {address.phoneNumber && (
                    <div className="flex items-center gap-2 mt-2">
                      <Phone className="w-3.5 h-3.5 text-gray-400" />
                      <span>{address.phoneNumber}</span>
                      <CopyButton text={address.phoneNumber} label="phone" />
                    </div>
                  )}
                  {address.email && (
                    <div className="flex items-center gap-2">
                      <Mail className="w-3.5 h-3.5 text-gray-400" />
                      <span className="text-blue-600">{address.email}</span>
                      <CopyButton text={address.email} label="email" />
                    </div>
                  )}
                </div>
              </div>
              <CopyButton text={fullAddress.replace(/\n/g, ', ')} label="full address" />
            </div>
          </div>

          {/* Line Items */}
          <div className="p-4">
            <h4 className="text-sm font-medium text-gray-700 flex items-center gap-2 mb-3">
              <Package className="w-4 h-4" />
              Order Items
            </h4>
            <div className="space-y-3">
              {order.items.map((item) => (
                <div
                  key={item.lineItemId}
                  className="flex items-start justify-between p-3 bg-gray-50 rounded-lg"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate pr-4">
                      {item.title}
                    </div>
                    <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
                      <span className="flex items-center gap-1">
                        SKU: <code className="bg-gray-200 px-1 rounded">{item.sku}</code>
                        <CopyButton text={item.sku} label="SKU" />
                      </span>
                      <span>Qty: {item.quantity}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-sm font-semibold text-gray-900">
                      {formatCurrency(item.price, item.currency)}
                    </div>
                    <a
                      href={`https://www.amazon.com/dp/${item.asin}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1 hover:bg-gray-200 rounded transition-colors"
                      title="View on Amazon"
                    >
                      <ExternalLink className="w-4 h-4 text-blue-500" />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Order Actions */}
          <div className="p-4 border-t border-gray-100 bg-gray-50">
            <div className="flex items-center justify-between">
              <a
                href={`https://www.ebay.com/sh/ord/details?orderid=${order.ebayOrderId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
              >
                View on eBay
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
              <span className="text-xs text-gray-400">
                Fetched: {formatDate(order.processedAt)}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export function OrdersView({ orders, exportPath }: OrdersViewProps) {
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set())
  const [filterStatus, setFilterStatus] = useState<string>('all')

  const toggleOrder = (orderId: string) => {
    setExpandedOrders((prev) => {
      const next = new Set(prev)
      if (next.has(orderId)) {
        next.delete(orderId)
      } else {
        next.add(orderId)
      }
      return next
    })
  }

  const expandAll = () => {
    setExpandedOrders(new Set(orders.map((o) => o.ebayOrderId)))
  }

  const collapseAll = () => {
    setExpandedOrders(new Set())
  }

  const filteredOrders = orders.filter((order) => {
    if (filterStatus === 'all') return true
    return order.ebayOrderStatus === filterStatus
  })

  const totalValue = orders.reduce(
    (sum, order) => sum + parseFloat(order.totalPaidByBuyer.amount),
    0
  )

  const notStartedCount = orders.filter((o) => o.ebayOrderStatus === 'NOT_STARTED').length
  const inProgressCount = orders.filter((o) => o.ebayOrderStatus === 'IN_PROGRESS').length

  if (orders.length === 0) {
    return (
      <div className="text-center py-12">
        <Package className="w-16 h-16 text-gray-300 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-gray-600">No Unshipped Orders</h3>
        <p className="text-sm text-gray-500 mt-1">
          All orders have been shipped or there are no pending orders.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Summary Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-2xl font-bold text-gray-900">{orders.length}</div>
          <div className="text-sm text-gray-500">Total Orders</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-2xl font-bold text-green-600">{formatCurrency(totalValue)}</div>
          <div className="text-sm text-gray-500">Total Value</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-2xl font-bold text-yellow-600">{notStartedCount}</div>
          <div className="text-sm text-gray-500">Not Started</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-2xl font-bold text-blue-600">{inProgressCount}</div>
          <div className="text-sm text-gray-500">In Progress</div>
        </div>
      </div>

      {/* Filter and Actions Bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">Filter:</span>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Orders ({orders.length})</option>
            <option value="NOT_STARTED">Not Started ({notStartedCount})</option>
            <option value="IN_PROGRESS">In Progress ({inProgressCount})</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={expandAll}
            className="text-sm text-blue-600 hover:text-blue-800"
          >
            Expand All
          </button>
          <span className="text-gray-300">|</span>
          <button
            onClick={collapseAll}
            className="text-sm text-blue-600 hover:text-blue-800"
          >
            Collapse All
          </button>
        </div>
      </div>

      {/* Orders List */}
      <div className="space-y-3">
        {filteredOrders.map((order) => (
          <OrderCard
            key={order.ebayOrderId}
            order={order}
            isExpanded={expandedOrders.has(order.ebayOrderId)}
            onToggle={() => toggleOrder(order.ebayOrderId)}
          />
        ))}
      </div>

      {/* Export Info */}
      {exportPath && (
        <div className="text-xs text-gray-400 text-center mt-4">
          Exported to: {exportPath}
        </div>
      )}
    </div>
  )
}