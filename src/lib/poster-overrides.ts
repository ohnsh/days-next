import { plainDay } from './dates'

export type PosterOverrides = Record<
  string,
  { time?: string; cameras?: Record<string, string> }
>

export function validatePosterOverrides(value: unknown): PosterOverrides {
  const fail = (path: string, message: string): never => {
    throw new Error(`poster-overrides.yaml: ${path} ${message}`)
  }
  const object = (value: unknown, path: string): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return fail(path, 'must be an object')
    }
    return value as Record<string, unknown>
  }
  const time = (value: unknown, path: string) => {
    if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
      fail(path, 'must be a 24-hour time (HH:mm)')
    }
  }
  for (const [day, entry] of Object.entries(object(value, 'root'))) {
    try {
      plainDay(day)
    } catch {
      fail(day, 'must be a valid date (YYYY-MM-DD)')
    }
    const override = object(entry, day)
    for (const key of Object.keys(override)) {
      if (key !== 'time' && key !== 'cameras')
        fail(`${day}.${key}`, 'is an unknown field')
    }
    if ('time' in override) time(override.time, `${day}.time`)
    if ('cameras' in override) {
      for (const [camera, at] of Object.entries(
        object(override.cameras, `${day}.cameras`)
      )) {
        if (!camera.trim() || camera !== camera.trim()) {
          fail(
            `${day}.cameras`,
            'must use nonempty camera IDs without surrounding whitespace'
          )
        }
        time(at, `${day}.cameras.${camera}`)
      }
    }
  }
  return value as PosterOverrides
}

export function posterOverrideTime(
  overrides: PosterOverrides,
  day: string,
  camera: string
) {
  const entry = Object.hasOwn(overrides, day) ? overrides[day] : undefined
  return entry?.cameras && Object.hasOwn(entry.cameras, camera)
    ? entry.cameras[camera]
    : entry?.time
}
