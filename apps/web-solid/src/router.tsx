import { createRouter, createRootRoute, createRoute, redirect, Outlet } from '@tanstack/solid-router'
import { LoginPage } from './pages/LoginPage'
import { DashboardPage } from './pages/DashboardPage'
import { PRReviewPage } from './pages/PRReviewPage'
import { loadSession } from './stores/session'
import { onMount } from 'solid-js'

function Root() {
  onMount(() => loadSession())
  return <Outlet />
}

const rootRoute = createRootRoute({ component: Root })
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', beforeLoad: () => { throw redirect({ to: '/login' }) } })
const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: '/login', component: LoginPage })
const dashboardRoute = createRoute({ getParentRoute: () => rootRoute, path: '/dashboard', component: DashboardPage })
const prRoute = createRoute({ getParentRoute: () => rootRoute, path: '/pr/$owner/$repo/$number', component: PRReviewPage })

const routeTree = rootRoute.addChildren([indexRoute, loginRoute, dashboardRoute, prRoute])
export const router = createRouter({ routeTree })

declare module '@tanstack/solid-router' {
  interface Register { router: typeof router }
}
