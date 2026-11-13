import { plainDay } from './dates'

export const socialOrigin = 'https://days.ohn.sh'
export const socialWidth = 1200
export const socialHeight = 630
export const daySocialKey = (day: string) => `dates/${plainDay(day)}`
export interface SocialSelection {
  day?: string
  id?: string
  camera?: string
  section: 'all' | 'vod' | 'youtube'
  allCameras: boolean
  forDay?: string
}
export function parseSocialSelection(params: URLSearchParams): SocialSelection {
  const allowed = ['day', 'id', 'camera', 'section', 'all-cameras', 'for-day']
  for (const key of params.keys()) {
    if (!allowed.includes(key) || params.getAll(key).length !== 1)
      throw new Error(`Invalid selection parameter: ${key}`)
  }
  const day = params.has('day') ? plainDay(params.get('day')!) : undefined
  const id = params.get('id') ?? undefined
  const camera = params.get('camera') ?? undefined
  const section = params.get('section') ?? 'all'
  const forDay = params.has('for-day') ? plainDay(params.get('for-day')!) : undefined
  if (!!day === !!id) throw new Error('Choose exactly one of --day or --id')
  for (const [name, value] of [
    ['id', id],
    ['camera', camera],
  ] as const) {
    if (value !== undefined && (!/^[a-zA-Z0-9_:-]+$/.test(value) || value.length > 180))
      throw new Error(`Invalid ${name}`)
  }
  if (!['all', 'vod', 'youtube'].includes(section)) throw new Error('Invalid section')
  if (params.has('all-cameras') && params.get('all-cameras') !== 'true')
    throw new Error('all-cameras must be true')
  if (camera && !day) throw new Error('--camera requires --day')
  if ((id || camera) && (params.has('section') || params.has('all-cameras')))
    throw new Error('Grid options cannot be used with a single poster')
  return {
    day,
    id,
    camera,
    section: section as SocialSelection['section'],
    allCameras: params.has('all-cameras'),
    forDay,
  }
}
