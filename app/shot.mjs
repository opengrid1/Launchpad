import { chromium, devices } from 'playwright'
const browser = await chromium.launch()
const m = await browser.newContext({ ...devices['iPhone 13'], ignoreHTTPSErrors: true })
const p = await m.newPage()
await p.goto('http://localhost:4200/#/', { waitUntil: 'domcontentloaded', timeout: 30000 })
await p.waitForTimeout(7000)
await p.screenshot({ path: '/tmp/board-rows.png', fullPage: true })
await browser.close()
console.log('done')
