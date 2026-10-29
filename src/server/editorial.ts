import { dayFromInstant } from '../lib/dates'
import type { EditorialEvent, EventTag } from '../lib/types'

export class InputError extends Error {}
export class ConflictError extends Error {}
export class UnavailableError extends Error {}

export interface EventInput {
  id: string
  version: number
  title: string
  notes: string
  start: number
  end: number
  cameraScope: 'all' | 'selected'
  cameraIds: string[]
  tags: string[]
  protect: boolean
  isPublic: boolean
}

export function eventInput(value: unknown): EventInput {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new InputError('Expected an event')
  const v = value as Record<string, unknown>
  const text = (key: string, max: number) => {
    if (typeof v[key] !== 'string' || v[key].length > max) throw new InputError(`Invalid ${key}`)
    return (v[key] as string).trim()
  }
  const id = text('id', 100)
  const title = text('title', 200)
  if (!title) throw new InputError('Title is required')
  const notes = text('notes', 16000)
  const start = v.start,
    end = v.end
  if (
    typeof start !== 'number' ||
    typeof end !== 'number' ||
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end <= start ||
    end > 8640000000000000
  )
    throw new InputError('Invalid event interval')
  if (v.cameraScope !== 'all' && v.cameraScope !== 'selected')
    throw new InputError('Invalid camera scope')
  if (
    !Array.isArray(v.cameraIds) ||
    v.cameraIds.length > 100 ||
    v.cameraIds.some((id) => typeof id !== 'string' || !id.trim() || id.length > 200)
  )
    throw new InputError('Invalid camera IDs')
  const cameraIds = [...new Set(v.cameraIds.map((camera) => camera.trim()))]
  if (v.cameraScope === 'selected' && !cameraIds.length)
    throw new InputError('Select at least one camera')
  if (
    !Array.isArray(v.tags) ||
    v.tags.length > 30 ||
    v.tags.some((tag) => typeof tag !== 'string' || !tag.trim() || tag.length > 80)
  )
    throw new InputError('Invalid tags')
  if (typeof v.protect !== 'boolean') throw new InputError('Invalid protection setting')
  if (typeof v.isPublic !== 'boolean') throw new InputError('Invalid visibility')
  if (!Number.isSafeInteger(v.version) || Number(v.version) < 0)
    throw new InputError('Invalid version')
  if (!id && Number(v.version) !== 0) throw new InputError('New events must have version 0')
  return {
    id,
    version: Number(v.version),
    title,
    notes,
    start,
    end,
    cameraScope: v.cameraScope,
    cameraIds,
    tags: [...new Set(v.tags.map((tag) => (tag as string).trim()))],
    protect: v.protect,
    isPublic: v.isPublic,
  }
}

interface AdminArchiveEvent extends Omit<EditorialEvent, 'day' | 'camera' | 'at'> {}
export interface AdminState {
  events: EditorialEvent[]
  tags: EventTag[]
  cameras: { id: string; name: string }[]
  warning?: string
}

async function request<T>(
  base: string,
  path: string,
  token: string,
  init?: RequestInit
): Promise<T> {
  const headers = new Headers(init?.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (init?.body) headers.set('Content-Type', 'application/json')
  const response = await fetch(new URL(path, base), {
    ...init,
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(15000),
  })
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('Location')
    const hostname = location ? new URL(location, base).hostname : ''
    if (hostname.endsWith('.cloudflareaccess.com'))
      throw new UnavailableError(
        'VOD admin API is blocked by Cloudflare Access. Update the Access rules for VOD /api/admin/* to allow its bearer-token API authentication.'
      )
    throw new UnavailableError(`VOD ${path} redirected instead of returning API data.`)
  }
  const text = await response.text()
  let result: unknown
  try {
    result = text ? JSON.parse(text) : undefined
  } catch {
    result = undefined
  }
  if (!response.ok) {
    const message =
      result && typeof result === 'object' && 'error' in result
        ? String((result as { error: unknown }).error)
        : `VOD responded ${response.status}`
    if (response.status === 409) throw new ConflictError(message)
    throw new Error(message)
  }
  if (result === undefined && response.status !== 204)
    throw new UnavailableError(`VOD ${path} returned an invalid JSON response.`)
  return result as T
}

function mapEvent(event: AdminArchiveEvent): EditorialEvent {
  return {
    ...event,
    day: dayFromInstant(event.start),
    camera: event.cameraIds[0] ?? '',
    at: new Date(event.start).toISOString(),
  }
}

export async function readAdminState(
  startMs: number,
  endMs: number,
  base: string,
  token: string
): Promise<AdminState> {
  const params = new URLSearchParams({ start: String(startMs), end: String(endMs) })
  const warning = token
    ? undefined
    : 'VOD_ADMIN_API_TOKEN is not configured. Public VOD data is shown; event editing is unavailable.'
  const [events, tags, cameras] = await Promise.all([
    request<AdminArchiveEvent[]>(base, `/api/${token ? 'admin/' : ''}events?${params}`, token),
    request<EventTag[]>(base, `/api/${token ? 'admin/' : ''}tags`, token),
    request<{ id: string; name: string }[]>(base, `/api/${token ? 'admin/' : ''}cameras`, token),
  ])
  return { events: events.map(mapEvent), tags, cameras, warning }
}

async function requireToken(token: string) {
  if (!token) throw new UnavailableError('VOD_ADMIN_API_TOKEN is required to change VOD events.')
}

async function resolveTags(names: string[], base: string, token: string) {
  let tags = await request<EventTag[]>(base, '/api/admin/tags', token)
  const ids: string[] = []
  for (const name of names) {
    let tag = tags.find((item) => item.name.toLocaleLowerCase() === name.toLocaleLowerCase())
    if (!tag) {
      try {
        const created = await request<{ id: string }>(base, '/api/admin/tags', token, {
          method: 'POST',
          body: JSON.stringify({ name, isPublic: true }),
        })
        ids.push(created.id)
        tags = [...tags, { id: created.id, name, isPublic: true, version: 1 }]
        continue
      } catch (error) {
        if (!(error instanceof ConflictError)) throw error
        tags = await request<EventTag[]>(base, '/api/admin/tags', token)
        tag = tags.find((item) => item.name.toLocaleLowerCase() === name.toLocaleLowerCase())
        if (!tag) throw error
      }
    }
    ids.push(tag.id)
  }
  return ids
}

export async function saveEvent(value: unknown, _actor: string, base: string, token: string) {
  const event = eventInput(value)
  await requireToken(token)
  const tagIds = await resolveTags(event.tags, base, token)
  const payload = {
    title: event.title,
    notes: event.notes,
    start: event.start,
    end: event.end,
    cameraScope: event.cameraScope,
    cameraIds: event.cameraIds,
    tagIds,
    protect: event.protect,
    isPublic: event.isPublic,
    version: event.version,
  }
  const result = await request<{ id: string }>(
    base,
    event.id ? `/api/admin/events/${encodeURIComponent(event.id)}` : '/api/admin/events',
    token,
    { method: event.id ? 'PUT' : 'POST', body: JSON.stringify(payload) }
  )
  return result.id
}

export async function deleteEvent(value: unknown, base: string, token: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new InputError('Expected event ID and version')
  const v = value as Record<string, unknown>
  if (
    typeof v.id !== 'string' ||
    !v.id ||
    !Number.isSafeInteger(v.version) ||
    Number(v.version) < 0
  )
    throw new InputError('Expected event ID and version')
  await requireToken(token)
  await request(base, `/api/admin/events/${encodeURIComponent(v.id)}`, token, {
    method: 'DELETE',
    body: JSON.stringify({ version: Number(v.version) }),
  })
}
