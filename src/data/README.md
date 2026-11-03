# Poster overrides

Edit `poster-overrides.json`, then commit and deploy to change a day's camera posters:

```json
{
  "2026-11-01": { "time": "14:00", "cameras": { "apartment": "16:30" } },
  "2026-10-31": { "cameras": { "apartment": "13:15" } }
}
```

- Dates match the day pages. All times are 24-hour `HH:mm` in **America/Chicago**.
- Use camera IDs from the VOD API, not display names.
- A camera time takes priority over the day's `time`. Both fields are optional.
- Overrides select the first available recording poster at or after the time. If none exists, they
  use the latest earlier poster for that day. They select existing posters, not exact video frames,
  and do not change the playback start position.
- Remove an override to restore automatic selection: three-hour blocks today, or the first poster
  at/after noon for previous days.
- Invalid dates, times, or fields fail during Astro configuration (including builds).
- Existing page caches may delay when a deployed override appears.
- On daylight-saving transitions, nonexistent times move forward by the gap; repeated times use the
  earlier occurrence.
