import { ethUsd, fetchLaunches, fetchSwapStats, priceWei, readProvider, toLaunch } from '../loxley'
import { setEthUsd, supplyOf } from '../data/launches'
import { realtime } from '../realtime/store'

/** Pull the live launches from the launchpad and push them into the store.
 *  Safe to call repeatedly (it merges). Returns the count loaded. */
export async function loadChain(): Promise<number> {
  const prov = readProvider()
  const [usd, blockNow, launches] = await Promise.all([
    ethUsd().catch(() => 0),
    prov.getBlockNumber().catch(() => 0),
    fetchLaunches(),
  ])
  if (usd > 0) setEthUsd(usd)
  const ethUsdNow = usd > 0 ? usd : 0

  // current price per token (live), in parallel
  const prices = await Promise.all(
    launches.map((l) => priceWei(l.token).catch(() => l.priceWeiPerToken)),
  )
  const coins = launches.map((l, i) => toLaunch(l, prices[i], blockNow))

  // enrich each card with real change % and volume from its swaps
  await Promise.all(
    coins.map(async (c) => {
      try {
        const s = await fetchSwapStats(c.tokenAddress, supplyOf(c), ethUsdNow)
        c.change24h = s.changePct
        c.volume = s.volumeEth
      } catch {
        /* leave defaults */
      }
    }),
  )

  realtime.loadCoins(coins)
  return coins.length
}
