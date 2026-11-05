export type MediaType = 'audio' | 'video' | 'audio/video'
const defaultHiddenIds = new Set(['bedroom'])

export const isVideoView = (view: { mediaType: MediaType }) => view.mediaType !== 'audio'
export const isDefaultView = (id: string) => !defaultHiddenIds.has(id)
