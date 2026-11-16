import { chromium } from '@playwright/test'
import assert from 'node:assert/strict'

// Run against an already-running server; only public GET requests are made.
// Example: node scripts/benchmark-feed.mjs http://127.0.0.1:4322/ 7 10
const [url = 'http://127.0.0.1:4321/', days = '7', count = '10'] = process.argv.slice(2)
const samples = Number(count)
assert.ok(Number.isInteger(samples) && samples > 0)
const browser = await chromium.launch()
const results = []
try {
  // Warm server compilation and upstream caches; each sample has a fresh browser cache.
  for (let i = -2; i < samples; i++) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.addInitScript(() => {
      window.feedMetrics = { lcp: 0, cls: 0 }
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.feedMetrics.lcp = entry.startTime
      }).observe({ type: 'largest-contentful-paint', buffered: true })
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          if (!entry.hadRecentInput) window.feedMetrics.cls += entry.value
      }).observe({ type: 'layout-shift', buffered: true })
    })
    const response = await page.goto(url, { waitUntil: 'load', timeout: 60000 })
    assert.equal(response.status(), 200)
    const htmlBytes = (await response.body()).length
    assert.equal(await page.locator('.day-card').count(), Number(days))
    assert.equal(await page.locator('.day-card .notice').count(), 0)
    await page.waitForTimeout(2000)
    assert.deepEqual(errors, [])
    assert.equal(await page.locator('iframe').count(), 0)
    const metrics = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0]
      const resources = performance.getEntriesByType('resource')
      return {
        ttfbMs: nav.responseStart - nav.requestStart,
        documentMs: nav.responseEnd - nav.requestStart,
        fcpMs: performance.getEntriesByName('first-contentful-paint')[0]?.startTime,
        lcpMs: window.feedMetrics.lcp,
        loadMs: nav.loadEventEnd,
        cls: window.feedMetrics.cls,
        domNodes: document.querySelectorAll('*').length,
        resourceRequests: resources.length,
        players: document.querySelectorAll('vod-player-astro').length,
      }
    })
    if (i >= 0) results.push({ ...metrics, htmlBytes })
    await context.close()
  }
  const summary = Object.fromEntries(
    Object.keys(results[0]).map((key) => {
      const sorted = results.map((r) => r[key]).sort((a, b) => a - b)
      const mid = Math.floor(sorted.length / 2)
      return [
        key,
        {
          median: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
          min: sorted[0],
          max: sorted.at(-1),
        },
      ]
    })
  )
  console.log(
    JSON.stringify({ url, days: Number(days), samples, summary, results }, null, 2)
  )
} finally {
  await browser.close()
}
