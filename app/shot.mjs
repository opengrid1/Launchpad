import { chromium, devices } from 'playwright'
const browser = await chromium.launch()
const m = await browser.newContext({ ...devices['iPhone 13'], ignoreHTTPSErrors: true })
const p = await m.newPage()
await p.goto('http://localhost:4190/#/t/0x8960bE42d9dEEb973AB6e2DCa837B3bD78c9d5bD', { waitUntil: 'domcontentloaded', timeout: 30000 })
await p.waitForTimeout(4500)
await p.screenshot({ path: '/tmp/new-m1.png' })
// open trade sheet
try { await p.getByRole('button', { name: /Trade LTEST/i }).click({ timeout: 4000 }) } catch(e){ console.log('trade',String(e).slice(0,50)) }
await p.waitForTimeout(900)
await p.screenshot({ path: '/tmp/new-m2.png' })
await browser.close()
console.log('done')
