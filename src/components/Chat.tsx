import { useState, useRef, useEffect } from 'react'
import { Send, Loader2, Bot, User, Wrench } from 'lucide-react'

interface Message {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolName?: string
  toolResult?: unknown
}

// Tool definitions that map to our Electron IPC functions
// These define what the chat can do via natural language
const _toolDefinitions = {
  startFileWatcher: 'Start the Python file watcher that monitors the Downloads folder',
  stopFileWatcher: 'Stop the Python file watcher',
  getWatcherStatus: 'Check if the file watcher is currently running',
  fetchOrders: 'Fetch unshipped orders from eBay (accountId: 1 or 2)',
  getAccountsStatus: 'Get the authorization status of all eBay accounts',
}
// Suppress unused variable warning - definitions kept for documentation
void _toolDefinitions

export function Chat() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: `Hi! I'm your eBay Seller Assistant. I can help you with:

- **Start/Stop File Watcher** - Control the listing automation
- **Fetch Orders** - Get unshipped orders from your eBay accounts
- **Check Account Status** - See which accounts are authorized

Just ask me what you'd like to do!`,
    },
  ])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // Execute a tool based on its name
  const executeTool = async (toolName: string, args?: Record<string, unknown>): Promise<unknown> => {
    switch (toolName) {
      case 'startFileWatcher':
        return await window.electronAPI.startFileWatcher()
      case 'stopFileWatcher':
        return await window.electronAPI.stopFileWatcher()
      case 'getWatcherStatus':
        return await window.electronAPI.getWatcherStatus()
      case 'fetchOrders':
        const accountId = args?.accountId as string | undefined
        return await window.electronAPI.fetchOrders(accountId)
      case 'getAccountsStatus':
        return await window.electronAPI.getAccounts()
      default:
        return { error: `Unknown tool: ${toolName}` }
    }
  }

  // Simple intent detection and tool selection
  const detectIntent = (userMessage: string): { tool: string; args?: Record<string, unknown> } | null => {
    const lower = userMessage.toLowerCase()

    // File watcher intents
    if (lower.includes('start') && (lower.includes('watcher') || lower.includes('watch') || lower.includes('listing') || lower.includes('automation'))) {
      return { tool: 'startFileWatcher' }
    }
    if (lower.includes('stop') && (lower.includes('watcher') || lower.includes('watch') || lower.includes('listing') || lower.includes('automation'))) {
      return { tool: 'stopFileWatcher' }
    }
    if ((lower.includes('status') || lower.includes('running') || lower.includes('check')) && (lower.includes('watcher') || lower.includes('watch'))) {
      return { tool: 'getWatcherStatus' }
    }

    // Orders intents
    if (lower.includes('order') && (lower.includes('fetch') || lower.includes('get') || lower.includes('show') || lower.includes('list'))) {
      // Extract account number if mentioned
      const accountMatch = lower.match(/account\s*(\d)/)
      const accountId = accountMatch ? parseInt(accountMatch[1]) : 1
      return { tool: 'fetchOrders', args: { accountId } }
    }

    // Account status intents
    if (lower.includes('account') && (lower.includes('status') || lower.includes('authorized') || lower.includes('connected') || lower.includes('check'))) {
      return { tool: 'getAccountsStatus' }
    }

    return null
  }

  // Format tool result for display
  const formatToolResult = (toolName: string, result: unknown): string => {
    if (typeof result === 'object' && result !== null) {
      const obj = result as Record<string, unknown>

      switch (toolName) {
        case 'startFileWatcher':
        case 'stopFileWatcher':
          return obj.success
            ? `${obj.message}`
            : `Failed: ${obj.message}`

        case 'getWatcherStatus':
          return obj.running
            ? 'The file watcher is currently **running**.'
            : 'The file watcher is currently **stopped**.'

        case 'fetchOrders':
          if (obj.success) {
            const orders = obj.orders as unknown[]
            if (Array.isArray(orders) && orders.length > 0) {
              return `Successfully fetched **${orders.length} orders**. The orders have been exported to the ebay_orders folder.`
            }
            return 'Orders fetched successfully. Check the ebay_orders folder for results.'
          }
          return `Failed to fetch orders: ${obj.output || 'Unknown error'}`

        case 'getAccountsStatus':
          if (Array.isArray(result)) {
            const accounts = result as Array<{ id: number; name: string; isAuthorized: boolean }>
            const lines = accounts.map((a) =>
              `- **${a.name}**: ${a.isAuthorized ? '✅ Connected' : '❌ Not connected'}`
            )
            return `Account Status:\n${lines.join('\n')}`
          }
          break
      }
    }
    return JSON.stringify(result, null, 2)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return

    const userMessage = input.trim()
    setInput('')

    // Add user message
    const userMsgId = Date.now().toString()
    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: 'user', content: userMessage },
    ])

    setIsLoading(true)

    try {
      // Detect intent and execute tool if applicable
      const intent = detectIntent(userMessage)

      if (intent) {
        // Show tool call message
        const toolMsgId = `tool-${Date.now()}`
        setMessages((prev) => [
          ...prev,
          { id: toolMsgId, role: 'tool', content: `Calling ${intent.tool}...`, toolName: intent.tool },
        ])

        // Execute the tool
        const result = await executeTool(intent.tool, intent.args)

        // Update with result
        setMessages((prev) =>
          prev.map((m) =>
            m.id === toolMsgId
              ? { ...m, content: formatToolResult(intent.tool, result), toolResult: result }
              : m
          )
        )

        // Add assistant summary
        const summaryMsgId = `summary-${Date.now()}`
        const summary = generateSummary(intent.tool, result)
        setMessages((prev) => [
          ...prev,
          { id: summaryMsgId, role: 'assistant', content: summary },
        ])
      } else {
        // No tool detected, provide help
        const helpMsgId = `help-${Date.now()}`
        setMessages((prev) => [
          ...prev,
          {
            id: helpMsgId,
            role: 'assistant',
            content: `I can help you with these actions:

- **"Start the file watcher"** - Begin monitoring for Amazon JSON files
- **"Stop the file watcher"** - Stop the monitoring
- **"Check watcher status"** - See if it's running
- **"Fetch orders"** or **"Fetch orders for account 2"** - Get unshipped orders
- **"Check account status"** - See which accounts are connected

What would you like to do?`,
          },
        ])
      }
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: 'assistant',
          content: `Sorry, there was an error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      ])
    } finally {
      setIsLoading(false)
    }
  }

  const generateSummary = (toolName: string, result: unknown): string => {
    const obj = result as Record<string, unknown>

    switch (toolName) {
      case 'startFileWatcher':
        return obj.success
          ? 'The file watcher is now running. It will automatically process any Amazon product JSON files dropped in your Downloads folder.'
          : 'I wasn\'t able to start the file watcher. Please check the logs on the Dashboard.'

      case 'stopFileWatcher':
        return obj.success
          ? 'The file watcher has been stopped.'
          : 'The file watcher was already stopped or there was an issue stopping it.'

      case 'getWatcherStatus':
        return obj.running
          ? 'The automation is active and watching for new files.'
          : 'The automation is currently inactive. Would you like me to start it?'

      case 'fetchOrders':
        return obj.success
          ? 'Your orders have been fetched and saved. You can find them in the ebay_orders folder.'
          : 'There was an issue fetching orders. Make sure the account is authorized.'

      case 'getAccountsStatus':
        return 'You can authorize accounts from the Dashboard if any are not connected.'

      default:
        return 'Done! Let me know if you need anything else.'
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 bg-white">
        <h2 className="text-lg font-semibold text-gray-800">AI Assistant</h2>
        <p className="text-sm text-gray-500">Chat to control your eBay automation</p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
        {isLoading && (
          <div className="flex items-center gap-2 text-gray-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Thinking...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-4 border-t border-gray-200 bg-white">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask me to start the watcher, fetch orders, etc..."
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </form>
    </div>
  )
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user'
  const isTool = message.role === 'tool'

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
          isUser
            ? 'bg-blue-600'
            : isTool
            ? 'bg-purple-600'
            : 'bg-gray-600'
        }`}
      >
        {isUser ? (
          <User className="w-5 h-5 text-white" />
        ) : isTool ? (
          <Wrench className="w-5 h-5 text-white" />
        ) : (
          <Bot className="w-5 h-5 text-white" />
        )}
      </div>

      <div
        className={`max-w-[80%] rounded-lg px-4 py-2 ${
          isUser
            ? 'bg-blue-600 text-white'
            : isTool
            ? 'bg-purple-50 border border-purple-200'
            : 'bg-gray-100 text-gray-800'
        }`}
      >
        {isTool && message.toolName && (
          <div className="text-xs font-medium text-purple-600 mb-1">
            Tool: {message.toolName}
          </div>
        )}
        <div className="whitespace-pre-wrap text-sm">
          {message.content.split('**').map((part, i) =>
            i % 2 === 1 ? (
              <strong key={i}>{part}</strong>
            ) : (
              <span key={i}>{part}</span>
            )
          )}
        </div>
      </div>
    </div>
  )
}
