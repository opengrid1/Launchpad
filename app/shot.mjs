import { chromium, devices } from 'playwright'
const browser = await chromium.launch()
const m = await browser.newContext({ ...devices['iPhone 13'], ignoreHTTPSErrors: true })
const p = await m.newPage()
await p.goto('http://localhost:4201/#/t/0x8960bE42d9dEEb973AB6e2DCa837B3bD78c9d5bD', { waitUntil: 'domcontentloaded', timeout: 30000 })
await p.waitForTimeout(9000)
await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
await p.waitForTimeout(1500)
await p.screenshot({ path: '/tmp/activity.png', fullPage: false })
// also click Holders tab
try { await p.getByRole('button', { name: /Holders/i }).click({ timeout: 3000 }) } catch {}
await p.waitForTimeout(2500)
await p.screenshot({ path: '/tmp/activity-h.png', fullPage: false })
await browser.close()
console.log('done')
