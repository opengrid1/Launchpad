import solc from 'solc'; import Ganache from 'ganache'; import { ethers } from 'ethers'; import { readFileSync } from 'fs'
const src = readFileSync('./PriceMath.sol','utf8')
const input={language:'Solidity',sources:{'PriceMath.sol':{content:src}},settings:{optimizer:{enabled:true,runs:800},evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}}
const out=JSON.parse(solc.compile(JSON.stringify(input)))
const errs=(out.errors||[]).filter(e=>e.severity==='error'); if(errs.length){console.error(errs.map(e=>e.formattedMessage).join('\n'));process.exit(1)}
console.log('compiled ok')
const art={abi:out.contracts['PriceMath.sol']['PriceMath'].abi,bytecode:'0x'+out.contracts['PriceMath.sol']['PriceMath'].evm.bytecode.object}
const prov=new ethers.BrowserProvider(Ganache.provider({logging:{quiet:true},chain:{hardfork:'shanghai'}}))
const s=await prov.getSigner((await prov.send('eth_accounts',[]))[0])
const f=new ethers.ContractFactory(art.abi,art.bytecode,s); const pm=await f.deploy(); await pm.waitForDeployment()
// JS reference: Uniswap encodeSqrtRatioX96
function bsqrt(n){ if(n<2n) return n; let x=n,y=(x+1n)/2n; while(y<x){x=y;y=(x+n/x)/2n;} return x; }
const SUPPLY=1000000000n*10n**18n
function ref(mcap,coinIsZero){ const [a1,a0]=coinIsZero?[mcap,SUPPLY]:[SUPPLY,mcap]; return bsqrt((a1<<192n)/a0); }
const MIN=4295128739n, MAX=1461446703485210103287273052203988822378723970342n // TickMath bounds
let pass=0,fail=0
function chk(name,got,want){ if(got===want){pass++;console.log('  ✓ '+name)} else {fail++;console.log(`  ✗ ${name}\n      got ${got}\n      want ${want}`)} }
const cases=[
  ['0.5 ETH mcap, coin=cur0', ethers.parseEther('0.5'), true],
  ['0.5 ETH mcap, coin=cur1', ethers.parseEther('0.5'), false],
  ['5 AAPL mcap, coin=cur0', ethers.parseEther('5'), true],
  ['5 AAPL mcap, coin=cur1', ethers.parseEther('5'), false],
  ['2000e18 mcap, coin=cur0', ethers.parseEther('2000'), true],
  ['tiny 0.001, coin=cur1', ethers.parseEther('0.001'), false],
]
console.log('PriceMath (_launchSqrtPrice) vs Uniswap encodeSqrtRatioX96')
for(const [n,mcap,ciz] of cases){
  const got=await pm.launchSqrtPrice(mcap,ciz)
  chk(n, got, ref(mcap,ciz))
}
// range sanity: all should be within TickMath bounds for reasonable mcaps
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail?1:0)
