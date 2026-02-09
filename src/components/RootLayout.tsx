import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { LayoutDashboard, MessageSquare, Settings, List } from 'lucide-react'
import { ThemeToggle } from './ThemeToggle'

export function RootLayout() {
  const routerState = useRouterState()
  const currentPath = routerState.location.pathname

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-slate-900 transition-colors duration-300">
      {/* Sidebar */}
      <aside className="w-64 bg-white dark:bg-slate-800 border-r border-gray-200 dark:border-slate-700 flex flex-col transition-colors duration-300">
        {/* Logo */}
        <div className="p-4 border-b border-gray-200 dark:border-slate-700">
          <h1 className="text-xl font-bold text-gray-800 dark:text-white">eBay Seller App</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400">Desktop Manager</p>
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

        {/* Footer with Theme Toggle */}
        <div className="p-4 border-t border-gray-200 dark:border-slate-700 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500 dark:text-slate-400">Theme</span>
            <ThemeToggle />
          </div>
          <p className="text-xs text-gray-400 dark:text-slate-500">v1.0.0 MVP</p>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto bg-gray-50 dark:bg-slate-900 transition-colors duration-300">
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
          ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
          : 'text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700'
      }`}
    >
      {icon}
      <span className="font-medium">{label}</span>
    </Link>
  )
}
