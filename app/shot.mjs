import { chromium } from 'playwright'
const browser = await chromium.launch()
const d = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true })
const p = await d.newPage()
await p.goto('http://localhost:4193/#/t/0x8960bE42d9dEEb973AB6e2DCa837B3bD78c9d5bD', { waitUntil: 'domcontentloaded', timeout: 30000 })
await p.waitForTimeout(5000)
await p.screenshot({ path: '/tmp/liq.png', clip: { x: 150, y: 130, width: 1120, height: 240 } })
await browser.close()
console.log('done')
