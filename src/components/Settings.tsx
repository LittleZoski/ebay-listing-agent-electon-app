import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Save,
  Loader2,
  Key,
  DollarSign,
  FolderOpen,
  Settings as SettingsIcon,
  ChevronDown,
  ChevronUp,
  RefreshCw,
} from 'lucide-react'

interface GlobalSettings {
  // API Keys
  anthropicApiKey: string

  // Processing Settings
  maxWorkers: number
  useParallelProcessing: boolean
  processingTimeoutSeconds: number

  // Folder Settings
  watchFolder: string
  processedFolder: string
  failedFolder: string
  ordersExportFolder: string

  // Amazon Pricing Tiers
  amazonTier1MaxPrice: number
  amazonTier1Multiplier: number
  amazonTier2MaxPrice: number
  amazonTier2Multiplier: number
  amazonTier3MaxPrice: number
  amazonTier3Multiplier: number
  amazonTier4MaxPrice: number
  amazonTier4Multiplier: number
  amazonTier5MaxPrice: number
  amazonTier5Multiplier: number
  amazonTier6MaxPrice: number
  amazonTier6Multiplier: number
  amazonTier7Multiplier: number

  // Yami Pricing Tiers
  yamiTier1MaxPrice: number
  yamiTier1Multiplier: number
  yamiTier2MaxPrice: number
  yamiTier2Multiplier: number
  yamiTier3MaxPrice: number
  yamiTier3Multiplier: number
  yamiTier4MaxPrice: number
  yamiTier4Multiplier: number
  yamiTier5MaxPrice: number
  yamiTier5Multiplier: number
  yamiTier6MaxPrice: number
  yamiTier6Multiplier: number
  yamiTier7Multiplier: number

  // Charm Pricing Strategy
  charmPricingStrategy: 'always_99' | 'always_49' | 'tiered'

  // Default Listing Settings
  defaultCategoryId: string
  defaultMarketplace: string
  defaultInventoryQuantity: number

  // Category Selection Settings
  categoryCandidatesTopK: number
}

export function Settings() {
  const queryClient = useQueryClient()
  const [localSettings, setLocalSettings] = useState<GlobalSettings | null>(null)
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['api', 'folders']))
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Query global settings
  const { data: settings, isLoading } = useQuery({
    queryKey: ['globalSettings'],
    queryFn: () => window.electronAPI.getGlobalSettings(),
  })

  // Update settings mutation
  const updateSettingsMutation = useMutation({
    mutationFn: (updates: Partial<GlobalSettings>) =>
      window.electronAPI.updateGlobalSettings(updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['globalSettings'] })
      setHasUnsavedChanges(false)
    },
  })

  // Initialize local settings when data loads
  useEffect(() => {
    if (settings && !localSettings) {
      setLocalSettings(settings)
    }
  }, [settings, localSettings])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [])

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev)
      if (next.has(section)) {
        next.delete(section)
      } else {
        next.add(section)
      }
      return next
    })
  }

  const updateField = <K extends keyof GlobalSettings>(field: K, value: GlobalSettings[K]) => {
    if (!localSettings) return

    setLocalSettings((prev) => prev ? { ...prev, [field]: value } : prev)
    setHasUnsavedChanges(true)

    // Auto-save after 2 seconds of inactivity
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }
    saveTimeoutRef.current = setTimeout(() => {
      if (localSettings) {
        updateSettingsMutation.mutate({ [field]: value })
      }
    }, 2000)
  }

  const saveAllSettings = () => {
    if (localSettings) {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
      updateSettingsMutation.mutate(localSettings)
    }
  }

  if (isLoading || !localSettings) {
    return (
      <div className="p-6 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Settings</h2>
          <p className="text-gray-500">Configure global application settings</p>
        </div>
        <button
          onClick={saveAllSettings}
          disabled={!hasUnsavedChanges || updateSettingsMutation.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {updateSettingsMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          {hasUnsavedChanges ? 'Save Changes' : 'Saved'}
        </button>
      </div>

      {/* API Keys Section */}
      <SettingsSection
        title="API Keys"
        icon={<Key className="w-5 h-5" />}
        isExpanded={expandedSections.has('api')}
        onToggle={() => toggleSection('api')}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Anthropic API Key (Claude)
            </label>
            <input
              type="password"
              value={localSettings.anthropicApiKey}
              onChange={(e) => updateField('anthropicApiKey', e.target.value)}
              placeholder="sk-ant-api03-..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              Required for AI-powered category selection and title optimization.
              Get your key from <a href="https://console.anthropic.com/" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">console.anthropic.com</a>
            </p>
          </div>
        </div>
      </SettingsSection>

      {/* Folder Settings Section */}
      <SettingsSection
        title="Folder Settings"
        icon={<FolderOpen className="w-5 h-5" />}
        isExpanded={expandedSections.has('folders')}
        onToggle={() => toggleSection('folders')}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Watch Folder
            </label>
            <input
              type="text"
              value={localSettings.watchFolder}
              onChange={(e) => updateField('watchFolder', e.target.value)}
              placeholder="c:\Users\...\Downloads"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              Folder to watch for Amazon product JSON files
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Processed Folder
              </label>
              <input
                type="text"
                value={localSettings.processedFolder}
                onChange={(e) => updateField('processedFolder', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Failed Folder
              </label>
              <input
                type="text"
                value={localSettings.failedFolder}
                onChange={(e) => updateField('failedFolder', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Orders Export Folder
            </label>
            <input
              type="text"
              value={localSettings.ordersExportFolder}
              onChange={(e) => updateField('ordersExportFolder', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              Folder where fetched eBay orders will be saved as JSON files
            </p>
          </div>
        </div>
      </SettingsSection>

      {/* Processing Settings Section */}
      <SettingsSection
        title="Processing Settings"
        icon={<RefreshCw className="w-5 h-5" />}
        isExpanded={expandedSections.has('processing')}
        onToggle={() => toggleSection('processing')}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Max Workers
              </label>
              <input
                type="number"
                value={localSettings.maxWorkers}
                onChange={(e) => updateField('maxWorkers', parseInt(e.target.value) || 1)}
                min={1}
                max={10}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Timeout (seconds)
              </label>
              <input
                type="number"
                value={localSettings.processingTimeoutSeconds}
                onChange={(e) => updateField('processingTimeoutSeconds', parseInt(e.target.value) || 1800)}
                min={60}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Category Candidates
              </label>
              <input
                type="number"
                value={localSettings.categoryCandidatesTopK}
                onChange={(e) => updateField('categoryCandidatesTopK', parseInt(e.target.value) || 3)}
                min={1}
                max={10}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="parallelProcessing"
              checked={localSettings.useParallelProcessing}
              onChange={(e) => updateField('useParallelProcessing', e.target.checked)}
              className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
            />
            <label htmlFor="parallelProcessing" className="text-sm text-gray-700">
              Enable parallel processing (faster but uses more API calls)
            </label>
          </div>
        </div>
      </SettingsSection>

      {/* Listing Defaults Section */}
      <SettingsSection
        title="Listing Defaults"
        icon={<SettingsIcon className="w-5 h-5" />}
        isExpanded={expandedSections.has('listing')}
        onToggle={() => toggleSection('listing')}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Default Category ID
              </label>
              <input
                type="text"
                value={localSettings.defaultCategoryId}
                onChange={(e) => updateField('defaultCategoryId', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Default Marketplace
              </label>
              <select
                value={localSettings.defaultMarketplace}
                onChange={(e) => updateField('defaultMarketplace', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="EBAY_US">EBAY_US</option>
                <option value="EBAY_UK">EBAY_UK</option>
                <option value="EBAY_CA">EBAY_CA</option>
                <option value="EBAY_AU">EBAY_AU</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Default Quantity
              </label>
              <input
                type="number"
                value={localSettings.defaultInventoryQuantity}
                onChange={(e) => updateField('defaultInventoryQuantity', parseInt(e.target.value) || 1)}
                min={1}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Charm Pricing Strategy
            </label>
            <select
              value={localSettings.charmPricingStrategy}
              onChange={(e) => updateField('charmPricingStrategy', e.target.value as GlobalSettings['charmPricingStrategy'])}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="always_99">Always .99 (e.g., $23.99)</option>
              <option value="always_49">Always .49 (e.g., $23.49)</option>
              <option value="tiered">Tiered (under $20: .99, $20+: .95)</option>
            </select>
          </div>
        </div>
      </SettingsSection>

      {/* Amazon Pricing Tiers Section */}
      <SettingsSection
        title="Amazon Pricing Tiers"
        icon={<DollarSign className="w-5 h-5" />}
        isExpanded={expandedSections.has('amazonPricing')}
        onToggle={() => toggleSection('amazonPricing')}
      >
        <p className="text-sm text-gray-500 mb-4">
          Configure price multipliers for Amazon products. Lower price items typically have higher multipliers.
        </p>
        <div className="space-y-3">
          <PricingTierRow
            label="Tier 1 (Ultra-low)"
            maxPrice={localSettings.amazonTier1MaxPrice}
            multiplier={localSettings.amazonTier1Multiplier}
            onMaxPriceChange={(v) => updateField('amazonTier1MaxPrice', v)}
            onMultiplierChange={(v) => updateField('amazonTier1Multiplier', v)}
          />
          <PricingTierRow
            label="Tier 2 (Low)"
            maxPrice={localSettings.amazonTier2MaxPrice}
            multiplier={localSettings.amazonTier2Multiplier}
            onMaxPriceChange={(v) => updateField('amazonTier2MaxPrice', v)}
            onMultiplierChange={(v) => updateField('amazonTier2Multiplier', v)}
          />
          <PricingTierRow
            label="Tier 3 (Low-mid)"
            maxPrice={localSettings.amazonTier3MaxPrice}
            multiplier={localSettings.amazonTier3Multiplier}
            onMaxPriceChange={(v) => updateField('amazonTier3MaxPrice', v)}
            onMultiplierChange={(v) => updateField('amazonTier3Multiplier', v)}
          />
          <PricingTierRow
            label="Tier 4 (Mid)"
            maxPrice={localSettings.amazonTier4MaxPrice}
            multiplier={localSettings.amazonTier4Multiplier}
            onMaxPriceChange={(v) => updateField('amazonTier4MaxPrice', v)}
            onMultiplierChange={(v) => updateField('amazonTier4Multiplier', v)}
          />
          <PricingTierRow
            label="Tier 5 (Mid-high)"
            maxPrice={localSettings.amazonTier5MaxPrice}
            multiplier={localSettings.amazonTier5Multiplier}
            onMaxPriceChange={(v) => updateField('amazonTier5MaxPrice', v)}
            onMultiplierChange={(v) => updateField('amazonTier5Multiplier', v)}
          />
          <PricingTierRow
            label="Tier 6 (High)"
            maxPrice={localSettings.amazonTier6MaxPrice}
            multiplier={localSettings.amazonTier6Multiplier}
            onMaxPriceChange={(v) => updateField('amazonTier6MaxPrice', v)}
            onMultiplierChange={(v) => updateField('amazonTier6Multiplier', v)}
          />
          <PricingTierRow
            label="Tier 7 (Premium)"
            multiplier={localSettings.amazonTier7Multiplier}
            onMultiplierChange={(v) => updateField('amazonTier7Multiplier', v)}
            isLastTier
          />
        </div>
      </SettingsSection>

      {/* Yami Pricing Tiers Section */}
      <SettingsSection
        title="Yami Pricing Tiers"
        icon={<DollarSign className="w-5 h-5" />}
        isExpanded={expandedSections.has('yamiPricing')}
        onToggle={() => toggleSection('yamiPricing')}
      >
        <p className="text-sm text-gray-500 mb-4">
          Configure price multipliers for Yami products (Asian specialty items).
        </p>
        <div className="space-y-3">
          <PricingTierRow
            label="Tier 1 (Ultra-low)"
            maxPrice={localSettings.yamiTier1MaxPrice}
            multiplier={localSettings.yamiTier1Multiplier}
            onMaxPriceChange={(v) => updateField('yamiTier1MaxPrice', v)}
            onMultiplierChange={(v) => updateField('yamiTier1Multiplier', v)}
          />
          <PricingTierRow
            label="Tier 2 (Low)"
            maxPrice={localSettings.yamiTier2MaxPrice}
            multiplier={localSettings.yamiTier2Multiplier}
            onMaxPriceChange={(v) => updateField('yamiTier2MaxPrice', v)}
            onMultiplierChange={(v) => updateField('yamiTier2Multiplier', v)}
          />
          <PricingTierRow
            label="Tier 3 (Low-mid)"
            maxPrice={localSettings.yamiTier3MaxPrice}
            multiplier={localSettings.yamiTier3Multiplier}
            onMaxPriceChange={(v) => updateField('yamiTier3MaxPrice', v)}
            onMultiplierChange={(v) => updateField('yamiTier3Multiplier', v)}
          />
          <PricingTierRow
            label="Tier 4 (Mid)"
            maxPrice={localSettings.yamiTier4MaxPrice}
            multiplier={localSettings.yamiTier4Multiplier}
            onMaxPriceChange={(v) => updateField('yamiTier4MaxPrice', v)}
            onMultiplierChange={(v) => updateField('yamiTier4Multiplier', v)}
          />
          <PricingTierRow
            label="Tier 5 (Mid-high)"
            maxPrice={localSettings.yamiTier5MaxPrice}
            multiplier={localSettings.yamiTier5Multiplier}
            onMaxPriceChange={(v) => updateField('yamiTier5MaxPrice', v)}
            onMultiplierChange={(v) => updateField('yamiTier5Multiplier', v)}
          />
          <PricingTierRow
            label="Tier 6 (High)"
            maxPrice={localSettings.yamiTier6MaxPrice}
            multiplier={localSettings.yamiTier6Multiplier}
            onMaxPriceChange={(v) => updateField('yamiTier6MaxPrice', v)}
            onMultiplierChange={(v) => updateField('yamiTier6Multiplier', v)}
          />
          <PricingTierRow
            label="Tier 7 (Premium)"
            multiplier={localSettings.yamiTier7Multiplier}
            onMultiplierChange={(v) => updateField('yamiTier7Multiplier', v)}
            isLastTier
          />
        </div>
      </SettingsSection>
    </div>
  )
}

// Collapsible Section Component
function SettingsSection({
  title,
  icon,
  isExpanded,
  onToggle,
  children,
}: {
  title: string
  icon: React.ReactNode
  isExpanded: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="text-gray-600">{icon}</div>
          <h3 className="text-lg font-semibold text-gray-800">{title}</h3>
        </div>
        {isExpanded ? (
          <ChevronUp className="w-5 h-5 text-gray-400" />
        ) : (
          <ChevronDown className="w-5 h-5 text-gray-400" />
        )}
      </button>
      {isExpanded && <div className="px-6 pb-6">{children}</div>}
    </section>
  )
}

// Pricing Tier Row Component
function PricingTierRow({
  label,
  maxPrice,
  multiplier,
  onMaxPriceChange,
  onMultiplierChange,
  isLastTier = false,
}: {
  label: string
  maxPrice?: number
  multiplier: number
  onMaxPriceChange?: (value: number) => void
  onMultiplierChange: (value: number) => void
  isLastTier?: boolean
}) {
  return (
    <div className="flex items-center gap-4">
      <div className="w-32 text-sm font-medium text-gray-700">{label}</div>
      {!isLastTier && onMaxPriceChange ? (
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">Up to $</span>
          <input
            type="number"
            value={maxPrice}
            onChange={(e) => onMaxPriceChange(parseFloat(e.target.value) || 0)}
            className="w-20 px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          />
        </div>
      ) : (
        <div className="w-28 text-sm text-gray-500">Above all tiers</div>
      )}
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-500">Multiplier:</span>
        <input
          type="number"
          value={multiplier}
          onChange={(e) => onMultiplierChange(parseFloat(e.target.value) || 1)}
          step={0.05}
          min={1}
          className="w-20 px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
        />
        <span className="text-sm text-gray-500">x</span>
      </div>
    </div>
  )
}