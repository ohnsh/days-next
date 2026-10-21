import type { Client } from '@libsql/client'
import { plainDay } from '../lib/dates'
import type { EditorialEvent } from '../lib/types'

export class InputError extends Error {}
export class ConflictError extends Error {}
export function eventInput(value: unknown): EditorialEvent {
  if (!value || typeof value !== 'object') throw new InputError('Expected an event')
  const v = value as Record<string, unknown>
  const text = (key: string, max: number) => {
    if (typeof v[key] !== 'string' || v[key].length > max) throw new InputError(`Invalid ${key}`)
    return v[key].trim()
  }
  const day = text('day', 10)
  try { plainDay(day) } catch { throw new InputError('Invalid day') }
  const title = text('title', 200)
  if (!title) throw new InputError('Title is required')
  const id = text('id', 100), notes = text('notes', 20000), camera = text('camera', 200), at = text('at', 80)
  if (Boolean(camera) !== Boolean(at)) throw new InputError('Provide both camera and recording timestamp, or neither')
  if (at && (!/(?:Z|[+-]\d\d:\d\d)$/.test(at) || !Number.isFinite(Date.parse(at)))) throw new InputError('Timestamp needs an explicit timezone')
  if (typeof v.public !== 'boolean') throw new InputError('Invalid visibility')
  if (!Number.isInteger(v.version) || Number(v.version) < 0) throw new InputError('Invalid version')
  if (!Array.isArray(v.tags) || v.tags.length > 30 || v.tags.some(t => typeof t !== 'string' || !t.trim() || t.length > 80)) throw new InputError('Invalid tags')
  return { id, day, title, notes, camera, at, public: v.public, version: Number(v.version), tags: [...new Set(v.tags.map(t => t.trim()))] }
}
export async function saveEvent(db: Client, value: unknown, actor: string) {
  const e = eventInput(value), now = new Date().toISOString()
  if (!e.id) {
    if (e.version !== 0) throw new InputError('New events must have version 0')
    e.id = crypto.randomUUID()
    await db.execute({ sql: 'INSERT INTO events (id,day,title,notes,tags,is_public,camera,at,updated_at,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?)',
      args: [e.id, e.day, e.title, e.notes, JSON.stringify(e.tags), Number(e.public), e.camera, e.at, now, actor] })
  } else {
    const result = await db.execute({ sql: 'UPDATE events SET day=?,title=?,notes=?,tags=?,is_public=?,camera=?,at=?,version=version+1,updated_at=?,updated_by=? WHERE id=? AND version=?',
      args: [e.day, e.title, e.notes, JSON.stringify(e.tags), Number(e.public), e.camera, e.at, now, actor, e.id, e.version] })
    if (!result.rowsAffected) throw new ConflictError('This event changed or was deleted. Reload before editing.')
  }
  return e.id
}
export async function deleteEvent(db: Client, value: unknown) {
  const v = value as Record<string, unknown> | null
  if (!v || typeof v.id !== 'string' || !Number.isInteger(v.version)) throw new InputError('Expected event ID and version')
  const result = await db.execute({ sql: 'DELETE FROM events WHERE id=? AND version=?', args: [v.id, Number(v.version)] })
  if (!result.rowsAffected) throw new ConflictError('This event changed or was deleted. Reload first.')
}
