import type { APIRoute } from 'astro'
import { plainDay } from '../../../lib/dates'

// The existing admin middleware requires authentication and same-origin JSON.
export const POST: APIRoute = async ({ url, locals, cache }) => {
  if (!locals.admin) return new Response('Forbidden', { status: 403 })
  let day: string
  try {
    day = plainDay(url.searchParams.get('day') ?? '')
  } catch {
    return Response.json({ error: 'Expected day=YYYY-MM-DD' }, { status: 400 })
  }
  if (cache.enabled) await cache.invalidate({ tags: [`day:${day}`] })
  return Response.json({ day, purged: cache.enabled })
}
