import type { APIRoute } from 'astro'
import { daysDatabase } from '../../../server/runtime'
import { ConflictError, InputError, deleteEvent, saveEvent } from '../../../server/editorial'

export const ALL: APIRoute = async ({ request, locals, cache }) => {
  if (!locals.admin) return new Response('Forbidden', { status: 403 })
  if (!['POST', 'DELETE'].includes(request.method))
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST, DELETE' } })
  // Bound streamed bodies too; Content-Length alone is not reliable.
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
  const db = daysDatabase()
  const invalidate = async () => {
    if (!cache.enabled) return
    try {
      // Edits can move an event between days. Purge both feeds and day pages,
      // including any cached representation of the old day.
      await cache.invalidate({ tags: ['days'] })
    } catch (error) {
      // The write has committed: do not report a write failure or invite retries.
      // The short TTL bounds staleness if invalidation is temporarily unavailable.
      console.error(JSON.stringify({ event: 'cache-invalidation-failed', message: String(error) }))
    }
  }
  try {
    if (request.method === 'DELETE') {
      await deleteEvent(db, value)
      await invalidate()
      return Response.json({ ok: true })
    }
    const id = await saveEvent(db, value, locals.admin.id)
    await invalidate()
    return Response.json({ id })
  } catch (error) {
    if (error instanceof InputError || error instanceof ConflictError)
      return Response.json(
        { error: error.message },
        { status: error instanceof ConflictError ? 409 : 400 }
      )
    console.error(JSON.stringify({ event: 'editorial-write-failed', message: String(error) }))
    return Response.json({ error: 'Could not save the event' }, { status: 502 })
  } finally {
    db.close()
  }
}
