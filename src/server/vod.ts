import { TIMEZONE, dayBounds, dayFromInstant, shiftDay } from '../lib/dates'
import type {
  CameraCoverage,
  DayTranscripts,
  EditorialEvent,
  EventTag,
  SourceTranscript,
  TranscriptSegment,
} from '../lib/types'

export interface Camera {
  id: string
  name: string
  timezone: string
  first: number
  last: number
  sourceIds?: string[]
  audioSourceIds?: string[]
}
export interface Recording {
  id: string
  start: number
  end: number
  posterUrl: string | null
}
export interface VodDayTranscriptData {
  cameraId: string
  name: string
  day: string
  timezone: string
  start: number
  end: number
  segments: TranscriptSegment[]
}

class VodHttpError extends Error {
  constructor(public status: number) {
    super(`VOD responded ${status}`)
  }
}

async function json<T>(base: string, path: string): Promise<T> {
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new VodHttpError(response.status)
  return response.json() as Promise<T>
}
export const cameras = (base: string) => json<Camera[]>(base, '/api/cameras')

interface ArchiveEvent {
  id: string
  title: string
  notes: string
  start: number
  end: number
  cameraScope: 'all' | 'selected'
  cameraIds: string[]
  tags: EventTag[]
  isPublic: boolean
  protect?: boolean
  version?: number
}

function editorialEvent(event: ArchiveEvent): EditorialEvent {
  return {
    ...event,
    day: dayFromInstant(event.start),
    camera: event.cameraIds[0] ?? '',
    at: new Date(event.start).toISOString(),
  }
}

export async function vodEvents(base: string, startMs: number, endMs: number) {
  const params = new URLSearchParams({ start: String(startMs), end: String(endMs) })
  const events = await json<ArchiveEvent[]>(base, `/api/events?${params}`)
  return events.map(editorialEvent)
}

export function eventsForDay(events: EditorialEvent[], day: string) {
  const { start, end } = dayBounds(day)
  return events
    .filter((event) => event.start < end && event.end > start)
    .map((event) => ({ ...event, day }))
}

// Merge overlapping intervals so duplicate/overlapping recordings don't inflate coverage.
export function coveredMilliseconds(
  records: { start: number; end: number }[],
  start: number,
  end: number
) {
  let total = 0,
    cursor = start
  for (const r of [...records].sort((a, b) => a.start - b.start)) {
    const left = Math.max(start, cursor, r.start),
      right = Math.min(end, r.end)
    if (right > left) total += right - left
    cursor = Math.max(cursor, right)
  }
  return total
}
export async function coverage(
  base: string,
  day: string,
  available: Camera[],
  dayCache?: Map<string, Promise<{ recordings: Recording[] }>>
) {
  const { start, end } = dayBounds(day)
  const warnings: string[] = []
  const results = await Promise.all(
    available
      .filter((c) => c.first < end && c.last > start)
      .map(async (camera) => {
        try {
          const localFirst = dayFromInstant(start, camera.timezone)
          const localLast = dayFromInstant(end - 1, camera.timezone)
          const dates: string[] = []
          for (let d = localFirst; d <= localLast; d = shiftDay(d, 1)) dates.push(d)
          const responses = await Promise.all(
            dates.map((d) => {
              const key = `${camera.id}:${d}`
              let response = dayCache?.get(key)
              if (!response) {
                response = json<{ recordings: Recording[] }>(
                  base,
                  `/api/cameras/${encodeURIComponent(camera.id)}/day?date=${d}`
                )
                dayCache?.set(key, response)
              }
              return response
            })
          )
          const records = [
            ...new Map(
              responses
                .flatMap((r) => r.recordings)
                .filter((r) => r.start < end && r.end > start)
                .map((r) => [r.id, r])
            ).values(),
          ].sort((a, b) => a.start - b.start)
          if (!records.length) return null
          const position = Math.max(start, records[0].start)
          return {
            id: camera.id,
            name: camera.name,
            count: records.length,
            coveredMs: coveredMilliseconds(records, start, end),
            poster: records.find((r) => r.posterUrl)?.posterUrl ?? null,
            at: new Date(position).toISOString(),
            playerDay: dayFromInstant(position, camera.timezone),
          } satisfies CameraCoverage
        } catch (error) {
          console.error(
            JSON.stringify({
              event: 'vod-camera-failed',
              camera: camera.id,
              day,
              message: String(error),
            })
          )
          warnings.push(`Coverage for ${camera.name} is temporarily unavailable.`)
          return null
        }
      })
  )
  return { cameras: results.filter((c): c is CameraCoverage => c !== null), warnings }
}

export async function dayTranscripts(
  base: string,
  day: string,
  sourceFilter?: string | null
): Promise<DayTranscripts> {
  const { start, end } = dayBounds(day)
  const available = await cameras(base)
  const filter = sourceFilter?.trim() || null
  const candidates = new Map<
    string,
    { id: string; name: string; timezone: string; optional?: boolean }
  >()
  for (const c of available) {
    if (c.first < end && c.last > start) {
      candidates.set(c.id, { id: c.id, name: c.name, timezone: c.timezone })
    }
  }
  for (const { id, timezone } of available.flatMap((c) =>
    (c.audioSourceIds ?? []).map((audioId) => ({ id: audioId, timezone: c.timezone }))
  )) {
    if (!candidates.has(id)) {
      candidates.set(id, { id, name: id, timezone })
    }
  }
  if (filter && !candidates.has(filter)) {
    candidates.set(filter, { id: filter, name: filter, timezone: TIMEZONE, optional: true })
  }

  const warnings: string[] = []
  const results = await Promise.all(
    [...candidates.values()].map(async (candidate) => {
      try {
        const localFirst = dayFromInstant(start, candidate.timezone)
        const localLast = dayFromInstant(end - 1, candidate.timezone)
        const dates: string[] = []
        for (let d = localFirst; d <= localLast; d = shiftDay(d, 1)) dates.push(d)
        const responses = await Promise.all(
          dates.map((d) =>
            json<VodDayTranscriptData>(
              base,
              `/api/cameras/${encodeURIComponent(candidate.id)}/transcript?date=${d}`
            )
          )
        )
        const segments = [
          ...new Map(
            responses
              .flatMap((r) => r.segments)
              .filter((s) => s.endUtcMs > start && s.startUtcMs < end)
              .map((s) => [`${s.recordingId}:${s.segmentIndex}`, s])
          ).values(),
        ].sort(
          (a, b) =>
            a.startUtcMs - b.startUtcMs ||
            a.recordingId.localeCompare(b.recordingId) ||
            a.segmentIndex - b.segmentIndex
        )
        if (!segments.length) return null
        const name = responses.find((r) => r.name)?.name || candidate.name
        return {
          id: candidate.id,
          name,
          segments,
        } satisfies SourceTranscript
      } catch (error) {
        if (candidate.optional && error instanceof VodHttpError && error.status === 404) {
          return null
        }
        console.error(
          JSON.stringify({
            event: 'vod-transcript-failed',
            camera: candidate.id,
            day,
            message: String(error),
          })
        )
        warnings.push(`Transcript for ${candidate.name} is temporarily unavailable.`)
        return null
      }
    })
  )

  const allSources = results.filter((s): s is SourceTranscript => s !== null)
  const availableSources = allSources.map((s) => ({
    id: s.id,
    name: s.name,
    count: s.segments.length,
  }))
  const activeSource = filter
  const sources = activeSource ? allSources.filter((s) => s.id === activeSource) : allSources
  return {
    day,
    sources,
    availableSources,
    activeSource,
    warnings,
  }
}
