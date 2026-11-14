export interface SourceItem {
  id: string
  source: 'github' | 'git' | 'youtube'
  day: string
  title: string
  url?: string
  description: string
  /** Source timestamp with timezone: commit author date or video publication time. */
  occurredAt: string
  group: string
  tags: string[]
  thumbnail?: string
  isShort?: boolean
  branches?: string[]
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
export interface TranscriptSegment {
  recordingId: string
  sourceCameraId: string
  segmentIndex: number
  startMs: number
  endMs: number
  startUtcMs: number
  endUtcMs: number
  text: string
  playbackUrl: string
}
export interface SourceTranscript {
  id: string
  name: string
  segments: TranscriptSegment[]
}
export interface DayTranscripts {
  day: string
  sources: SourceTranscript[]
  availableSources: { id: string; name: string; count: number; kind: 'view' | 'source' }[]
  activeSource: string | null
  activeKind: 'view' | 'source'
  totalCount: number
  warnings: string[]
}
