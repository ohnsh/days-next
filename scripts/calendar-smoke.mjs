import { chromium, webkit } from '@playwright/test'
import assert from 'node:assert/strict'

const base = 'http://127.0.0.1:4321'
for (const [name, engine] of Object.entries({ chromium, webkit })) {
  const browser = await engine.launch()
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    timezoneId: 'Asia/Tokyo',
  })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    const response = await page.goto(`${base}/2026/10/19/`)
    assert.equal(response.status(), 200)
    const trigger = page.getByRole('button', { name: /Open calendar/ })
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: 'Choose a date' })
    await dialog.waitFor()
    await page.locator('.rdp-day_button .cal-dot').first().waitFor({ timeout: 30000 })
    const bounds = await dialog.boundingBox()
    assert.ok(bounds.width >= 340, `Desktop calendar width ${bounds.width}`)
    await page.keyboard.press('Escape')
    assert.equal(await dialog.isVisible(), false)
    assert.equal(await trigger.evaluate((el) => el === document.activeElement), true)
    await trigger.click()
    const next = page.getByRole('button', { name: /next month/i })
    while (await next.isEnabled()) await next.click()
    assert.ok((await page.locator('.rdp-day_button:disabled').count()) > 0, 'Future dates disabled')
    await page.setViewportSize({ width: 390, height: 844 })
    const mobile = await dialog.boundingBox()
    assert.ok(mobile.x >= 0 && mobile.x + mobile.width <= 390, 'Mobile dialog fits')
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true
    )
    await page.keyboard.press('Escape')
    await page.route('**/api/calendar?*', (route) => route.fulfill({ status: 502, body: '{}' }))
    await trigger.click()
    await page.getByRole('status').filter({ hasText: 'VOD indicators unavailable' }).waitFor()
    await page.getByRole('button', { name: /Tuesday, October 20/ }).click()
    await page.waitForURL('**/2026/10/20/')
    assert.deepEqual(errors, [])
    console.log(
      `${name}: live indicators, sizing, focus, future dates, mobile fit, failure fallback and selection passed`
    )
  } finally {
    await browser.close()
  }
}
