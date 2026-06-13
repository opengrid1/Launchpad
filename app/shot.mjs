import { chromium } from 'playwright'
const browser = await chromium.launch()
const d = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true })
const p = await d.newPage()
await p.goto('http://localhost:4198/#/t/0x8960bE42d9dEEb973AB6e2DCa837B3bD78c9d5bD', { waitUntil: 'domcontentloaded', timeout: 30000 })
await p.waitForTimeout(9000)
await p.screenshot({ path: '/tmp/gtchart.png', clip: { x: 150, y: 380, width: 760, height: 600 } })
await browser.close()
console.log('done')
