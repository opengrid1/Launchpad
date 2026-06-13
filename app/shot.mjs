import { chromium } from 'playwright'
const browser = await chromium.launch()
const d = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true })
const p = await d.newPage()
await p.goto('http://localhost:4189/#/t/0x8960bE42d9dEEb973AB6e2DCa837B3bD78c9d5bD', { waitUntil: 'domcontentloaded', timeout: 30000 })
await p.waitForTimeout(4500)
await p.screenshot({ path: '/tmp/final-pub.png', clip: { x: 150, y: 250, width: 760, height: 130 } })
await browser.close()
console.log('done')
