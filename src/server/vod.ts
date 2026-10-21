import { dayBounds, dayFromInstant, shiftDay } from '../lib/dates'
import type { CameraCoverage } from '../lib/types'

interface Camera { id: string; name: string; timezone: string; first: number; last: number }
interface Recording { id: string; start: number; end: number; posterUrl: string | null }

async function json<T>(base: string, path: string): Promise<T> {
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new Error(`VOD responded ${response.status}`)
  return response.json() as Promise<T>
}
export const cameras = (base: string) => json<Camera[]>(base, '/api/cameras')

// Merge overlapping intervals so duplicate/overlapping recordings don't inflate coverage.
export function coveredMilliseconds(records: { start: number; end: number }[], start: number, end: number) {
  let total = 0, cursor = start
  for (const r of [...records].sort((a, b) => a.start - b.start)) {
    const left = Math.max(start, cursor, r.start), right = Math.min(end, r.end)
    if (right > left) total += right - left
    cursor = Math.max(cursor, right)
  }
  return total
}
export async function coverage(base: string, day: string, available: Camera[]) {
  const { start, end } = dayBounds(day)
  const warnings: string[] = []
  const results = await Promise.all(available.filter(c => c.first < end && c.last > start).map(async camera => {
    try {
      const localFirst = dayFromInstant(start, camera.timezone)
      const localLast = dayFromInstant(end - 1, camera.timezone)
      const dates: string[] = []
      for (let d = localFirst; d <= localLast; d = shiftDay(d, 1)) dates.push(d)
      const responses = await Promise.all(dates.map(d => json<{ recordings: Recording[] }>(base,
        `/api/cameras/${encodeURIComponent(camera.id)}/day?date=${d}`)))
      const records = [...new Map(responses.flatMap(r => r.recordings)
        .filter(r => r.start < end && r.end > start).map(r => [r.id, r])).values()]
        .sort((a, b) => a.start - b.start)
      if (!records.length) return null
      const position = Math.max(start, records[0].start)
      return {
        id: camera.id, name: camera.name, count: records.length,
        coveredMs: coveredMilliseconds(records, start, end),
        poster: records.find(r => r.posterUrl)?.posterUrl ?? null,
        at: new Date(position).toISOString(), playerDay: dayFromInstant(position, camera.timezone),
      } satisfies CameraCoverage
    } catch (error) {
      console.error(JSON.stringify({ event: 'vod-camera-failed', camera: camera.id, day, message: String(error) }))
      warnings.push(`Coverage for ${camera.name} is temporarily unavailable.`)
      return null
    }
  }))
  return { cameras: results.filter((c): c is CameraCoverage => c !== null), warnings }
}
