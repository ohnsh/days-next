export type MediaType = 'audio' | 'video' | 'audio/video'
const defaultHiddenIds = new Set(['vanity'])

export const isVideoView = (view: { mediaType: MediaType }) => view.mediaType !== 'audio'
// day is the archive date in YYYY-MM-DD format, not the current date.
export const isDefaultView = (id: string, day: string) =>
  !defaultHiddenIds.has(id) && !(id === 'bedroom' && day >= '2026-06-01')
