import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { getShowAll, subscribeShowAll } from '../lib/vod-preference'
import { DayButton, DayPicker, type DayButtonProps } from 'react-day-picker'
import 'react-day-picker/style.css'
import './calendar.css'

interface CalendarData {
  month: string
  days: Record<string, boolean>
  allDays: Record<string, boolean>
}

// Calendar dates are wall dates, not UTC instants. Avoid UTC parsing shifting a day.
const dateOf = (day: string) => {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(year, month - 1, date, 12)
}
const dayOf = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

function ContentDayButton(props: DayButtonProps) {
  const vod = props.modifiers.vod && !props.modifiers.disabled
  return (
    <DayButton
      {...props}
      aria-label={`${props['aria-label']}${vod ? ', VOD content available' : ''}`}
    >
      {props.children}
      <span className="cal-indicators" aria-hidden="true">
        {vod && <span className="cal-dot cal-dot-vod" />}
      </span>
    </DayButton>
  )
}

export default function CalendarPicker({
  activeDay,
  today,
  admin = false,
}: {
  activeDay: string
  today: string
  admin?: boolean
}) {
  const id = useId()
  const showAll = useSyncExternalStore(subscribeShowAll, getShowAll, () => false)
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [month, setMonth] = useState(dateOf(activeDay > today ? today : activeDay))
  const [availability, setAvailability] = useState<CalendarData>()
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const monthKey = dayOf(month).slice(0, 7)

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setStatus('loading')
    setAvailability(undefined)
    fetch(`/api/calendar?month=${monthKey}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Calendar unavailable')
        return response.json() as Promise<CalendarData>
      })
      .then((data) => {
        if (controller.signal.aborted) return
        setAvailability(data)
        setStatus('ready')
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus('error')
      })
    return () => controller.abort()
  }, [open, monthKey])

  return (
    <div className="cal-picker">
      <button
        ref={trigger}
        className="cal-trigger"
        aria-label={`Open calendar, ${activeDay}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          setMonth(dateOf(activeDay > today ? today : activeDay))
          dialog.current?.showModal()
          setOpen(true)
        }}
      >
        {dateOf(activeDay).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })}
        <span aria-hidden="true"> ▾</span>
      </button>
      <dialog
        id={id}
        ref={dialog}
        className="cal-dialog"
        aria-label="Choose a date"
        onClose={() => {
          setOpen(false)
          trigger.current?.focus()
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) dialog.current?.close()
        }}
      >
        <div className="cal-dialog-content">
          <div className="cal-dialog-heading">
            <span>Jump to date</span>
            <button aria-label="Close calendar" onClick={() => dialog.current?.close()}>
              ×
            </button>
          </div>
          {open && (
            <DayPicker
              mode="single"
              captionLayout="dropdown"
              navLayout="after"
              selected={dateOf(activeDay)}
              today={dateOf(today)}
              month={month}
              onMonthChange={setMonth}
              startMonth={dateOf('2025-01-01')}
              endMonth={dateOf(today)}
              disabled={{ after: dateOf(today) }}
              autoFocus
              fixedWeeks
              modifiers={{
                vod: (date) =>
                  availability?.month === monthKey &&
                  !!(showAll ? availability.allDays : availability.days)[dayOf(date)],
              }}
              components={{ DayButton: ContentDayButton }}
              onSelect={(date) => {
                if (!date) return
                const day = dayOf(date)
                if (day > today) return
                location.assign(admin ? `/admin/?day=${day}` : `/${day.replaceAll('-', '/')}/`)
              }}
            />
          )}
          <div className="cal-legend">
            <span className="cal-dot cal-dot-vod" /> VOD content
          </div>
          <div className="cal-status" role="status">
            {status === 'loading'
              ? 'Loading VOD availability…'
              : status === 'error'
                ? 'VOD indicators unavailable. You can still choose a date.'
                : ''}
          </div>
        </div>
      </dialog>
    </div>
  )
}
