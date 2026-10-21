import { plainDay, shiftDay, today } from '../lib/dates'
import type { Day } from '../lib/types'
import { readEvents, readItems } from './database'
import { daysDatabase, vodBaseUrl } from './runtime'
import { cameras, coverage } from './vod'

export async function getDays(before = shiftDay(today(), 1), limit = 3): Promise<Day[]> {
  plainDay(before)
  if (!Number.isInteger(limit) || limit < 1 || limit > 7) throw new Error('Limit must be 1–7 days')
  const last = shiftDay(before, -1),
    first = shiftDay(before, -limit)
  const db = daysDatabase()
  try {
    const base = vodBaseUrl()
    const [items, events, cameraResult] = await Promise.all([
      readItems(db, first, last),
      readEvents(db, first, last),
      cameras(base)
        .then((data) => ({ data, failed: false }))
        .catch((error) => {
          console.error(JSON.stringify({ event: 'vod-unavailable', message: String(error) }))
          return { data: [], failed: true }
        }),
    ])
    return await Promise.all(
      Array.from({ length: limit }, async (_, index) => {
        const day = shiftDay(last, -index)
        const vod = await coverage(base, day, cameraResult.data)
        return {
          day,
          items: items.filter((i) => i.day === day),
          events: events.filter((e) => e.day === day),
          cameras: vod.cameras,
          warnings: cameraResult.failed
            ? ['VOD is temporarily unavailable. Other sources are shown below.']
            : vod.warnings,
        }
      })
    )
  } finally {
    db.close()
  }
}
export async function getDay(day: string) {
  return (await getDays(shiftDay(plainDay(day), 1), 1))[0]
}
