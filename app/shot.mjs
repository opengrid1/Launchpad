import { chromium } from 'playwright'
const browser = await chromium.launch()
const d = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true })
const p = await d.newPage()
await p.addInitScript(() => {
  const addr = '0x9A04f5eDF3e9574c59e368c39926cC25605151F3'
  window.localStorage.setItem('flatline.connected', '1')
  window.ethereum = {
    request: async ({ method }) => {
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [addr]
      if (method === 'eth_chainId') return '0x3e7'
      return null
    },
    on: () => {}, removeListener: () => {},
  }
})
await p.goto('http://localhost:4184/#/t/0x8960bE42d9dEEb973AB6e2DCa837B3bD78c9d5bD', { waitUntil: 'domcontentloaded', timeout: 30000 })
await p.waitForTimeout(5000)
await p.screenshot({ path: '/tmp/claim2.png', clip: { x: 150, y: 120, width: 760, height: 200 } })
await browser.close()
console.log('done')
