import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { LayoutDashboard, MessageSquare, Settings, List } from 'lucide-react'

export function RootLayout() {
  const routerState = useRouterState()
  const currentPath = routerState.location.pathname

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
        {/* Logo */}
        <div className="p-4 border-b border-gray-200">
          <h1 className="text-xl font-bold text-gray-800">eBay Seller App</h1>
          <p className="text-sm text-gray-500">Desktop Manager</p>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-2">
          <NavLink
            to="/"
            icon={<LayoutDashboard className="w-5 h-5" />}
            label="Dashboard"
            active={currentPath === '/'}
          />
          <NavLink
            to="/listings"
            icon={<List className="w-5 h-5" />}
            label="Listings"
            active={currentPath === '/listings'}
          />
          <NavLink
            to="/chat"
            icon={<MessageSquare className="w-5 h-5" />}
            label="AI Chat"
            active={currentPath === '/chat'}
          />
          <NavLink
            to="/settings"
            icon={<Settings className="w-5 h-5" />}
            label="Settings"
            active={currentPath === '/settings'}
          />
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200">
          <p className="text-xs text-gray-400">v1.0.0 MVP</p>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}

function NavLink({
  to,
  icon,
  label,
  active,
}: {
  to: string
  icon: React.ReactNode
  label: string
  active: boolean
}) {
  return (
    <Link
      to={to}
      className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
        active
          ? 'bg-blue-50 text-blue-700'
          : 'text-gray-600 hover:bg-gray-100'
      }`}
    >
      {icon}
      <span className="font-medium">{label}</span>
    </Link>
  )
}
