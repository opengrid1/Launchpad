import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatEther, isAddress, type Address } from 'viem'
import { useTokenDetail } from '../hooks/useLaunches'
import { useWallet } from '../lib/wallet'
import { useToast, errorMessage } from '../lib/toast'
import { publicClient, explorerAddress } from '../lib/chain'
import { LAUNCHPAD, SWAP_ROUTER, WHYPE, POOL_FEE, launchpadAbi, launchTokenAbi, swapRouterAbi } from '../lib/contracts'
import { quoteBuy, quoteSell, sellCalldata, withSlippage } from '../lib/launchpad'
import { parseTokenURI, type TokenMetadata } from '../lib/metadata'
import { formatPriceHype, formatUnits18, formatUsd6, parseAmount, shortAddress, timeAgo } from '../lib/format'
import { TokenImage } from '../components/TokenImage'

type Detail = NonNullable<ReturnType<typeof useTokenDetail>['detail']>

/** Creator's currently-claimable fees in HYPE: collected-but-unclaimed + 70% of what's
 *  still uncollected in the pool (token side valued at spot). Public, shown to everyone. */
function unclaimedFeesHype(d: Detail): bigint {
  const hype = d.creatorFeesHype + (d.pendingFeesHype * 7000n) / 10000n
  const token = d.creatorFeesToken + (d.pendingFeesToken * 7000n) / 10000n
  return hype + (token * d.priceWei) / 10n ** 18n
}

/** Fee amounts to 4 decimals; dust rounds to "0". */
function fmtHype(wei: bigint): string {
  return formatUnits18(wei, { compact: false, digits: 4 })
}

/** Below this (0.00001 HYPE) we treat a balance as nothing to claim. */
const DUST = 10n ** 13n

export function TokenPage({ token }: { token: string }) {
  const valid = isAddress(token)
  const { detail, error, refresh } = useTokenDetail(valid ? (token as Address) : null)
  const [meta, setMeta] = useState<TokenMetadata>({})
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!detail) return
    let alive = true
    void parseTokenURI(detail.tokenURI).then((m) => alive && setMeta(m))
    return () => {
      alive = false
    }
  }, [detail])

  if (!valid) return <Message text="Invalid token address" />
  if (error && !detail) return <Message text={error} />
  if (!detail) return <DetailSkeleton />

  const usdPerHype = Number(detail.hypeUsd6) / 1e6
  const priceUsd = Number(formatEther(detail.priceWei)) * usdPerHype
  const feesUsd = (detail.lifetimeFeesHype * detail.hypeUsd6) / 10n ** 18n
  const liquidityUsd6 = (detail.liquidityHype * detail.hypeUsd6) / 10n ** 18n
  const unclaimedHype = unclaimedFeesHype(detail)
  const unclaimedUsd6 = (unclaimedHype * detail.hypeUsd6) / 10n ** 18n
  const change =
    detail.startMcUsd6 > 0n ? Number(detail.marketCapUsd6) / Number(detail.startMcUsd6) - 1 : null

  return (
    <main className="mt-5">
      <a href="#/" className="font-mono text-xs text-ghost no-underline transition-colors hover:text-dim">
        ← Board
      </a>

      {/* hero */}
      <section className="elev mt-4 overflow-hidden rounded-2xl ring-1 ring-hair">
        <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="flex min-w-0 items-center gap-4">
            <TokenImage src={meta.image} symbol={detail.symbol} size="lg" />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-xl font-semibold tracking-tight text-fg sm:text-2xl">{detail.name}</h1>
                <span className="font-mono text-sm font-medium text-ghost">${detail.symbol}</span>
                {detail.positionWithdrawn && (
                  <span className="rounded-md bg-downsoft px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-down">Delisted</span>
                )}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-xs text-ghost">
                <button
                  onClick={() => {
                    void navigator.clipboard.writeText(detail.token)
                    setCopied(true)
                    window.setTimeout(() => setCopied(false), 1500)
                  }}
                  className={`cursor-pointer rounded bg-panel2 px-2 py-0.5 transition-colors ${copied ? 'text-up' : 'hover:text-dim'}`}
                >
                  {copied ? 'copied ✓' : `${shortAddress(detail.token)} ⧉`}
                </button>
                <span>by {shortAddress(detail.creator)}</span>
                <span>·</span>
                <span>{timeAgo(detail.createdAt)}</span>
                <a href={explorerAddress(detail.token)} target="_blank" rel="noreferrer" className="text-ghost no-underline transition-colors hover:text-dim">
                  explorer ↗
                </a>
              </div>
              <SocialLinks meta={meta} />
            </div>
          </div>

          {/* price block */}
          <div className="flex flex-col gap-3 sm:items-end">
            <div className="flex items-center justify-between gap-4 sm:justify-end">
              <div className="sm:text-right">
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ghost">Price</p>
                <p className="mt-1 font-mono text-xl font-semibold text-fg sm:text-2xl">${priceUsd.toLocaleString('en-US', { maximumSignificantDigits: 4 })}</p>
                <p className="font-mono text-[11px] text-ghost">{formatPriceHype(detail.priceWei)} HYPE</p>
              </div>
              {change !== null && (
                <span
                  className={`rounded-lg px-2.5 py-1 font-mono text-sm font-semibold ${change >= 0 ? 'bg-upsoft text-up' : 'bg-downsoft text-down'}`}
                  title="vs launch market cap"
                >
                  {change >= 0 ? '▲' : '▼'} {Math.abs(change * 100).toFixed(change >= 1 ? 0 : 1)}%
                </span>
              )}
            </div>
            {!detail.positionWithdrawn && <RewardsControl detail={detail} refresh={refresh} />}
          </div>
        </div>

        {meta.description && <p className="px-5 pb-1 text-sm leading-relaxed text-dim sm:px-6">{meta.description}</p>}

        {/* stat bar — one cohesive strip, divided */}
        <div className="grid grid-cols-2 border-t border-hair sm:grid-cols-4">
          <Metric label="Market cap" value={formatUsd6(detail.marketCapUsd6)} sub={`${formatUnits18(detail.marketCapHype, { compact: true })} HYPE`} />
          <Metric label="Liquidity" value={formatUsd6(liquidityUsd6)} sub={`${formatUnits18(detail.liquidityHype, { compact: true })} HYPE`} border />
          <Metric label="Fees earned" value={formatUsd6(feesUsd)} sub={`${fmtHype(detail.lifetimeFeesHype)} HYPE`} borderSm />
          <Metric label="Unclaimed" value={formatUsd6(unclaimedUsd6)} sub={`${fmtHype(unclaimedHype)} HYPE`} accent border borderSm />
        </div>
      </section>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]">
        {/* chart */}
        <section className="elev overflow-hidden rounded-2xl ring-1 ring-hair">
          <iframe
            title="chart"
            src={`https://dexscreener.com/hyperevm/${detail.pool}?embed=1&theme=dark&trades=0&info=0`}
            className="h-[440px] w-full border-0 sm:h-[560px]"
          />
          <div className="flex items-center justify-between border-t border-hair px-4 py-2 font-mono text-[11px] text-ghost">
            <span>pool {shortAddress(detail.pool)}</span>
            <a href={`https://dexscreener.com/hyperevm/${detail.pool}`} target="_blank" rel="noreferrer" className="text-ghost no-underline hover:text-dim">
              DEXScreener ↗
            </a>
          </div>
        </section>

        {/* right rail — desktop only; mobile uses the bottom-sheet */}
        <div className="hidden lg:block">
          <TradePanel detail={detail} refresh={refresh} />
        </div>
      </div>

      {/* mobile: sticky Trade bar + bottom-sheet */}
      <MobileTrade detail={detail} refresh={refresh} />
    </main>
  )
}

/** Sticky bottom Trade button (mobile) that opens the trade panel as a bottom sheet. */
function MobileTrade({ detail, refresh }: { detail: NonNullable<ReturnType<typeof useTokenDetail>['detail']>; refresh: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="lg:hidden">
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-hair bg-base/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md">
        <button
          onClick={() => setOpen(true)}
          disabled={detail.positionWithdrawn}
          className="btn-primary w-full cursor-pointer rounded-xl py-3 text-sm font-semibold disabled:opacity-40"
        >
          {detail.positionWithdrawn ? 'Trading disabled' : `Trade ${detail.symbol}`}
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <div className="rise-in relative max-h-[88vh] overflow-y-auto rounded-t-2xl bg-panel p-4 pb-[max(1rem,env(safe-area-inset-bottom))] ring-1 ring-hair">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-hair2" />
            <button
              onClick={() => setOpen(false)}
              className="absolute right-4 top-4 cursor-pointer text-ghost hover:text-fg"
              aria-label="Close"
            >
              ✕
            </button>
            <TradePanel detail={detail} refresh={refresh} bare />
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- trade panel

function TradePanel({ detail, refresh, bare }: { detail: NonNullable<ReturnType<typeof useTokenDetail>['detail']>; refresh: () => Promise<void>; bare?: boolean }) {
  const { address, walletClient, connect, ensureChain } = useWallet()
  const { push } = useToast()
  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  const [input, setInput] = useState('')
  const [slippageBps, setSlippageBps] = useState(100)
  const [quote, setQuote] = useState<bigint | null>(null)
  const [quoting, setQuoting] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [hypeBalance, setHypeBalance] = useState<bigint | null>(null)
  const [tokenBalance, setTokenBalance] = useState<bigint | null>(null)
  const [allowance, setAllowance] = useState<bigint | null>(null)

  const amount = parseAmount(input)
  const token = detail.token

  const loadBalances = useCallback(async () => {
    if (!address) {
      setHypeBalance(null)
      setTokenBalance(null)
      setAllowance(null)
      return
    }
    const [hype, bal, allow] = await Promise.all([
      publicClient.getBalance({ address }),
      publicClient.readContract({ address: token, abi: launchTokenAbi, functionName: 'balanceOf', args: [address] }),
      publicClient.readContract({ address: token, abi: launchTokenAbi, functionName: 'allowance', args: [address, SWAP_ROUTER] }),
    ])
    setHypeBalance(hype)
    setTokenBalance(bal)
    setAllowance(allow)
  }, [address, token])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadBalances(), 0)
    return () => window.clearTimeout(timer)
  }, [loadBalances])

  const needsApproval = side === 'sell' && amount !== null && allowance !== null && allowance < amount

  // Debounced quoting.
  useEffect(() => {
    let alive = true
    const timer = window.setTimeout(async () => {
      if (!alive) return
      if (amount === null || amount === 0n || detail.positionWithdrawn) {
        setQuote(null)
        setQuoting(false)
        return
      }
      setQuoting(true)
      try {
        let out: bigint
        if (side === 'buy') {
          out = await quoteBuy(token, amount, address ?? undefined)
        } else if (address && allowance !== null && allowance >= amount && tokenBalance !== null && tokenBalance >= amount) {
          out = await quoteSell(token, amount, address)
        } else {
          // No allowance/balance to simulate with — estimate off spot price minus the 1% pool fee.
          out = (amount * detail.priceWei * 99n) / (10n ** 18n * 100n)
        }
        if (alive) setQuote(out)
      } catch {
        if (alive) setQuote(null)
      } finally {
        if (alive) setQuoting(false)
      }
    }, 300)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [amount, side, token, address, allowance, tokenBalance, detail.priceWei, detail.positionWithdrawn])

  const insufficient =
    amount !== null &&
    ((side === 'buy' && hypeBalance !== null && amount > hypeBalance) ||
      (side === 'sell' && tokenBalance !== null && amount > tokenBalance))

  // How far the fill deviates from spot (after the 1% pool fee).
  const priceImpact = useMemo(() => {
    if (quote === null || amount === null || amount === 0n || detail.priceWei === 0n) return null
    const ideal =
      side === 'buy'
        ? (amount * 10n ** 18n * 99n) / (detail.priceWei * 100n)
        : (amount * detail.priceWei * 99n) / (10n ** 18n * 100n)
    if (ideal === 0n) return null
    return Math.max(0, 1 - Number(quote) / Number(ideal))
  }, [quote, amount, side, detail.priceWei])

  const receiveUsd = useMemo(() => {
    if (quote === null) return null
    const usdPerHype = Number(detail.hypeUsd6) / 1e6
    return side === 'buy'
      ? Number(formatEther(quote)) * Number(formatEther(detail.priceWei)) * usdPerHype
      : Number(formatEther(quote)) * usdPerHype
  }, [quote, side, detail.hypeUsd6, detail.priceWei])

  async function run(label: string, fn: () => Promise<`0x${string}`>) {
    if (!walletClient || !address) return
    setBusy(label)
    try {
      await ensureChain()
      const hash = await fn()
      push({ kind: 'info', title: `${label} submitted`, txHash: hash })
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      if (receipt.status === 'success') {
        push({ kind: 'success', title: `${label} confirmed`, txHash: hash })
      } else {
        push({ kind: 'error', title: `${label} reverted`, txHash: hash })
      }
      await Promise.all([refresh(), loadBalances()])
      if (label !== 'Approval') setInput('')
    } catch (err) {
      push({ kind: 'error', title: `${label} failed`, detail: errorMessage(err) })
    } finally {
      setBusy(null)
    }
  }

  const approve = () =>
    run('Approval', () =>
      walletClient!.writeContract({
        address: token,
        abi: launchTokenAbi,
        functionName: 'approve',
        args: [SWAP_ROUTER, 2n ** 256n - 1n],
        account: address!,
        chain: publicClient.chain,
      }),
    )

  const trade = () => {
    if (amount === null || quote === null) return
    const minOut = withSlippage(quote, slippageBps)
    if (side === 'buy') {
      void run('Buy', () =>
        walletClient!.writeContract({
          address: SWAP_ROUTER,
          abi: swapRouterAbi,
          functionName: 'exactInputSingle',
          args: [
            {
              tokenIn: WHYPE,
              tokenOut: token,
              fee: POOL_FEE,
              recipient: address!,
              deadline: BigInt(Math.floor(Date.now() / 1000) + 600),
              amountIn: amount,
              amountOutMinimum: minOut,
              sqrtPriceLimitX96: 0n,
            },
          ],
          value: amount,
          account: address!,
          chain: publicClient.chain,
        }),
      )
    } else {
      void run('Sell', () =>
        walletClient!.writeContract({
          address: SWAP_ROUTER,
          abi: swapRouterAbi,
          functionName: 'multicall',
          args: [sellCalldata(token, amount, minOut, address!)],
          account: address!,
          chain: publicClient.chain,
        }),
      )
    }
  }

  const balance = side === 'buy' ? hypeBalance : tokenBalance
  const balanceLabel = side === 'buy' ? 'HYPE' : detail.symbol

  return (
    <section className={bare ? '' : 'elev rounded-2xl p-5 ring-1 ring-hair'}>
      <div className="flex gap-1 rounded-xl bg-base p-1 ring-1 ring-hair">
        {(['buy', 'sell'] as const).map((s) => (
          <button
            key={s}
            onClick={() => {
              setSide(s)
              setInput('')
            }}
            className={`flex-1 cursor-pointer rounded-lg py-2 text-sm font-bold capitalize transition-colors ${
              side === s ? (s === 'buy' ? 'btn-primary' : 'bg-down text-white') : 'text-ghost hover:text-dim'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="mt-4 rounded-xl bg-base p-3.5 ring-1 ring-hair focus-within:ring-acc/50">
        <div className="flex items-center justify-between font-mono text-[11px] text-ghost">
          <span>{side === 'buy' ? 'Pay' : 'Sell'}</span>
          {address && balance !== null && (
            <button
              onClick={() => setInput(side === 'buy' ? trimMax(balance) : formatEther(balance))}
              className="cursor-pointer hover:text-dim"
            >
              {formatUnits18(balance)} {balanceLabel} · max
            </button>
          )}
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="0.0"
            inputMode="decimal"
            className="w-full bg-transparent font-mono text-xl font-semibold text-fg outline-none placeholder:text-ghost"
          />
          <span className="font-mono text-sm font-semibold text-dim">{balanceLabel}</span>
        </div>
        {side === 'buy' && amount !== null && amount > 0n && (
          <p className="mt-1 font-mono text-[10px] text-ghost">
            ≈ ${((Number(formatEther(amount)) * Number(detail.hypeUsd6)) / 1e6).toLocaleString('en-US', { maximumFractionDigits: 2 })}
          </p>
        )}
      </div>

      <div className="mt-2.5 flex gap-1.5">
        {side === 'buy'
          ? (['0.1', '0.5', '1', '5'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setInput(v)}
                className={`flex-1 cursor-pointer rounded-lg py-1.5 font-mono text-[11px] transition-colors ${
                  input === v ? 'bg-accsoft text-acc' : 'text-ghost ring-1 ring-hair hover:text-dim'
                }`}
              >
                {v}
              </button>
            ))
          : ([25, 50, 75, 100] as const).map((pct) => (
              <button
                key={pct}
                onClick={() => tokenBalance !== null && setInput(formatEther((tokenBalance * BigInt(pct)) / 100n))}
                disabled={tokenBalance === null || tokenBalance === 0n}
                className="flex-1 cursor-pointer rounded-lg py-1.5 font-mono text-[11px] text-ghost ring-1 ring-hair transition-colors hover:text-dim disabled:cursor-not-allowed disabled:opacity-40"
              >
                {pct}%
              </button>
            ))}
      </div>

      <div className="mt-3 space-y-1.5 rounded-xl p-3.5 font-mono text-xs text-ghost ring-1 ring-hair">
        <div className="flex justify-between">
          <span>Receive</span>
          <span className="text-right text-fg">
            {quoting ? '…' : quote !== null ? `${formatUnits18(quote)} ${side === 'buy' ? detail.symbol : 'HYPE'}` : '—'}
            {!quoting && receiveUsd !== null && (
              <span className="ml-1.5 text-ghost">(${receiveUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })})</span>
            )}
          </span>
        </div>
        {priceImpact !== null && !quoting && (
          <div className="flex justify-between">
            <span>Impact</span>
            <span className={priceImpact > 0.05 ? 'text-down' : priceImpact > 0.02 ? 'text-amber' : 'text-fg'}>
              {priceImpact < 0.0001 ? '<0.01%' : `${(priceImpact * 100).toFixed(2)}%`}
            </span>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span>Slippage</span>
          <span className="flex gap-1">
            {[50, 100, 300].map((bps) => (
              <button
                key={bps}
                onClick={() => setSlippageBps(bps)}
                className={`cursor-pointer rounded px-1.5 py-0.5 ${slippageBps === bps ? 'bg-accsoft text-acc' : 'hover:text-dim'}`}
              >
                {bps / 100}%
              </button>
            ))}
          </span>
        </div>
        <div className="flex justify-between border-t border-hair pt-1.5">
          <span>Rate</span>
          <span className="text-fg">1 {detail.symbol} = {formatPriceHype(detail.priceWei)} HYPE</span>
        </div>
      </div>

      {!address ? (
        <button
          onClick={() => void connect()}
          className="btn-primary mt-4 w-full cursor-pointer rounded-xl py-3 text-sm font-semibold"
        >
          Connect
        </button>
      ) : needsApproval ? (
        <button
          onClick={() => void approve()}
          disabled={busy !== null}
          className="mt-4 w-full cursor-pointer rounded-xl py-3 text-sm font-bold text-fg ring-1 ring-hair2 transition hover:bg-panel2 disabled:opacity-60"
        >
          {busy === 'Approval' ? 'Approving…' : `Approve ${detail.symbol}`}
        </button>
      ) : (
        <button
          onClick={trade}
          disabled={busy !== null || amount === null || amount === 0n || quote === null || insufficient || detail.positionWithdrawn}
          className={`mt-4 w-full cursor-pointer rounded-xl py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
            side === 'buy' ? 'btn-primary' : 'bg-down text-white hover:brightness-110'
          }`}
        >
          {busy
            ? `${busy}…`
            : insufficient
              ? `Insufficient ${balanceLabel}`
              : detail.positionWithdrawn
                ? 'Trading disabled'
                : side === 'buy'
                  ? `Buy ${detail.symbol}`
                  : `Sell ${detail.symbol}`}
        </button>
      )}
    </section>
  )
}

/** Leave a little HYPE behind for gas when maxing the buy input. */
function trimMax(balance: bigint): string {
  const gasReserve = 10n ** 16n // 0.01 HYPE
  return formatEther(balance > gasReserve ? balance - gasReserve : 0n)
}

// ---------------------------------------------------------------- fees panel

/** Compact creator rewards control — one button that collects (if needed) then claims. */
function RewardsControl({ detail, refresh }: { detail: NonNullable<ReturnType<typeof useTokenDetail>['detail']>; refresh: () => Promise<void> }) {
  const { address, walletClient, ensureChain } = useWallet()
  const { push } = useToast()
  const [busy, setBusy] = useState<string | null>(null)

  const isCreator = address?.toLowerCase() === detail.creator.toLowerCase()
  const pendingTotal = detail.pendingFeesHype + detail.pendingFeesToken

  async function write(functionName: 'collectFees' | 'claimCreatorFees') {
    const hash = await walletClient!.writeContract({
      address: LAUNCHPAD,
      abi: launchpadAbi,
      functionName,
      args: [detail.token],
      account: address!,
      chain: publicClient.chain,
    })
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    return { hash, ok: receipt.status === 'success' }
  }

  /** One tap: realize any pool fees into the split, then send the creator's share to their wallet. */
  async function claim() {
    if (!walletClient || !address) return
    try {
      await ensureChain()

      // Step 1 — pull uncollected pool fees into the 70/30 split (only if there are any).
      if (pendingTotal > 0n) {
        setBusy('Collecting')
        const collected = await write('collectFees')
        push(
          collected.ok
            ? { kind: 'info', title: 'Fees collected', txHash: collected.hash }
            : { kind: 'error', title: 'Collect reverted', txHash: collected.hash },
        )
        if (!collected.ok) return
      }

      // Step 2 — claim the creator balance (re-read it post-collect).
      setBusy('Claiming')
      const [feeHype, feeToken] = await Promise.all([
        publicClient.readContract({ address: LAUNCHPAD, abi: launchpadAbi, functionName: 'creatorFeesHype', args: [detail.token] }),
        publicClient.readContract({ address: LAUNCHPAD, abi: launchpadAbi, functionName: 'creatorFeesToken', args: [detail.token] }),
      ])
      if (feeHype === 0n && feeToken === 0n) {
        push({ kind: 'info', title: 'Nothing to claim yet' })
        return
      }
      const claimed = await write('claimCreatorFees')
      push(
        claimed.ok
          ? { kind: 'success', title: 'Claimed to your wallet', txHash: claimed.hash }
          : { kind: 'error', title: 'Claim reverted', txHash: claimed.hash },
      )
    } catch (err) {
      push({ kind: 'error', title: 'Claim failed', detail: errorMessage(err) })
    } finally {
      setBusy(null)
      await refresh()
    }
  }

  // Only the creator can claim; show them the button at all times so it is findable.
  if (!isCreator) return null

  const unclaimed = unclaimedFeesHype(detail)
  const nothing = unclaimed < DUST

  return (
    <button
      onClick={() => void claim()}
      disabled={busy !== null || nothing}
      className="btn-primary w-full shrink-0 cursor-pointer self-start rounded-lg px-5 py-2.5 text-sm font-semibold disabled:opacity-40 sm:w-auto"
    >
      {busy ?? (nothing ? 'Nothing to claim' : `Claim ${fmtHype(unclaimed)} HYPE`)}
    </button>
  )
}

// ---------------------------------------------------------------- bits

function Metric({ label, value, sub, accent, border, borderSm }: { label: string; value: string; sub?: string; accent?: boolean; border?: boolean; borderSm?: boolean }) {
  return (
    <div className={`p-4 sm:p-5 ${border ? 'border-l border-hair' : ''} ${borderSm ? 'border-t border-hair sm:border-t-0 sm:border-l' : ''}`}>
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ghost">{label}</p>
      <p className={`mt-1.5 truncate font-mono text-[15px] font-semibold sm:text-base ${accent ? 'text-acc' : 'text-fg'}`}>{value}</p>
      {sub && <p className="mt-0.5 truncate font-mono text-[10px] text-ghost">{sub}</p>}
    </div>
  )
}

function SocialLinks({ meta }: { meta: TokenMetadata }) {
  const links = useMemo(
    () =>
      [
        ['site', meta.website],
        ['x', meta.twitter],
        ['tg', meta.telegram],
      ].filter((entry): entry is [string, string] => !!entry[1]),
    [meta],
  )
  if (links.length === 0) return null
  return (
    <div className="mt-2.5 flex flex-wrap gap-2">
      {links.map(([label, href]) => (
        <a
          key={label}
          href={href.startsWith('http') ? href : `https://${href}`}
          target="_blank"
          rel="noreferrer"
          className="rounded-lg px-2.5 py-1 font-mono text-[11px] text-dim no-underline ring-1 ring-hair transition hover:text-acc hover:ring-acc/40"
        >
          {label} ↗
        </a>
      ))}
    </div>
  )
}

function Message({ text }: { text: string }) {
  return (
    <main className="mt-20 text-center">
      <p className="font-mono text-sm text-ghost">{text}</p>
      <a href="#/" className="mt-3 inline-block font-mono text-xs text-acc no-underline hover:text-accdeep">
        ← Board
      </a>
    </main>
  )
}

function DetailSkeleton() {
  return (
    <main className="mt-8">
      <div className="flex items-center gap-4">
        <div className="shimmer h-16 w-16 rounded-2xl" />
        <div className="space-y-2">
          <div className="shimmer h-5 w-48 rounded" />
          <div className="shimmer h-3 w-72 rounded" />
        </div>
      </div>
      <div className="shimmer mt-7 h-20 rounded-2xl" />
      <div className="shimmer mt-5 h-[420px] rounded-2xl" />
    </main>
  )
}
