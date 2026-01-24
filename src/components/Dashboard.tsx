import { useState, useEffect, useCallback, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  CheckCircle,
  XCircle,
  Play,
  Square,
  Download,
  Loader2,
  KeyRound,
  Plus,
  Trash2,
  Radio,
  ExternalLink,
  Settings,
  ChevronUp,
  Package,
  RefreshCw,
  X,
} from 'lucide-react'
import { OrdersView } from './OrdersView'

interface EbayAccount {
  id: string
  name: string
  isAuthorized: boolean
  tokenFile: string
  ebayAppId: string
  ebayCertId: string
  ebayDevId: string
  ebayRedirectUri: string
  ebayEnvironment: 'SANDBOX' | 'PRODUCTION'
  paymentPolicyId: string
  returnPolicyId: string
  fulfillmentPolicyId: string
  defaultCategoryId: string
  defaultMarketplace: string
  ebaySiteId: number
  defaultInventoryQuantity: number
  watchFolder: string
  processedFolder: string
  failedFolder: string
  createdAt: string
  lastAuthorized?: string
}

// Order types for local state
interface EbayOrderLocal {
  ebayOrderId: string
  ebayOrderDate: string
  ebayOrderStatus: string
  totalPaidByBuyer: { amount: string; currency: string }
  shippingAddress: {
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
  items: Array<{
    lineItemId: string
    sku: string
    asin: string
    title: string
    quantity: number
    price: number
    currency: string
  }>
  orderNote: string
  processedAt: string
}

interface FetchedOrdersState {
  orders: EbayOrderLocal[]
  accountName: string
  exportPath?: string
}

export function Dashboard() {
  const queryClient = useQueryClient()
  const [logs, setLogs] = useState<string[]>([])
  const [showAddAccount, setShowAddAccount] = useState(false)
  const [authorizingAccountId, setAuthorizingAccountId] = useState<string | null>(null)
  const [callbackUrl, setCallbackUrl] = useState('')
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null)
  const [fetchedOrders, setFetchedOrders] = useState<FetchedOrdersState | null>(null)
  const [showOrdersModal, setShowOrdersModal] = useState(false)

  // Query accounts
  const { data: accountsData, isLoading: accountsLoading } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => window.electronAPI.getAccounts(),
  })

  // Query .env defaults for new accounts
  const { data: envDefaults } = useQuery({
    queryKey: ['envDefaults'],
    queryFn: () => window.electronAPI.getEnvDefaults(),
  })

  // Query watcher status
  const { data: watcherStatus, isLoading: watcherLoading } = useQuery({
    queryKey: ['watcherStatus'],
    queryFn: () => window.electronAPI.getWatcherStatus(),
    refetchInterval: 2000,
  })

  const accounts = accountsData?.accounts || []
  const activeAccountId = accountsData?.activeAccountId

  // Add account mutation
  const addAccountMutation = useMutation({
    mutationFn: (accountData: Partial<EbayAccount>) => window.electronAPI.addAccount(accountData),
    onSuccess: () => {
      setShowAddAccount(false)
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      addLog('Account added successfully')
    },
    onError: (error) => {
      addLog(`Error adding account: ${error}`)
    },
  })

  // Update account mutation
  const updateAccountMutation = useMutation({
    mutationFn: ({ accountId, updates }: { accountId: string; updates: Partial<EbayAccount> }) =>
      window.electronAPI.updateAccount(accountId, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      addLog('Account updated successfully')
    },
    onError: (error) => {
      addLog(`Error updating account: ${error}`)
    },
  })

  // Remove account mutation
  const removeAccountMutation = useMutation({
    mutationFn: (accountId: string) => window.electronAPI.removeAccount(accountId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      addLog('Account removed')
    },
  })

  // Set active account mutation
  const setActiveAccountMutation = useMutation({
    mutationFn: (accountId: string) => window.electronAPI.setActiveAccount(accountId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      queryClient.invalidateQueries({ queryKey: ['watcherStatus'] })
      addLog('Active account changed')
    },
  })

  // Start authorization mutation
  const startAuthMutation = useMutation({
    mutationFn: (accountId: string) => window.electronAPI.startAuthorization(accountId),
    onSuccess: (result) => {
      setAuthorizingAccountId(result.accountId)
      addLog('Authorization started - browser opened. Complete login and paste the redirect URL.')
    },
    onError: (error) => {
      addLog(`Error starting authorization: ${error}`)
    },
  })

  // Complete authorization mutation
  const completeAuthMutation = useMutation({
    mutationFn: ({ accountId, callbackUrl }: { accountId: string; callbackUrl: string }) =>
      window.electronAPI.completeAuthorization(accountId, callbackUrl),
    onSuccess: () => {
      setAuthorizingAccountId(null)
      setCallbackUrl('')
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      addLog('Authorization completed successfully!')
    },
    onError: (error) => {
      addLog(`Authorization failed: ${error}`)
    },
  })

  // Start file watcher mutation
  const startWatcherMutation = useMutation({
    mutationFn: () => window.electronAPI.startFileWatcher(),
    onSuccess: (result) => {
      addLog(result.message)
      queryClient.invalidateQueries({ queryKey: ['watcherStatus'] })
    },
    onError: (error) => {
      addLog(`Error starting watcher: ${error}`)
    },
  })

  // Stop file watcher mutation
  const stopWatcherMutation = useMutation({
    mutationFn: () => window.electronAPI.stopFileWatcher(),
    onSuccess: (result) => {
      addLog(result.message)
      queryClient.invalidateQueries({ queryKey: ['watcherStatus'] })
    },
  })

  // Fetch orders mutation
  const fetchOrdersMutation = useMutation({
    mutationFn: (accountId?: string) => window.electronAPI.fetchOrders(accountId),
    onSuccess: (result) => {
      addLog(`Fetched orders for ${result.accountName}`)
      if (result.success && result.orders) {
        addLog(`Found ${result.orders.length} unshipped orders`)
        setFetchedOrders({
          orders: result.orders as EbayOrderLocal[],
          accountName: result.accountName,
          exportPath: result.exportPath,
        })
        if (result.orders.length > 0) {
          setShowOrdersModal(true)
        }
      } else if (result.error) {
        addLog(`Error: ${result.error}`)
      }
    },
    onError: (error) => {
      addLog(`Error fetching orders: ${error}`)
    },
  })

  const addLog = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString()
    setLogs((prev) => [...prev, `[${timestamp}] ${message}`].slice(-100))
  }, [])

  // Listen for watcher output
  useEffect(() => {
    const cleanup = window.electronAPI.onWatcherOutput((data) => {
      const lines = data.data.split('\n').filter((l) => l.trim())
      lines.forEach((line) => addLog(line))
    })

    const cleanupStopped = window.electronAPI.onWatcherStopped((data) => {
      addLog(`File watcher stopped with code ${data.code}`)
      queryClient.invalidateQueries({ queryKey: ['watcherStatus'] })
    })

    return () => {
      cleanup()
      cleanupStopped()
    }
  }, [addLog, queryClient])

  const isWatcherRunning = watcherStatus?.running ?? false
  const activeAccount = accounts.find((a) => a.id === activeAccountId)

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-800">Dashboard</h2>
        <p className="text-gray-500">Manage your eBay accounts and automation</p>
      </div>

      {/* Accounts Section */}
      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-800">eBay Accounts</h3>
          <button
            onClick={() => setShowAddAccount(true)}
            className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" />
            Add Account
          </button>
        </div>

        {accountsLoading ? (
          <div className="flex items-center gap-2 text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin" />
            Loading accounts...
          </div>
        ) : accounts.length === 0 ? (
          <p className="text-gray-500 text-center py-8">
            No accounts yet. Add one to get started.
          </p>
        ) : (
          <div className="space-y-3">
            {accounts.map((account) => (
              <AccountCard
                key={account.id}
                account={account}
                isActive={account.id === activeAccountId}
                isExpanded={editingAccountId === account.id}
                onToggleExpand={() =>
                  setEditingAccountId(editingAccountId === account.id ? null : account.id)
                }
                onSetActive={() => setActiveAccountMutation.mutate(account.id)}
                onStartAuth={() => startAuthMutation.mutate(account.id)}
                onRemove={() => {
                  if (confirm(`Remove ${account.name}? This will delete its authorization.`)) {
                    removeAccountMutation.mutate(account.id)
                  }
                }}
                onSave={(updates) =>
                  updateAccountMutation.mutate({ accountId: account.id, updates })
                }
                isSettingActive={setActiveAccountMutation.isPending}
                isSaving={updateAccountMutation.isPending}
              />
            ))}
          </div>
        )}

        {/* Add Account Modal */}
        {showAddAccount && (
          <AddAccountModal
            defaults={envDefaults}
            onClose={() => setShowAddAccount(false)}
            onAdd={(data) => addAccountMutation.mutate(data)}
            isPending={addAccountMutation.isPending}
          />
        )}

        {/* Authorization Modal */}
        {authorizingAccountId && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 max-w-lg w-full mx-4">
              <h3 className="text-lg font-semibold mb-4">Complete Authorization</h3>
              <p className="text-sm text-gray-600 mb-4">
                1. A browser window opened for eBay login.<br />
                2. Log in with the eBay account you want to authorize.<br />
                3. After authorization, you'll be redirected. Copy the <strong>entire URL</strong> from your browser and paste it below.
              </p>
              <input
                type="text"
                value={callbackUrl}
                onChange={(e) => setCallbackUrl(e.target.value)}
                placeholder="Paste the redirect URL here..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => {
                    setAuthorizingAccountId(null)
                    setCallbackUrl('')
                  }}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={() =>
                    completeAuthMutation.mutate({
                      accountId: authorizingAccountId,
                      callbackUrl: callbackUrl,
                    })
                  }
                  disabled={!callbackUrl.trim() || completeAuthMutation.isPending}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {completeAuthMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                  Complete
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* File Watcher Section */}
      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-2">File Watcher</h3>
        <p className="text-sm text-gray-500 mb-4">
          Monitors your Downloads folder for Amazon product JSON files and automatically creates eBay listings.
        </p>

        {/* Selected Account Display */}
        {activeAccount && (
          <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-center gap-2 text-blue-800">
              <Radio className="w-4 h-4" />
              <span className="text-sm font-medium">
                Selected Account: <strong>{activeAccount.name}</strong>
                {activeAccount.isAuthorized ? (
                  <span className="text-green-600 ml-2">(Authorized)</span>
                ) : (
                  <span className="text-red-600 ml-2">(Not Authorized)</span>
                )}
              </span>
            </div>
            <p className="text-xs text-blue-600 mt-1">
              File watcher will create listings for this account.
            </p>
          </div>
        )}

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div
              className={`w-3 h-3 rounded-full ${
                isWatcherRunning ? 'bg-green-500 animate-pulse' : 'bg-gray-300'
              }`}
            />
            <span className="text-sm font-medium">
              {watcherLoading
                ? 'Checking...'
                : isWatcherRunning
                ? `Running for ${watcherStatus?.activeAccountName || 'unknown'}`
                : 'Stopped'}
            </span>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => startWatcherMutation.mutate()}
              disabled={isWatcherRunning || startWatcherMutation.isPending || !activeAccount?.isAuthorized}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {startWatcherMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4" />
              )}
              Start
            </button>

            <button
              onClick={() => stopWatcherMutation.mutate()}
              disabled={!isWatcherRunning || stopWatcherMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {stopWatcherMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Square className="w-4 h-4" />
              )}
              Stop
            </button>
          </div>
        </div>
      </section>

      {/* Fetch Orders Section */}
      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-semibold text-gray-800">Fetch Orders</h3>
          {fetchedOrders && fetchedOrders.orders.length > 0 && (
            <button
              onClick={() => setShowOrdersModal(true)}
              className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
            >
              <Package className="w-4 h-4" />
              View {fetchedOrders.orders.length} Orders
            </button>
          )}
        </div>
        <p className="text-sm text-gray-500 mb-4">
          Fetch unshipped orders from eBay for the selected account.
        </p>

        <div className="flex items-center gap-3">
          <button
            onClick={() => fetchOrdersMutation.mutate(activeAccountId || undefined)}
            disabled={fetchOrdersMutation.isPending || !activeAccount?.isAuthorized}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {fetchOrdersMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            Fetch Orders {activeAccount && `for ${activeAccount.name}`}
          </button>

          {fetchedOrders && (
            <button
              onClick={() => fetchOrdersMutation.mutate(activeAccountId || undefined)}
              disabled={fetchOrdersMutation.isPending || !activeAccount?.isAuthorized}
              className="flex items-center gap-2 px-3 py-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
              title="Refresh orders"
            >
              <RefreshCw className={`w-4 h-4 ${fetchOrdersMutation.isPending ? 'animate-spin' : ''}`} />
            </button>
          )}
        </div>

        {/* Quick summary when orders are loaded */}
        {fetchedOrders && fetchedOrders.orders.length > 0 && (
          <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
            <div className="flex items-center gap-2 text-green-800">
              <Package className="w-4 h-4" />
              <span className="font-medium">{fetchedOrders.orders.length} unshipped orders</span>
              <span className="text-green-600">for {fetchedOrders.accountName}</span>
            </div>
          </div>
        )}

        {fetchedOrders && fetchedOrders.orders.length === 0 && (
          <div className="mt-4 p-3 bg-gray-50 border border-gray-200 rounded-lg">
            <div className="flex items-center gap-2 text-gray-600">
              <Package className="w-4 h-4" />
              <span>No unshipped orders found for {fetchedOrders.accountName}</span>
            </div>
          </div>
        )}
      </section>

      {/* Orders Modal */}
      {showOrdersModal && fetchedOrders && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-100 rounded-xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-gray-800">eBay Orders</h2>
                <p className="text-sm text-gray-500">{fetchedOrders.accountName}</p>
              </div>
              <button
                onClick={() => setShowOrdersModal(false)}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6">
              <OrdersView
                orders={fetchedOrders.orders}
                accountName={fetchedOrders.accountName}
                exportPath={fetchedOrders.exportPath}
              />
            </div>
          </div>
        </div>
      )}

      {/* Logs Section */}
      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-800">Activity Log</h3>
          <button
            onClick={() => setLogs([])}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Clear
          </button>
        </div>

        <div className="bg-gray-900 rounded-lg p-4 h-64 overflow-y-auto font-mono text-sm">
          {logs.length === 0 ? (
            <p className="text-gray-500">No activity yet...</p>
          ) : (
            logs.map((log, i) => (
              <div key={i} className="text-gray-300">
                {log}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  )
}

// Add Account Modal Component
function AddAccountModal({
  defaults,
  onClose,
  onAdd,
  isPending,
}: {
  defaults?: Partial<EbayAccount> & { anthropicApiKey?: string }
  onClose: () => void
  onAdd: (data: Partial<EbayAccount>) => void
  isPending: boolean
}) {
  const [formData, setFormData] = useState<Partial<EbayAccount>>({
    name: '',
    ebayAppId: defaults?.ebayAppId || '',
    ebayCertId: defaults?.ebayCertId || '',
    ebayDevId: defaults?.ebayDevId || '',
    ebayRedirectUri: defaults?.ebayRedirectUri || '',
    ebayEnvironment: defaults?.ebayEnvironment || 'PRODUCTION',
    paymentPolicyId: '',
    returnPolicyId: '',
    fulfillmentPolicyId: '',
    defaultCategoryId: defaults?.defaultCategoryId || '11450',
    defaultMarketplace: defaults?.defaultMarketplace || 'EBAY_US',
    ebaySiteId: defaults?.ebaySiteId || 0,
    defaultInventoryQuantity: defaults?.defaultInventoryQuantity || 5,
    watchFolder: defaults?.watchFolder || '',
    processedFolder: defaults?.processedFolder || '',
    failedFolder: defaults?.failedFolder || '',
  })

  const updateField = (field: keyof EbayAccount, value: string | number) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 overflow-y-auto">
      <div className="bg-white rounded-xl p-6 max-w-2xl w-full mx-4 my-8 max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-semibold mb-4">Add New eBay Account</h3>

        <div className="space-y-6">
          {/* Basic Info */}
          <div>
            <h4 className="font-medium text-gray-700 mb-2">Account Name</h4>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => updateField('name', e.target.value)}
              placeholder="e.g., My Store, Wife's Account"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* eBay API Credentials - Required for Authorization */}
          <div>
            <h4 className="font-medium text-gray-700 mb-2">eBay API Credentials <span className="text-red-500">*</span></h4>
            <p className="text-xs text-gray-500 mb-3">
              Get these from <a href="https://developer.ebay.com/my/keys" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">developer.ebay.com/my/keys</a>. These 3 fields are required for OAuth.
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-gray-600 mb-1">App ID (Client ID) <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={formData.ebayAppId}
                  onChange={(e) => updateField('ebayAppId', e.target.value)}
                  placeholder="e.g., YourAppN-YourApp-PRD-abc123..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Cert ID (Client Secret) <span className="text-red-500">*</span></label>
                <input
                  type="password"
                  value={formData.ebayCertId}
                  onChange={(e) => updateField('ebayCertId', e.target.value)}
                  placeholder="PRD-abc123-def456..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Redirect URI (RuName) <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={formData.ebayRedirectUri}
                  onChange={(e) => updateField('ebayRedirectUri', e.target.value)}
                  placeholder="YourAppName-YourApp-YourAp-abc..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Environment</label>
                  <select
                    value={formData.ebayEnvironment}
                    onChange={(e) => updateField('ebayEnvironment', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="PRODUCTION">Production</option>
                    <option value="SANDBOX">Sandbox</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Dev ID <span className="text-gray-400">(optional)</span></label>
                  <input
                    type="text"
                    value={formData.ebayDevId}
                    onChange={(e) => updateField('ebayDevId', e.target.value)}
                    placeholder="Optional - not needed for OAuth"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Business Policies */}
          <div>
            <h4 className="font-medium text-gray-700 mb-2">Business Policies (Optional)</h4>
            <p className="text-xs text-gray-500 mb-3">
              You can add these later after authorization
            </p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-sm text-gray-600 mb-1">Payment Policy ID</label>
                <input
                  type="text"
                  value={formData.paymentPolicyId}
                  onChange={(e) => updateField('paymentPolicyId', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Return Policy ID</label>
                <input
                  type="text"
                  value={formData.returnPolicyId}
                  onChange={(e) => updateField('returnPolicyId', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Fulfillment Policy ID</label>
                <input
                  type="text"
                  value={formData.fulfillmentPolicyId}
                  onChange={(e) => updateField('fulfillmentPolicyId', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6 pt-4 border-t">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={() => onAdd(formData)}
            disabled={!formData.name?.trim() || !formData.ebayAppId || !formData.ebayCertId || !formData.ebayRedirectUri || isPending}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            Add Account
          </button>
        </div>
      </div>
    </div>
  )
}

// Account Card Component with expandable settings
function AccountCard({
  account,
  isActive,
  isExpanded,
  onToggleExpand,
  onSetActive,
  onStartAuth,
  onRemove,
  onSave,
  isSettingActive,
  isSaving,
}: {
  account: EbayAccount
  isActive: boolean
  isExpanded: boolean
  onToggleExpand: () => void
  onSetActive: () => void
  onStartAuth: () => void
  onRemove: () => void
  onSave: (updates: Partial<EbayAccount>) => void
  isSettingActive: boolean
  isSaving: boolean
}) {
  // Local state that merges account data with pending edits
  const [localData, setLocalData] = useState<Partial<EbayAccount>>({})
  const [pendingChanges, setPendingChanges] = useState<Partial<EbayAccount>>({})
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Initialize local data when account changes
  useEffect(() => {
    setLocalData({
      ebayAppId: account.ebayAppId,
      ebayCertId: account.ebayCertId,
      ebayDevId: account.ebayDevId,
      ebayRedirectUri: account.ebayRedirectUri,
      ebayEnvironment: account.ebayEnvironment,
      paymentPolicyId: account.paymentPolicyId,
      returnPolicyId: account.returnPolicyId,
      fulfillmentPolicyId: account.fulfillmentPolicyId,
    })
  }, [account])

  const updateField = (field: keyof EbayAccount, value: string | number) => {
    // Update local state immediately for responsive UI
    setLocalData((prev) => ({ ...prev, [field]: value }))
    setPendingChanges((prev) => ({ ...prev, [field]: value }))

    // Debounce auto-save (save 1 second after user stops typing)
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }
    saveTimeoutRef.current = setTimeout(() => {
      setPendingChanges((current) => {
        if (Object.keys(current).length > 0) {
          onSave(current)
        }
        return {}
      })
    }, 1000)
  }

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [])

  const hasChanges = Object.keys(pendingChanges).length > 0
  const hasCredentials = (localData.ebayAppId || account.ebayAppId) &&
                         (localData.ebayCertId || account.ebayCertId) &&
                         (localData.ebayRedirectUri || account.ebayRedirectUri)

  return (
    <div
      className={`border rounded-lg ${
        isActive ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
      }`}
    >
      {/* Header Row */}
      <div className="p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Selected indicator / Set selected button */}
          <button
            onClick={onSetActive}
            disabled={isActive || isSettingActive}
            className={`p-1 rounded-full transition-colors ${
              isActive
                ? 'bg-blue-600 cursor-default'
                : 'bg-gray-200 hover:bg-blue-200'
            }`}
            title={isActive ? 'Selected account' : 'Select this account'}
          >
            <Radio
              className={`w-4 h-4 ${isActive ? 'text-white' : 'text-gray-500'}`}
            />
          </button>

          {/* Authorization status icon */}
          <div
            className={`p-2 rounded-full ${
              account.isAuthorized ? 'bg-green-100' : 'bg-gray-100'
            }`}
          >
            {account.isAuthorized ? (
              <CheckCircle className="w-5 h-5 text-green-600" />
            ) : (
              <XCircle className="w-5 h-5 text-gray-400" />
            )}
          </div>

          {/* Account info */}
          <div>
            <h4 className="font-medium text-gray-800 flex items-center gap-2">
              {account.name}
              {isActive && (
                <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                  Selected
                </span>
              )}
              {account.isAuthorized && (
                <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">
                  Authorized
                </span>
              )}
            </h4>
            <p className="text-sm text-gray-500">
              {account.isAuthorized
                ? `Token active${account.lastAuthorized ? ` - Last authorized ${new Date(account.lastAuthorized).toLocaleDateString()}` : ''}`
                : hasCredentials ? 'Not authorized - Click Authorize' : 'Missing credentials - Configure settings'}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={onStartAuth}
            disabled={!hasCredentials}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              !hasCredentials
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : account.isAuthorized
                ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
            title={!hasCredentials ? 'Configure API credentials first' : ''}
          >
            {account.isAuthorized ? (
              <ExternalLink className="w-4 h-4" />
            ) : (
              <KeyRound className="w-4 h-4" />
            )}
            {account.isAuthorized ? 'Re-auth' : 'Authorize'}
          </button>

          <button
            onClick={onToggleExpand}
            className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            title="Settings"
          >
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <Settings className="w-4 h-4" />}
          </button>

          <button
            onClick={onRemove}
            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            title="Remove account"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Expanded Settings */}
      {isExpanded && (
        <div className="px-4 pb-4 border-t border-gray-200 pt-4 space-y-4">
          {/* eBay API Credentials - Required for Auth */}
          <div>
            <h5 className="font-medium text-gray-700 mb-2 text-sm">
              eBay API Credentials <span className="text-red-500">*</span>
              <span className="text-xs text-gray-400 font-normal ml-2">Required for authorization</span>
              {hasChanges && <span className="text-xs text-blue-500 font-normal ml-2">(auto-saving...)</span>}
              {isSaving && <span className="text-xs text-green-500 font-normal ml-2">(saved!)</span>}
            </h5>
            <div className="space-y-2">
              <div>
                <label className="block text-xs text-gray-600 mb-1">App ID (Client ID) <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={localData.ebayAppId || ''}
                  onChange={(e) => updateField('ebayAppId', e.target.value)}
                  placeholder="Required for OAuth"
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Cert ID (Client Secret) <span className="text-red-500">*</span></label>
                <input
                  type="password"
                  value={localData.ebayCertId || ''}
                  onChange={(e) => updateField('ebayCertId', e.target.value)}
                  placeholder="Required for OAuth"
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Redirect URI (RuName) <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={localData.ebayRedirectUri || ''}
                  onChange={(e) => updateField('ebayRedirectUri', e.target.value)}
                  placeholder="Required for OAuth"
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Environment</label>
                  <select
                    value={localData.ebayEnvironment || 'PRODUCTION'}
                    onChange={(e) => updateField('ebayEnvironment', e.target.value)}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="PRODUCTION">Production</option>
                    <option value="SANDBOX">Sandbox</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Dev ID <span className="text-gray-400">(optional)</span></label>
                  <input
                    type="text"
                    value={localData.ebayDevId || ''}
                    onChange={(e) => updateField('ebayDevId', e.target.value)}
                    placeholder="Not needed for OAuth"
                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Business Policies */}
          <div>
            <h5 className="font-medium text-gray-700 mb-2 text-sm">Business Policies <span className="text-xs text-gray-400 font-normal">(required for publishing)</span></h5>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Payment Policy ID</label>
                <input
                  type="text"
                  value={localData.paymentPolicyId || ''}
                  onChange={(e) => updateField('paymentPolicyId', e.target.value)}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Return Policy ID</label>
                <input
                  type="text"
                  value={localData.returnPolicyId || ''}
                  onChange={(e) => updateField('returnPolicyId', e.target.value)}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Fulfillment Policy ID</label>
                <input
                  type="text"
                  value={localData.fulfillmentPolicyId || ''}
                  onChange={(e) => updateField('fulfillmentPolicyId', e.target.value)}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
