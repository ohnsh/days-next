import { afterEach, beforeEach, expect, test } from 'bun:test'
import { createClient, type Client } from '@libsql/client'
import { ConflictError, deleteEvent, eventInput, saveEvent } from '../src/server/editorial'
import { readEvents } from '../src/server/database'

let db: Client
beforeEach(async () => {
  db = createClient({ url: ':memory:' })
  await db.executeMultiple(
    await Bun.file(new URL('../migrations/001_days.sql', import.meta.url)).text()
  )
})
afterEach(() => db.close())
const input = () => ({
  id: '',
  version: 0,
  day: '2026-10-20',
  title: 'A moment',
  notes: 'Test',
  tags: ['home'],
  public: false,
  camera: '',
  at: '',
})

test('private notes do not appear publicly; publish and stale edit/delete are atomic', async () => {
  const id = await saveEvent(db, input(), 'tester')
  expect(await readEvents(db, '2026-10-20', '2026-10-20')).toHaveLength(0)
  const [event] = await readEvents(db, '2026-10-20', '2026-10-20', true)
  expect(event.id).toBe(id)
  await saveEvent(db, { ...event, public: true }, 'tester')
  expect(await readEvents(db, '2026-10-20', '2026-10-20')).toHaveLength(1)
  const staleUpdate = await saveEvent(db, { ...event, title: 'Stale' }, 'tester').catch(
    (error) => error
  )
  expect(staleUpdate).toBeInstanceOf(ConflictError)
  const staleDelete = await deleteEvent(db, { id, version: 1 }).catch((error) => error)
  expect(staleDelete).toBeInstanceOf(ConflictError)
  await deleteEvent(db, { id, version: 2 })
  expect(await readEvents(db, '2026-10-20', '2026-10-20', true)).toHaveLength(0)
})
test('playback links require both camera and an unambiguous timestamp', () => {
  expect(() => eventInput({ ...input(), camera: 'quad' })).toThrow()
  expect(() => eventInput({ ...input(), camera: 'quad', at: '2026-10-20T13:00:00' })).toThrow()
  expect(eventInput({ ...input(), camera: 'quad', at: '2026-10-20T13:00:00-05:00' }).day).toBe(
    '2026-10-20'
  )
})
