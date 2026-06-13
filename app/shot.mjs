import { chromium, devices } from 'playwright'
const browser = await chromium.launch()
const m = await browser.newContext({ ...devices['iPhone 13'], ignoreHTTPSErrors: true })
const p = await m.newPage()
await p.goto('http://localhost:4208/#/launch', { waitUntil: 'domcontentloaded', timeout: 30000 })
await p.waitForTimeout(4000)
await p.screenshot({ path: '/tmp/form.png', fullPage: true })
await browser.close()
console.log('done')
