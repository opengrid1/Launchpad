import { chromium, devices } from 'playwright'
const browser = await chromium.launch()
const m = await browser.newContext({ ...devices['iPhone 13'], ignoreHTTPSErrors: true })
const p = await m.newPage()
await p.goto('http://localhost:4206/#/', { waitUntil: 'domcontentloaded', timeout: 30000 })
await p.waitForTimeout(8000)
await p.screenshot({ path: '/tmp/minstats.png', clip: { x: 0, y: 250, width: 1170, height: 700 } })
await browser.close()
console.log('done')
