import { chromium } from 'playwright'
const browser = await chromium.launch()
const d = await browser.newContext({ viewport: { width: 1440, height: 980 }, ignoreHTTPSErrors: true })
const p = await d.newPage()
await p.goto('http://localhost:4183/#/launch', { waitUntil: 'domcontentloaded', timeout: 30000 })
await p.waitForTimeout(1500)
await p.screenshot({ path: '/tmp/lp-closed.png', clip: { x: 130, y: 80, width: 800, height: 640 } })
// open the socials dropdown
const btns = await p.$$('button')
for (const b of btns) { const t = await b.innerText().catch(()=> ''); if (t.trim() === 'SOCIALS' || t.toLowerCase().includes('socials')) { await b.click(); break } }
await p.waitForTimeout(600)
await p.screenshot({ path: '/tmp/lp-open.png', clip: { x: 130, y: 80, width: 800, height: 720 } })
await browser.close()
console.log('done')
