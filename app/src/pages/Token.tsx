import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatEther, isAddress, type Address } from 'viem'
import { useTokenDetail } from '../hooks/useLaunches'
import { useWallet } from '../lib/wallet'
import { useToast, errorMessage } from '../lib/toast'
import { publicClient, explorerAddress } from '../lib/chain'
import { LAUNCHPAD, SWAP_ROUTER, WHYPE, POOL_FEE, launchpadAbi, launchTokenAbi, swapRouterAbi } from '../lib/contracts'
import { quoteBuy, quoteSell, sellCalldata, withSlippage } from '../lib/launchpad'
import { parseTokenURI, type TokenMetadata } from '../lib/metadata'
import { compactNumber, formatPriceHype, formatUnits18, formatUsd6, parseAmount, shortAddress, timeAgo } from '../lib/format'
import { TokenImage } from '../components/TokenImage'

export function TokenPage({ token }: { token: string }) {
  const valid = isAddress(token)
  const { detail, error, refresh } = useTokenDetail(valid ? (token as Address) : null)
  const [meta, setMeta] = useState<TokenMetadata>({})

  useEffect(() => {
    if (!detail) return
    let alive = true
    void parseTokenURI(detail.tokenURI).then((m) => alive && setMeta(m))
    return () => {
      alive = false
    }
  }, [detail])

  if (!valid) return <Message text="That doesn't look like a token address." />
  if (error && !detail) return <Message text={`Failed to load token: ${error}`} />
  if (!detail) return <DetailSkeleton />

  const usdPerHype = Number(detail.hypeUsd6) / 1e6
  const priceUsd = Number(formatEther(detail.priceWei)) * usdPerHype

  return (
    <main className="mt-2">
      <a href="#/" className="font-mono text-xs text-fog-500 no-underline hover:text-fog-300">
        ← all tokens
      </a>

      <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0">
          {/* identity */}
          <section className="flex flex-wrap items-start gap-4">
            <TokenImage src={meta.image} symbol={detail.symbol} size="lg" />
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-bold tracking-tight text-fog-100">
                {detail.name} <span className="ml-1 font-mono text-base font-medium text-fog-500">${detail.symbol}</span>
              </h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-fog-500">
                <button
                  onClick={() => void navigator.clipboard.writeText(detail.token)}
                  className="cursor-pointer hover:text-fog-300"
                  title="Copy token address"
                >
                  {shortAddress(detail.token)} ⧉
                </button>
                <span>by {shortAddress(detail.creator)}</span>
                <span>{timeAgo(detail.createdAt)}</span>
                <a href={explorerAddress(detail.token)} target="_blank" rel="noreferrer" className="text-fog-500 no-underline hover:text-fog-300">
                  explorer ↗
                </a>
              </div>
              <SocialLinks meta={meta} />
            </div>
            {detail.positionWithdrawn && (
              <span className="rounded-lg bg-rose-soft/15 px-2.5 py-1 text-xs font-semibold text-rose-soft ring-1 ring-rose-soft/30">
                Liquidity withdrawn by platform
              </span>
            )}
          </section>

          {meta.description && <p className="mt-4 max-w-2xl text-sm leading-relaxed text-fog-300">{meta.description}</p>}

          {/* stats */}
          <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Price" value={`${formatPriceHype(detail.priceWei)} HYPE`} sub={`$${priceUsd.toLocaleString('en-US', { maximumSignificantDigits: 3 })}`} />
            <Stat label="Market cap" value={formatUsd6(detail.marketCapUsd6)} sub={`${formatUnits18(detail.marketCapHype)} HYPE`} />
            <Stat label="Supply" value={compactNumber(Number(formatEther(detail.totalSupply)))} sub="fixed, 100% pooled" />
            <Stat label="Fees earned" value={`${formatUnits18(detail.lifetimeFeesHype)} HYPE`} sub="70% creator / 30% platform" accent />
          </section>

          {/* chart */}
          <section className="mt-6 overflow-hidden rounded-2xl ring-1 ring-ink-700">
            <iframe
              title="chart"
              src={`https://dexscreener.com/hyperevm/${detail.pool}?embed=1&theme=dark&trades=0&info=0`}
              className="h-[420px] w-full border-0 bg-ink-900"
            />
            <div className="flex items-center justify-between bg-ink-850 px-4 py-2 font-mono text-[11px] text-fog-500">
              <span>pool {shortAddress(detail.pool)}</span>
              <a href={`https://dexscreener.com/hyperevm/${detail.pool}`} target="_blank" rel="noreferrer" className="text-fog-500 no-underline hover:text-fog-300">
                open on DEXScreener ↗ (new pools can take a few minutes to index)
              </a>
            </div>
          </section>
        </div>

        {/* right rail */}
        <div className="space-y-4">
          <TradePanel detail={detail} refresh={refresh} />
          <FeesPanel detail={detail} refresh={refresh} />
        </div>
      </div>
    </main>
  )
}

// ---------------------------------------------------------------- trade panel

function TradePanel({ detail, refresh }: { detail: NonNullable<ReturnType<typeof useTokenDetail>['detail']>; refresh: () => Promise<void> }) {
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
    <section className="rounded-2xl bg-ink-850/80 p-5 ring-1 ring-ink-700">
      <div className="flex gap-1 rounded-xl bg-ink-900 p-1 ring-1 ring-ink-700">
        {(['buy', 'sell'] as const).map((s) => (
          <button
            key={s}
            onClick={() => {
              setSide(s)
              setInput('')
            }}
            className={`flex-1 cursor-pointer rounded-lg py-2 text-sm font-semibold capitalize transition-colors ${
              side === s ? (s === 'buy' ? 'bg-mint-500 text-ink-950' : 'bg-rose-soft text-ink-950') : 'text-fog-300 hover:text-fog-100'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="mt-4 rounded-xl bg-ink-900 p-3.5 ring-1 ring-ink-700 focus-within:ring-mint-500/50">
        <div className="flex items-center justify-between font-mono text-[11px] text-fog-500">
          <span>{side === 'buy' ? 'You pay' : 'You sell'}</span>
          {address && balance !== null && (
            <button
              onClick={() => setInput(side === 'buy' ? trimMax(balance) : formatEther(balance))}
              className="cursor-pointer hover:text-fog-300"
            >
              bal {formatUnits18(balance)} {balanceLabel} · max
            </button>
          )}
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="0.0"
            inputMode="decimal"
            className="w-full bg-transparent font-mono text-xl font-semibold text-fog-100 outline-none placeholder:text-fog-500"
          />
          <span className="font-mono text-sm font-semibold text-fog-300">{balanceLabel}</span>
        </div>
      </div>

      <div className="mt-3 rounded-xl bg-ink-900/60 p-3.5 font-mono text-xs text-fog-500 ring-1 ring-ink-700">
        <div className="flex justify-between">
          <span>{side === 'buy' ? 'You receive (est.)' : 'You receive (est.)'}</span>
          <span className="text-fog-100">
            {quoting ? '…' : quote !== null ? `${formatUnits18(quote)} ${side === 'buy' ? detail.symbol : 'HYPE'}` : '—'}
          </span>
        </div>
        <div className="mt-1.5 flex items-center justify-between">
          <span>Slippage</span>
          <span className="flex gap-1">
            {[50, 100, 300].map((bps) => (
              <button
                key={bps}
                onClick={() => setSlippageBps(bps)}
                className={`cursor-pointer rounded px-1.5 py-0.5 ${slippageBps === bps ? 'bg-mint-500/15 text-mint-300' : 'hover:text-fog-300'}`}
              >
                {bps / 100}%
              </button>
            ))}
          </span>
        </div>
      </div>

      {!address ? (
        <button
          onClick={() => void connect()}
          className="mt-4 w-full cursor-pointer rounded-xl bg-mint-500 py-3 text-sm font-semibold text-ink-950 transition hover:bg-mint-400"
        >
          Connect wallet to trade
        </button>
      ) : needsApproval ? (
        <button
          onClick={() => void approve()}
          disabled={busy !== null}
          className="mt-4 w-full cursor-pointer rounded-xl bg-amber-glow py-3 text-sm font-semibold text-ink-950 transition hover:brightness-110 disabled:opacity-60"
        >
          {busy === 'Approval' ? 'Approving…' : `Approve ${detail.symbol} for trading`}
        </button>
      ) : (
        <button
          onClick={trade}
          disabled={busy !== null || amount === null || amount === 0n || quote === null || insufficient || detail.positionWithdrawn}
          className={`mt-4 w-full cursor-pointer rounded-xl py-3 text-sm font-semibold text-ink-950 transition disabled:cursor-not-allowed disabled:opacity-50 ${
            side === 'buy' ? 'bg-mint-500 hover:bg-mint-400' : 'bg-rose-soft hover:brightness-110'
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
      <p className="mt-2.5 text-center font-mono text-[10px] text-fog-500">
        swaps route directly through HyperSwap V3 · 1% pool fee funds creator rewards
      </p>
    </section>
  )
}

/** Leave a little HYPE behind for gas when maxing the buy input. */
function trimMax(balance: bigint): string {
  const gasReserve = 10n ** 16n // 0.01 HYPE
  return formatEther(balance > gasReserve ? balance - gasReserve : 0n)
}

// ---------------------------------------------------------------- fees panel

function FeesPanel({ detail, refresh }: { detail: NonNullable<ReturnType<typeof useTokenDetail>['detail']>; refresh: () => Promise<void> }) {
  const { address, walletClient, ensureChain } = useWallet()
  const { push } = useToast()
  const [busy, setBusy] = useState<string | null>(null)

  const isCreator = address?.toLowerCase() === detail.creator.toLowerCase()
  const pendingTotal = detail.pendingFeesHype + detail.pendingFeesToken
  const claimable = detail.creatorFeesHype + detail.creatorFeesToken

  async function send(label: string, functionName: 'collectFees' | 'claimCreatorFees') {
    if (!walletClient || !address) return
    setBusy(label)
    try {
      await ensureChain()
      const hash = await walletClient.writeContract({
        address: LAUNCHPAD,
        abi: launchpadAbi,
        functionName,
        args: [detail.token],
        account: address,
        chain: publicClient.chain,
      })
      push({ kind: 'info', title: `${label} submitted`, txHash: hash })
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      push(
        receipt.status === 'success'
          ? { kind: 'success', title: `${label} confirmed`, txHash: hash }
          : { kind: 'error', title: `${label} reverted`, txHash: hash },
      )
      await refresh()
    } catch (err) {
      push({ kind: 'error', title: `${label} failed`, detail: errorMessage(err) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="rounded-2xl bg-ink-850/80 p-5 ring-1 ring-ink-700">
      <h2 className="text-sm font-bold text-fog-100">Creator rewards</h2>
      <dl className="mt-3 space-y-2 font-mono text-xs">
        <Row label="Lifetime fees (HYPE)" value={`${formatUnits18(detail.lifetimeFeesHype)} HYPE`} />
        <Row
          label="Uncollected in pool"
          value={
            pendingTotal > 0n
              ? `${formatUnits18(detail.pendingFeesHype)} HYPE + ${formatUnits18(detail.pendingFeesToken)} ${detail.symbol}`
              : '—'
          }
        />
        <Row
          label="Creator claimable"
          value={
            claimable > 0n
              ? `${formatUnits18(detail.creatorFeesHype)} HYPE + ${formatUnits18(detail.creatorFeesToken)} ${detail.symbol}`
              : '—'
          }
        />
      </dl>

      {pendingTotal > 0n && !detail.positionWithdrawn && (
        <button
          onClick={() => void send('Collect fees', 'collectFees')}
          disabled={busy !== null || !address}
          className="mt-4 w-full cursor-pointer rounded-xl bg-ink-700 py-2.5 text-sm font-semibold text-fog-100 ring-1 ring-ink-600 transition hover:ring-mint-500/50 disabled:opacity-50"
        >
          {busy === 'Collect fees' ? 'Collecting…' : 'Collect fees into split (anyone can)'}
        </button>
      )}
      {isCreator && claimable > 0n && (
        <button
          onClick={() => void send('Claim rewards', 'claimCreatorFees')}
          disabled={busy !== null}
          className="mt-2.5 w-full cursor-pointer rounded-xl bg-mint-500 py-2.5 text-sm font-semibold text-ink-950 transition hover:bg-mint-400 disabled:opacity-60"
        >
          {busy === 'Claim rewards' ? 'Claiming…' : 'Claim my 70%'}
        </button>
      )}
      <p className="mt-3 font-mono text-[10px] leading-relaxed text-fog-500">
        Every swap pays a 1% pool fee. Collect moves accrued fees into the 70/30 split; the creator then claims in native
        HYPE.
      </p>
    </section>
  )
}

// ---------------------------------------------------------------- bits

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="rounded-xl bg-ink-850/80 p-3.5 ring-1 ring-ink-700">
      <p className="font-mono text-[10px] uppercase tracking-wider text-fog-500">{label}</p>
      <p className={`mt-1 truncate font-mono text-[15px] font-semibold ${accent ? 'text-mint-400' : 'text-fog-100'}`}>{value}</p>
      {sub && <p className="mt-0.5 truncate font-mono text-[10px] text-fog-500">{sub}</p>}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-fog-500">{label}</dt>
      <dd className="text-right text-fog-100">{value}</dd>
    </div>
  )
}

function SocialLinks({ meta }: { meta: TokenMetadata }) {
  const links = useMemo(
    () =>
      [
        ['website', meta.website],
        ['x / twitter', meta.twitter],
        ['telegram', meta.telegram],
      ].filter((entry): entry is [string, string] => !!entry[1]),
    [meta],
  )
  if (links.length === 0) return null
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {links.map(([label, href]) => (
        <a
          key={label}
          href={href.startsWith('http') ? href : `https://${href}`}
          target="_blank"
          rel="noreferrer"
          className="rounded-lg bg-ink-800 px-2.5 py-1 font-mono text-[11px] text-fog-300 no-underline ring-1 ring-ink-700 transition hover:text-mint-300 hover:ring-mint-500/40"
        >
          {label} ↗
        </a>
      ))}
    </div>
  )
}

function Message({ text }: { text: string }) {
  return (
    <main className="mt-16 text-center">
      <p className="text-fog-300">{text}</p>
      <a href="#/" className="mt-3 inline-block font-mono text-xs text-mint-400 no-underline hover:text-mint-300">
        ← back to the board
      </a>
    </main>
  )
}

function DetailSkeleton() {
  return (
    <main className="mt-6 animate-pulse">
      <div className="flex items-center gap-4">
        <div className="h-16 w-16 rounded-2xl bg-ink-700" />
        <div className="space-y-2">
          <div className="h-5 w-48 rounded bg-ink-700" />
          <div className="h-3 w-72 rounded bg-ink-700/70" />
        </div>
      </div>
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-20 rounded-xl bg-ink-850/60 ring-1 ring-ink-700" />
        ))}
      </div>
      <div className="mt-6 h-[420px] rounded-2xl bg-ink-850/60 ring-1 ring-ink-700" />
    </main>
  )
}
