import { chromium } from 'playwright'
const browser = await chromium.launch()
const d = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true })
const p = await d.newPage()
await p.goto('http://localhost:4205/#/', { waitUntil: 'domcontentloaded', timeout: 30000 })
await p.waitForTimeout(9000)
await p.screenshot({ path: '/tmp/fw.png' })
await browser.close()
console.log('done')
