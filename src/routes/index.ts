import { createRootRoute, createRoute } from '@tanstack/react-router'
import { RootLayout } from '../components/RootLayout'
import { Dashboard } from '../components/Dashboard'
import { Chat } from '../components/Chat'
import { Settings } from '../components/Settings'
import { ListingsView } from '../components/ListingsView'

// Create the root route
const rootRoute = createRootRoute({
  component: RootLayout,
})

// Dashboard route (main page)
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: Dashboard,
})

// Chat route
const chatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/chat',
  component: Chat,
})

// Settings route
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: Settings,
})

// Listings route
const listingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/listings',
  component: ListingsView,
})

// Build the route tree
export const routeTree = rootRoute.addChildren([indexRoute, chatRoute, settingsRoute, listingsRoute])
