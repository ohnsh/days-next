import type { APIRoute } from 'astro'
import {
  ConflictError,
  InputError,
  UnavailableError,
  deleteEvent,
  saveEvent,
} from '../../../server/editorial'
import { vodAdminToken, vodBaseUrl } from '../../../server/runtime'

export const ALL: APIRoute = async ({ request, locals, cache }) => {
  if (!locals.admin) return new Response('Forbidden', { status: 403 })
  if (!['POST', 'PUT', 'DELETE'].includes(request.method))
    return new Response('Method not allowed', {
      status: 405,
      headers: { Allow: 'POST, PUT, DELETE' },
    })
  const reader = request.body?.getReader()
  if (!reader) return Response.json({ error: 'Missing body' }, { status: 400 })
  let body = '',
    size = 0
  const decoder = new TextDecoder()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > 100000) {
      await reader.cancel()
      return Response.json({ error: 'Body too large' }, { status: 413 })
    }
    body += decoder.decode(value, { stream: true })
  }
  body += decoder.decode()
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const invalidate = async () => {
    if (!cache.enabled) return
    try {
      await cache.invalidate({ tags: ['days'] })
    } catch (error) {
      console.error(
        JSON.stringify({ event: 'cache-invalidation-failed', message: String(error) })
      )
    }
  }
  try {
    if (request.method === 'DELETE')
      await deleteEvent(value, vodBaseUrl(), vodAdminToken())
    else await saveEvent(value, locals.admin.id, vodBaseUrl(), vodAdminToken())
    await invalidate()
    return Response.json({ ok: true })
  } catch (error) {
    if (
      error instanceof InputError ||
      error instanceof ConflictError ||
      error instanceof UnavailableError
    )
      return Response.json(
        { error: error.message },
        {
          status:
            error instanceof ConflictError
              ? 409
              : error instanceof UnavailableError
                ? 503
                : 400,
        }
      )
    console.error(
      JSON.stringify({ event: 'vod-editorial-write-failed', message: String(error) })
    )
    return Response.json({ error: 'Could not save the event in VOD' }, { status: 502 })
  }
}
