import { ethUsd, fetchLaunches, fetchSwapStats, priceWei, readProvider, toLaunch } from '../loxley'
import { setEthUsd, supplyOf } from '../data/launches'
import { realtime } from '../realtime/store'

/** Pull the live launches from the launchpad and push them into the store.
 *  Safe to call repeatedly (it merges). Returns the count loaded. */
export async function loadChain(): Promise<number> {
  const prov = readProvider()
  const [usd, launches] = await Promise.all([
    ethUsd().catch(() => 0),
    fetchLaunches(),
  ])
  if (usd > 0) setEthUsd(usd)
  const ethUsdNow = usd > 0 ? usd : 0

  // current price + real launch timestamp per token, in parallel
  const [prices, launchTimes] = await Promise.all([
    Promise.all(launches.map((l) => priceWei(l.token).catch(() => l.priceWeiPerToken))),
    Promise.all(launches.map((l) => prov.getBlock(l.block).then((b) => b?.timestamp ?? 0).catch(() => 0))),
  ])
  const coins = launches.map((l, i) => toLaunch(l, prices[i], launchTimes[i]))

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
