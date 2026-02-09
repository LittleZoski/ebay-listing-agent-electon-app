import { useTheme } from '../context/ThemeContext'
import { Sun, Moon } from 'lucide-react'

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  const isDark = theme === 'dark'

  return (
    <button
      onClick={toggleTheme}
      className="relative w-16 h-8 rounded-full p-1 transition-colors duration-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-slate-800"
      style={{
        background: isDark
          ? 'linear-gradient(to right, #1e293b, #334155)'
          : 'linear-gradient(to right, #60a5fa, #3b82f6)',
      }}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {/* Stars (visible in dark mode) */}
      <div
        className={`absolute inset-0 transition-opacity duration-300 ${
          isDark ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <span className="absolute top-1.5 left-2 w-0.5 h-0.5 bg-white rounded-full animate-pulse" />
        <span className="absolute top-3 left-4 w-1 h-1 bg-white rounded-full animate-pulse delay-100" />
        <span className="absolute top-2 left-6 w-0.5 h-0.5 bg-white rounded-full animate-pulse delay-200" />
      </div>

      {/* Clouds (visible in light mode) */}
      <div
        className={`absolute inset-0 transition-opacity duration-300 ${
          isDark ? 'opacity-0' : 'opacity-100'
        }`}
      >
        <span className="absolute bottom-1 right-3 w-2 h-1 bg-white/60 rounded-full" />
        <span className="absolute bottom-2 right-5 w-3 h-1.5 bg-white/40 rounded-full" />
      </div>

      {/* Toggle circle with sun/moon */}
      <div
        className={`relative w-6 h-6 rounded-full flex items-center justify-center transition-all duration-300 ease-in-out transform ${
          isDark
            ? 'translate-x-8 bg-slate-700 shadow-lg shadow-slate-900/50'
            : 'translate-x-0 bg-yellow-300 shadow-lg shadow-orange-500/30'
        }`}
      >
        <div
          className={`transition-all duration-300 ${
            isDark ? 'rotate-0 scale-100' : 'rotate-90 scale-0'
          }`}
        >
          <Moon className="w-4 h-4 text-slate-200" />
        </div>
        <div
          className={`absolute transition-all duration-300 ${
            isDark ? '-rotate-90 scale-0' : 'rotate-0 scale-100'
          }`}
        >
          <Sun className="w-4 h-4 text-yellow-600" />
        </div>
      </div>
    </button>
  )
}
