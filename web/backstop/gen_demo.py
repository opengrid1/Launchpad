#!/usr/bin/env python3
"""Sample strategy coins for the Backstop preview (site/demo.json).

Each coin is simulated hour by hour so its numbers agree with each other: trading
volume pays the 2% fee, the creator's split fills the vault and the buyback fund,
every 20% dip in the price spends half the fund on coins that are burned, and a
vault that is up by its take-profit target sells the gain into a buyback and burn.
Pair prices end at their real price when this was generated (prices.json).
"""
import hashlib, json, math, os, random, time

HERE = os.path.dirname(os.path.abspath(__file__))
PRICES = json.load(open(os.path.join(HERE, 'prices.json')))
TOK = {t['symbol']: t for t in json.load(open(os.path.join(HERE, 'tokens.json')))}
SUPPLY = 1e9
START_MC = 5000
NOW = int(time.time()) // 3600 * 3600


def addr(*parts):
    return '0x' + hashlib.sha256('|'.join(map(str, parts)).encode()).hexdigest()[:40]


def usd_of(sym):
    t = TOK[sym]
    return PRICES[t['address'].lower()]['usd']


COINS = [
    # name, symbol, pair, split (creator, holders, vault, buyback) in bps, take profit %, redeem, rewards, basket, age days, final mcap, vol, pair drift, seed
    dict(name='Frog Reserve', symbol='FROGR', pair='PEPE', split=(30, 0, 70, 50), tp=50, redeem=True, rewards='none', basket=[], age=12, mc=1_840_000, vol=0.055, drift=1.25, seed=7,
         desc='A PEPE strategy. Half the fee stacks PEPE in a vault nobody can withdraw from, the rest buys FROGR back on every 20% dip and burns it.'),
    dict(name='Index 6900', symbol='IDX69', pair='SPX', split=(30, 0, 60, 60), tp=50, redeem=False, rewards='none', basket=[], age=8, mc=942_000, vol=0.06, drift=1.8, seed=11,
         desc='Holds SPX6900 and sells the gains into burns. The vault takes profit at +50% and keeps its principal.'),
    dict(name='Hard Money', symbol='HARD', pair='WBTC', split=(20, 50, 80, 0), tp=0, redeem=True, rewards='eth', basket=[], age=9, mc=618_000, vol=0.035, drift=1.04, seed=3,
         desc='Every trade buys bitcoin for the vault. Holders are paid in ETH and can redeem their coins for their share of the WBTC at any time.'),
    dict(name='Mog Treasury', symbol='MOGT', pair='MOG', split=(30, 20, 60, 40), tp=100, redeem=False, rewards='pair', basket=[], age=10, mc=412_000, vol=0.07, drift=0.92, seed=5,
         desc='A treasury of MOG that only grows. Takes profit once the vault doubles.'),
    dict(name='Staked Strategy', symbol='STKD', pair='wstETH', split=(30, 60, 60, 0), tp=0, redeem=True, rewards='eth', basket=[], age=7, mc=331_000, vol=0.04, drift=1.02, seed=21,
         desc='Backs every coin with staked ETH that keeps earning staking yield inside the vault. Redeemable, holders paid in ETH.'),
    dict(name='Dip Eater', symbol='DIPS', pair='ETH', split=(40, 0, 0, 110), tp=0, redeem=False, rewards='none', basket=[], age=6, mc=286_000, vol=0.085, drift=1.0, seed=13,
         desc='No vault, all buyback. Most of the fee waits in the fund for the next 20% dip.'),
    dict(name='Gold Floor', symbol='GOLDF', pair='PAXG', split=(30, 40, 80, 0), tp=0, redeem=True, rewards='basket', basket=['PAXG', 'XAUt'], age=5, mc=209_000, vol=0.03, drift=1.03, seed=17,
         desc='A coin backed by tokenized gold. Holders earn PAXG and XAUt; anyone can redeem coins for their share of the vault.'),
    dict(name='Neiro Vault', symbol='NVLT', pair='NEIRO', split=(30, 30, 50, 40), tp=25, redeem=False, rewards='pair', basket=[], age=4, mc=158_000, vol=0.075, drift=1.5, seed=29,
         desc='Stacks NEIRO, takes profit at +25% and burns NVLT with it.'),
    dict(name='Link Stack', symbol='LSTK', pair='LINK', split=(30, 70, 50, 0), tp=0, redeem=False, rewards='basket', basket=['LINK', 'AAVE', 'UNI'], age=2, mc=124_000, vol=0.05, drift=1.06, seed=31,
         desc='Holder rewards paid in a DeFi basket: LINK, AAVE and UNI.'),
    dict(name='Stable Floor', symbol='STBL', pair='USDC', split=(50, 0, 100, 0), tp=0, redeem=True, rewards='none', basket=[], age=3, mc=96_400, vol=0.025, drift=1.0, seed=37,
         desc='Two thirds of the fee goes into a USDC vault. Burn coins any time to take your share.'),
    dict(name='Shib Shelter', symbol='SHLTR', pair='SHIB', split=(40, 0, 50, 60), tp=50, redeem=False, rewards='none', basket=[], age=1.2, mc=57_800, vol=0.09, drift=1.0, seed=41,
         desc='Fresh SHIB strategy: vault plus dip buybacks.'),
]

WALLETS = [addr('wallet', i) for i in range(400)]


def simulate(c):
    rnd = random.Random(c['seed'])
    hours = max(12, int(c['age'] * 24))
    t0 = NOW - hours * 3600
    pair_now = usd_of(c['pair'])
    # coin price path: a trend from the start cap to today's cap with noise, plus dips
    p0, p1 = START_MC / SUPPLY, c['mc'] / SUPPLY
    noise = [0.0]
    for _ in range(hours):
        noise.append(noise[-1] + rnd.gauss(0, c['vol'] * 0.75))
    # Brownian bridge: pin both ends
    bridge = [noise[i] - noise[-1] * i / hours for i in range(hours + 1)]
    # fast early run-up, slower later
    shape = [1 - math.exp(-5 * i / hours) for i in range(hours + 1)]
    shape = [s / shape[-1] for s in shape]
    lp = [math.log(p0) + (math.log(p1) - math.log(p0)) * shape[i] + bridge[i] * min(1, i / 6) for i in range(hours + 1)]
    # pair price path ending at the real price today
    pn = [0.0]
    pv = 0.004 if c['pair'] in ('USDC',) else 0.012
    for _ in range(hours):
        pn.append(pn[-1] + rnd.gauss(0, pv if c['pair'] != 'USDC' else 0.0002))
    pb = [pn[i] - pn[-1] * i / hours for i in range(hours + 1)]
    pair_px = [pair_now / c['drift'] * math.exp(math.log(c['drift']) * (i / hours) ** 3 + pb[i]) for i in range(hours + 1)]
    if c['pair'] == 'USDC':
        pair_px = [pair_now] * (hours + 1)

    cr, ho, va, bb = c['split']
    burned = 0.0
    vault_amt = 0.0  # pair units held
    vault_cost = 0.0  # USD paid for what is held
    fund_amt = 0.0  # buyback fund, pair units
    fees = dict(creator=0.0, holders=0.0, vault=0.0, buyback=0.0, platform=0.0)
    events = []
    ref = None
    mult = 1.0
    series, vols, backing = [], [], []
    cum_vol = 0.0
    tx_total = 0
    for i in range(hours + 1):
        ts = t0 + i * 3600
        px = math.exp(lp[i]) * mult
        mc = px * (SUPPLY - burned)
        # volume: turnover around 35% of the cap a day, more when the price moves
        move = abs(lp[i] - lp[i - 1]) if i else 0.1
        v = mc * (0.26 / 24) * (0.4 + rnd.random() * 1.2) * (1 + move * 14) * (3.0 if i < 6 else 1)
        cum_vol += v
        tx_total += max(1, int(v / (90 + rnd.random() * 400)))
        vols.append(round(v, 2))
        fee = v * 0.02
        fees['platform'] += v * 0.005
        fees['creator'] += v * cr / 1e4
        fees['holders'] += v * ho / 1e4
        fees['vault'] += v * va / 1e4
        fees['buyback'] += v * bb / 1e4
        pp = pair_px[i]
        if va:
            vault_amt += v * va / 1e4 / pp
            vault_cost += v * va / 1e4
        if bb:
            fund_amt += v * bb / 1e4 / pp
        # dip buyback: price (30-minute average, hourly here) 20% under the high since the last buyback
        ref = px if ref is None else max(ref, px)
        if bb and i > 3 and px <= ref * 0.8 and fund_amt * pp > 1:
            spend = fund_amt * 0.5
            usd = spend * pp
            coins = usd / px
            burned += coins
            fund_amt -= spend
            events.append(dict(kind='dip', ts=ts + rnd.randint(60, 3000), usd=round(usd, 2), pairAmt=spend, burned=coins, px=px, ref=ref,
                               tx='0x' + hashlib.sha256(f"{c['symbol']}dip{i}".encode()).hexdigest()))
            mult *= 1 + min(0.08, usd / mc * 2.5)
            px = math.exp(lp[i]) * mult
            ref = px
        # take profit: vault worth target% more than it paid
        if c['tp'] and va and vault_amt * pp >= vault_cost * (1 + c['tp'] / 100) and vault_cost > 50:
            gain_usd = vault_amt * pp - vault_cost
            sold = gain_usd / pp
            coins = gain_usd / px
            vault_amt -= sold
            burned += coins
            events.append(dict(kind='tp', ts=ts + rnd.randint(60, 3000), usd=round(gain_usd, 2), pairAmt=sold, burned=coins, px=px, up=c['tp'],
                               tx='0x' + hashlib.sha256(f"{c['symbol']}tp{i}".encode()).hexdigest()))
            mult *= 1 + min(0.06, gain_usd / mc * 2.5)
            px = math.exp(lp[i]) * mult
        series.append(px)
        circ = SUPPLY - burned
        backing.append(vault_amt * pp / circ if va else 0)

    px = series[-1]
    circ = SUPPLY - burned
    pp = pair_px[-1]
    h1 = max(0, len(series) - 2)
    h24 = max(0, len(series) - 25)
    vol24 = sum(vols[-24:])
    tx24 = max(8, int(vol24 / (160 + rnd.random() * 200)))
    holders_n = int(60 + (c['mc'] / 1000) ** 0.82 * 3 + rnd.random() * 40)
    # top holders: a power law over the circulating supply
    weights = [1 / (k + 1.6) ** 1.25 for k in range(holders_n)]
    total_w = sum(weights)
    held = 0.86 * circ  # the rest sits in the pool
    top = []
    for k in range(min(20, holders_n)):
        top.append(dict(addr=WALLETS[(c['seed'] * 13 + k * 7) % len(WALLETS)], bal=held * weights[k] / total_w))
    # recent trades for the activity list
    trades = []
    t = NOW + 3600
    for k in range(60):
        t -= int(30 + rnd.random() * (86400 / max(tx24, 1)) * 1.6)
        side = 'buy' if rnd.random() < 0.56 else 'sell'
        usd = math.exp(rnd.gauss(math.log(260), 1.1))
        eth_usd = usd_of('ETH')
        trades.append(dict(ts=t, side=side, who=WALLETS[rnd.randrange(len(WALLETS))], usd=round(usd, 2), eth=usd / eth_usd, coins=usd / px))
    pair = TOK[c['pair']]
    out = dict(
        addr=addr('coin', c['symbol']), name=c['name'], symbol=c['symbol'], desc=c['desc'], img=f"/img/coins/{c['symbol'].lower()}.webp",
        pair=pair['address'].lower(), pairSym=pair['symbol'], pairLogo=pair['logo'], pairDec=pair['decimals'], pairUsd=pp,
        creator=WALLETS[c['seed'] * 3 % len(WALLETS)], createdAt=t0, lastTrade=trades[0]['ts'],
        split=dict(creator=cr, holders=ho, vault=va, buyback=bb, platform=50),
        tp=c['tp'], redeem=c['redeem'], rewards=c['rewards'], basket=[dict(symbol=TOK[s]['symbol'], logo=TOK[s]['logo'], address=TOK[s]['address'].lower()) for s in c['basket']],
        supply=SUPPLY, burned=burned, circ=circ,
        px=px, mc=px * circ, c1=(px / series[h1] - 1) * 100, c24=(px / series[h24] - 1) * 100,
        vol24=vol24, volAll=cum_vol, tx24=tx24, txAll=tx_total, holders=holders_n, liq=px * circ * 0.14 * 2,
        vault=dict(amount=vault_amt, usd=vault_amt * pp, cost=vault_cost, perCoin=vault_amt * pp / circ if va else 0, perCoinPair=vault_amt / circ if va else 0) if va else None,
        fund=dict(amount=fund_amt, usd=fund_amt * pp, ref=ref, trigger=ref * 0.8) if bb else None,
        fees=fees, events=sorted(events, key=lambda e: -e['ts']),
        chart=dict(t0=t0, step=3600, px=[float(f'{p:.6g}') for p in series], backing=[float(f'{b:.6g}') for b in backing], vol=vols),
        top=top, trades=trades,
    )
    return out


def main():
    coins = [simulate(c) for c in COINS]
    json.dump(dict(generatedAt=NOW, ethUsd=usd_of('ETH'), tokens=coins), open(os.path.join(HERE, 'site', 'demo.json'), 'w'), separators=(',', ':'))
    for x in coins:
        ev = x['events']
        print(f"{x['symbol']:6} mc ${x['mc']:>10,.0f} vol24 ${x['vol24']:>9,.0f} burned {x['burned'] / 1e9 * 100:5.2f}%  vault ${x['vault']['usd'] if x['vault'] else 0:>8,.0f}  fund ${x['fund']['usd'] if x['fund'] else 0:>7,.0f}  dips {sum(e['kind'] == 'dip' for e in ev)} tps {sum(e['kind'] == 'tp' for e in ev)}  c24 {x['c24']:+.1f}%  to-trigger {((x['fund']['trigger'] / x['px'] - 1) * 100 if x['fund'] else 0):+.1f}%")


if __name__ == '__main__':
    main()
