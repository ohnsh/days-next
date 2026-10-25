export interface SourceItem {
  id: string
  source: 'github' | 'youtube'
  day: string
  title: string
  url: string
  description: string
  occurredAt: string
  group: string
  tags: string[]
  thumbnail?: string
  isShort?: boolean
}
export interface EventTag {
  id: string
  name: string
  isPublic: boolean
  version: number
}
export interface EditorialEvent {
  id: string
  day: string
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
  camera: string
  at: string
}
export interface CameraCoverage {
  id: string
  name: string
  count: number
  coveredMs: number
  poster: string | null
  at: string
  playerDay: string
}
export interface Day {
  day: string
  items: SourceItem[]
  events: EditorialEvent[]
  cameras: CameraCoverage[]
  warnings: string[]
}
