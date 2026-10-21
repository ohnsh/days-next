import { defineMiddleware } from 'astro:middleware'
import { getSecret } from 'astro:env/server'
import { adminIdentity } from './server/auth'

export const onRequest = defineMiddleware(async (context, next) => {
  const path = context.url.pathname
  const protectedRoute =
    path === '/admin' ||
    path.startsWith('/admin/') ||
    path === '/api/admin' ||
    path.startsWith('/api/admin/')
  if (!protectedRoute) return next()
  const admin = import.meta.env.DEV
    ? { id: 'local-dev', email: 'local@localhost' }
    : await adminIdentity(
        context.request,
        getSecret('ACCESS_TEAM_DOMAIN') || '',
        getSecret('ACCESS_AUD') || ''
      )
  if (!admin)
    return new Response('Administrator access required', {
      status: 403,
      headers: { 'Cache-Control': 'no-store' },
    })
  context.locals.admin = admin
  if (!['GET', 'HEAD'].includes(context.request.method)) {
    if (
      context.request.headers.get('Origin') !== context.url.origin ||
      context.request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json'
    ) {
      return new Response('Same-origin JSON required', {
        status: 403,
        headers: { 'Cache-Control': 'no-store' },
      })
    }
  }
  const response = await next()
  response.headers.set('Cache-Control', 'no-store')
  return response
})
