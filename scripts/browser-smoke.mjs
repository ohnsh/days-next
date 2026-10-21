import { chromium } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'

// This smoke check intentionally targets the local prototype and its local database.
const base = 'http://127.0.0.1:4321'
await mkdir('.data/screenshots', { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('pageerror', error => errors.push(error.message))
try {
  let response = await page.goto(`${base}/2026/10/19/`)
  assert.equal(response.status(), 200)
  await page.locator('vod-player-astro').first().waitFor()
  assert.equal(await page.locator('iframe').count(), 0, 'Players must remain unloaded initially')
  await page.screenshot({ path: '.data/screenshots/day-desktop.png', fullPage: true })
  await page.locator('vod-player-astro button').first().click()
  await page.locator('vod-player-astro iframe').first().waitFor()
  assert.equal(await page.locator('vod-player-astro iframe').count(), 1)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${base}/?before=2026-10-20`)
  assert.equal(await page.locator('.day-card').count(), 3)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'No mobile overflow')
  await page.screenshot({ path: '.data/screenshots/feed-mobile.png', fullPage: true })
  response = await page.goto(`${base}/2026/02/30/`)
  assert.equal(response.status(), 404)
  response = await page.request.post(`${base}/api/admin/events`, { data: {}, headers: { Origin: 'https://elsewhere.example' } })
  assert.equal(response.status(), 403)
  await page.goto(`${base}/admin/?day=2026-10-19`)
  await page.getByLabel('Title', { exact: true }).fill('Browser smoke note')
  await page.getByLabel('Notes', { exact: true }).fill('A temporary local test')
  await page.getByRole('button', { name: 'Save event', exact: true }).click()
  await page.locator('.admin-list article').filter({ hasText: 'Browser smoke note' }).waitFor()
  response = await page.request.get(`${base}/2026/10/19/`)
  assert.ok(!(await response.text()).includes('Browser smoke note'), 'Private notes stay private')
  const card = page.locator('.admin-list article').filter({ hasText: 'Browser smoke note' })
  await card.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.getByLabel('Publish on the day page').check()
  await page.getByRole('button', { name: 'Save event', exact: true }).click()
  await page.locator('.admin-list article').filter({ hasText: 'Browser smoke note' }).getByText(/Public/).waitFor()
  response = await page.request.get(`${base}/2026/10/19/`)
  assert.ok((await response.text()).includes('Browser smoke note'), 'Published note appears without a rebuild')
  await page.locator('.admin-list article').filter({ hasText: 'Browser smoke note' }).getByRole('button', { name: 'Delete', exact: true }).click()
  await page.waitForURL(`${base}/admin/?day=2026-10-19`)
  await page.waitForFunction(() => !document.querySelector('.admin-list')?.parentElement?.textContent?.includes('Browser smoke note'))
  assert.deepEqual(errors, [], 'No browser JavaScript errors')
  console.log('Browser smoke passed: live pages, lazy player, mobile layout, private/public events, deletion, CSRF, invalid dates.')
} finally { await browser.close() }
