// The cameras API does not currently expose an audio-only media type.
const audioOnlyIds = new Set(['memo', 'samson'])
const defaultHiddenIds = new Set(['bedroom'])

export const isVideoCamera = (id: string) => !audioOnlyIds.has(id)
export const isDefaultCamera = (id: string) => isVideoCamera(id) && !defaultHiddenIds.has(id)
