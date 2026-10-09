const fs=require("fs"),path=require("path");
const {ethers}=require("ethers");
const RPC="https://rpc.hyperliquid.xyz/evm";
const FACTORY="0x24Ba7013C7c0074255A35E019c688FbD5D1b71ec";
const TOKENDEP="0x54BAcAd7500a767e9e437fa54e00B11320e98066";
const NPM="0x6eda206207c09e5428f281761ddc0d300851fbc8";
const NVDAX="0xa8ddb5cd96b5222afe198316e9a57caa642850d5";
const TOKEN="0x29C873Fb01E0af7F6F52FB59720759d94Ce62AC0";
const POOL="0x8b4CDC934964127cdE54952544Ff6e71708B28F4";
const OWNER="0x77002c2e21575F0450D28C2E71C0707ba0F5995A";

const FAC=["function owner() view returns (address)","function tokenCount() view returns (uint256)","function allTokens(uint256) view returns (address)","function listings(address) view returns (address creator,address quote,address pool,uint256 positionId,uint64 createdAt,bool tokenIsToken0)","function quoteAssets(address) view returns (bool approved,uint64 usdPrice8,uint8 decimals)"];
const TD=["function factory() view returns (address)"];
const POOLABI=["function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16 a,uint16 b,uint16 c,uint8 d,bool e)","function liquidity() view returns (uint128)","function token0() view returns (address)","function token1() view returns (address)","function fee() view returns (uint24)"];
const NPMABI=["function positions(uint256) view returns (uint96 nonce,address operator,address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint128 liquidity,uint256 f0,uint256 f1,uint128 owed0,uint128 owed1)"];
const ERC=["function balanceOf(address) view returns (uint256)","function name() view returns (string)","function symbol() view returns (string)","function totalSupply() view returns (uint256)"];
const TOK=["function pairAsset() view returns (address)","function rewardToken() view returns (address)","function factory() view returns (address)"];

let pass=0,fail=0;
const ok=(c,m)=>{ (c?pass++:fail++); console.log((c?"PASS ":"FAIL ")+m); };

async function main(){
  const p=new ethers.JsonRpcProvider(RPC,999);
  const f=new ethers.Contract(FACTORY,FAC,p);

  console.log("== 1. Factory / ownership ==");
  ok((await f.owner()).toLowerCase()===OWNER.toLowerCase(),"factory.owner == 0x77002…");
  ok((await new ethers.Contract(TOKENDEP,TD,p).factory()).toLowerCase()===FACTORY.toLowerCase(),"tokenDeployer.factory == new factory");

  console.log("\n== 2. Quotes (22 expected) ==");
  const prices=JSON.parse(fs.readFileSync(path.join(__dirname,"..","deployments/meow-stock-prices.json"),"utf8"));
  const all=[["WHYPE","0x5555555555555555555555555555555555555555"],...prices.stocks.map(s=>[s.ticker,s.address])];
  let approved=0;
  for(const [t,a] of all){ const q=await f.quoteAssets(a); if(q.approved&&q.usdPrice8>0n) approved++; else console.log("   MISSING/zero:",t,a); }
  ok(approved===all.length,`all ${all.length} quotes approved w/ price (got ${approved})`);

  console.log("\n== 3. microduck listing ==");
  const l=await f.listings(TOKEN);
  ok(l.pool.toLowerCase()===POOL.toLowerCase(),"listing.pool matches");
  ok(l.quote.toLowerCase()===NVDAX.toLowerCase(),"listing.quote == NVDAX");
  ok(l.positionId>0n,"listing.positionId set ("+l.positionId+")");
  const tk=new ethers.Contract(TOKEN,ERC,p);
  ok((await tk.name())==="microduck" && (await tk.symbol())==="MICRODUCK","token name/symbol");
  ok((await tk.totalSupply())===10n**27n,"supply == 1e9 * 1e18");

  console.log("\n== 4. token reward wiring ==");
  const rt=new ethers.Contract(TOKEN,TOK,p);
  ok((await rt.pairAsset()).toLowerCase()===NVDAX.toLowerCase(),"token.pairAsset == NVDAX");
  ok((await rt.rewardToken()).toLowerCase()===NVDAX.toLowerCase(),"token.rewardToken == NVDAX");
  // (token.factory view varies; skipped)

  console.log("\n== 5. pool live & fillable ==");
  const pool=new ethers.Contract(POOL,POOLABI,p);
  const s0=await pool.slot0();
  ok(s0.sqrtPriceX96>0n,"pool initialized (sqrtPriceX96>0)");
  ok(await pool.liquidity()>0n,"pool active liquidity > 0");
  ok((await pool.fee())===10000n,"pool fee tier == 1%");
  const t0=(await pool.token0()).toLowerCase();
  const coinBal=await new ethers.Contract(TOKEN,ERC,p).balanceOf(POOL);
  const nvdaBal=await new ethers.Contract(NVDAX,ERC,p).balanceOf(POOL);
  console.log("   pool coin bal:",ethers.formatUnits(coinBal,18),"microduck | NVDAX bal:",ethers.formatUnits(nvdaBal,18));
  ok(coinBal>0n,"pool holds coin supply (single-sided seed)");
  const pos=await new ethers.Contract(NPM,NPMABI,p).positions(l.positionId);
  ok(pos.liquidity>0n,"LP NFT position liquidity > 0 ("+pos.liquidity+")");
  ok(pos.token0.toLowerCase()===t0 && (pos.token0.toLowerCase()===TOKEN.toLowerCase()||pos.token1.toLowerCase()===TOKEN.toLowerCase()),"position pairs coin/NVDAX");

  // price implied by slot0
  const sp=Number(s0.sqrtPriceX96)/2**96; let priceT1perT0=sp*sp;
  const coinIsT0=t0===TOKEN.toLowerCase();
  const nvdaPerCoin=coinIsT0?priceT1perT0:1/priceT1perT0;
  const nvdaUsd=Number(prices.stocks.find(s=>s.address.toLowerCase()===NVDAX.toLowerCase()).priceUsd);
  const coinUsd=nvdaPerCoin*nvdaUsd;
  console.log("   implied coin price:",coinUsd.toExponential(3),"USD -> mcap ~$"+Math.round(coinUsd*1e9).toLocaleString());

  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail?1:0);
}
main().catch(e=>{console.error(e.shortMessage||e.message);process.exit(1);});
