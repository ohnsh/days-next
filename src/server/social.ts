import { OgSnap, OgSnapError, type CaptureRequest } from 'og-snap/client'
import type { SocialMetadata } from 'og-snap/meta'
import { dayTitle, dayUrl } from '../lib/dates'
import { orderedVideos } from '../lib/day-media'
import {
  daySocialKey,
  socialOrigin,
  socialWidth,
  socialHeight,
  type SocialSelection,
} from '../lib/social'
import { isDefaultView } from '../lib/vod-view'
import { readItem } from './database'
import type { Day, SourceItem } from '../lib/types'

export interface Poster {
  id: string
  url: string
  title: string
  group: 'VOD' | 'YouTube'
}
export class SocialSelectionError extends Error {
  constructor(
    message: string,
    readonly status: number = 400
  ) {
    super(message)
  }
}
interface SocialSources {
  day: (day: string) => Promise<Day>
  item: (id: string) => Promise<SourceItem | null>
}
const sources: SocialSources = {
  day: async (day) => (await import('./days')).getDay(day),
  item: async (id) => {
    const { daysDatabase } = await import('./runtime')
    const db = daysDatabase()
    try {
      return await readItem(db, id)
    } finally {
      db.close()
    }
  },
}
export async function resolveSocialSelection(
  selection: SocialSelection,
  dataSources: SocialSources = sources
) {
  let day = selection.day!
  let posters: Poster[] = []
  if (selection.id) {
    const item = await dataSources.item(selection.id)
    if (!item) throw new SocialSelectionError('Public source item not found', 404)
    if (!item.thumbnail) throw new SocialSelectionError('This source item has no poster')
    day = item.day
    posters = [{ id: item.id, url: item.thumbnail, title: item.title, group: 'YouTube' }]
  } else {
    const data = await dataSources.day(day)
    if (selection.section !== 'youtube' && data.warnings.length)
      throw new SocialSelectionError('Day media is temporarily unavailable', 503)
    if (selection.section !== 'youtube') {
      posters.push(
        ...data.cameras
          .filter((camera) =>
            selection.camera
              ? camera.id === selection.camera
              : selection.allCameras || isDefaultView(camera.id, day)
          )
          .map((camera) => ({
            id: camera.id,
            url: camera.poster ?? '',
            title: camera.name,
            group: 'VOD' as const,
          }))
      )
    }
    if (selection.camera && !posters.length)
      throw new SocialSelectionError('Camera not found for this day', 404)
    if (!selection.camera && selection.section !== 'vod') {
      posters.push(
        ...orderedVideos(data.items).map((item) => ({
          id: item.id,
          url: item.thumbnail ?? '',
          title: item.title,
          group: 'YouTube' as const,
        }))
      )
    }
  }
  if (selection.forDay && selection.forDay !== day)
    throw new SocialSelectionError('--for-day must match the selected content’s day')
  const single = !!(selection.id || selection.camera)
  const total = posters.length
  posters = posters.slice(0, single ? 1 : 3)
  if (posters.some((poster) => !poster.url))
    throw new SocialSelectionError('A selected poster is unavailable', 503)
  const key = selection.forDay
    ? daySocialKey(selection.forDay)
    : selection.id
      ? `items/${selection.id}`
      : selection.camera
        ? `${daySocialKey(day)}/cameras/${selection.camera}`
        : daySocialKey(day)
  const url = new URL('/social/preview', socialOrigin)
  if (selection.id) url.searchParams.set('id', selection.id)
  else url.searchParams.set('day', day)
  if (selection.camera) url.searchParams.set('camera', selection.camera)
  if (!single) {
    url.searchParams.set('section', selection.section)
    if (selection.allCameras) url.searchParams.set('all-cameras', 'true')
  }
  const request: Omit<CaptureRequest, 'publication'> = {
    key,
    url: url.href,
    alt: (single ? posters[0].title : `Days — ${dayTitle(day)}: ${total} posters`).slice(
      0,
      500
    ),
    resolution: { width: socialWidth, height: socialHeight },
    selector: '#social-preview',
    readySelector: '#social-preview[data-preview-state="ready"]',
    errorSelector: '#social-preview[data-preview-state="error"]',
    background: '#1c1b19',
    metadata: {
      composition: single ? 'poster' : 'day-grid',
      day,
      section: selection.section,
      allCameras: selection.allCameras,
      templateVersion: 2,
      ...(selection.id ? { id: selection.id } : {}),
      ...(selection.camera ? { camera: selection.camera } : {}),
    },
  }
  return {
    day,
    single,
    posters,
    total,
    request,
    affectedDays: key === daySocialKey(day) ? [day] : [],
  }
}

export async function daySocialMetadata(day: string, canonicalPath = dayUrl(day)) {
  const social: SocialMetadata = {
    title: `${dayTitle(day)} · Days`,
    description: 'Days — an archive.',
    siteName: 'Days',
    url: new URL(canonicalPath, socialOrigin).href,
  }
  try {
    const manifest = await new OgSnap({ consumer: 'days' }).current(daySocialKey(day), {
      signal: AbortSignal.timeout(1500),
    })
    social.image = manifest.image
    return { social, failed: false }
  } catch (error) {
    const failed = !(error instanceof OgSnapError && error.status === 404)
    if (failed)
      console.warn(JSON.stringify({ event: 'social-manifest-unavailable', day }))
    return { social, failed }
  }
}
