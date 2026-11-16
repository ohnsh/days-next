import { chromium, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'

// Targets the local app; event mutations use its configured VOD API and admin token.
const base = 'http://localhost:4321'
const title = `Browser smoke note ${randomUUID()}`
await mkdir('.data/screenshots', { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
async function mutate(method, button) {
  const [response] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url() === `${base}/api/admin/events` &&
        response.request().method() === method
    ),
    button.click(),
  ])
  if (!response.ok()) {
    assert.fail(
      `${method} /api/admin/events failed (${response.status()}): ${await response.text()}`
    )
  }
}
try {
  let response = await page.goto(`${base}/2026/10/19/`)
  assert.equal(response.status(), 200)
  await page.locator('vod-player-astro').first().waitFor()
  assert.equal(
    await page.locator('iframe').count(),
    0,
    'Players must remain unloaded initially'
  )
  await page.screenshot({ path: '.data/screenshots/day-desktop.png', fullPage: true })
  await page.locator('vod-player-astro button').first().click()
  await page.locator('vod-player-astro iframe').first().waitFor()
  assert.equal(await page.locator('vod-player-astro iframe').count(), 1)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${base}/?before=2026-10-20`)
  assert.equal(await page.locator('.day-card').count(), 7)
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    'No mobile overflow'
  )
  await page.screenshot({ path: '.data/screenshots/feed-mobile.png', fullPage: true })
  response = await page.goto(`${base}/2026/02/30/`)
  assert.equal(response.status(), 404)
  response = await page.request.post(`${base}/api/admin/events`, {
    data: {},
    headers: { Origin: 'https://elsewhere.example' },
  })
  assert.equal(response.status(), 403)
  await page.goto(`${base}/admin/?day=2026-10-19`)
  await page.getByLabel('Title', { exact: true }).fill(title)
  await page.getByLabel('Notes', { exact: true }).fill('A temporary local test')
  await mutate('POST', page.getByRole('button', { name: 'Save event', exact: true }))
  const card = page.locator('.admin-list article').filter({ hasText: title })
  await card.waitFor()
  response = await page.request.get(`${base}/2026/10/19/`)
  assert.ok(!(await response.text()).includes(title), 'Private notes stay private')
  await card.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.getByLabel('Publish on the day page').check()
  await mutate('PUT', page.getByRole('button', { name: 'Save event', exact: true }))
  await card.getByText(/Public/).waitFor()
  response = await page.request.get(`${base}/2026/10/19/`)
  assert.ok(
    (await response.text()).includes(title),
    'Published note appears without a rebuild'
  )
  await mutate('DELETE', card.getByRole('button', { name: 'Delete', exact: true }))
  await page.waitForURL(`${base}/admin/?day=2026-10-19`)
  await expect(card).toHaveCount(0)
  assert.deepEqual(errors, [], 'No browser JavaScript errors')
  console.log(
    'Browser smoke passed: live pages, lazy player, mobile layout, private/public events, deletion, CSRF, invalid dates.'
  )
} finally {
  await browser.close()
}
