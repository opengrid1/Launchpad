#!/bin/bash
# local chain 99901 with Elysium's bytecode + UR/Quoter/Multicall3, the LiquidFi stack, launches on
set -e
SP=/tmp/claude-0/-home-user-Launchpad/2c15f8d4-9629-5fde-b76e-4ea97bf2ebee/scratchpad
for i in $(seq 1 40); do curl -s -X POST http://127.0.0.1:8548 -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' | grep -q result && break; sleep 1; done
cd $SP/hh && node -e "
const A={pm:'0xE2e105d3F7209A9DA11f83cCf3E7398a753823F1',permit2:'0x000000000022D473030F116dDEE9F6B43aC78BA3',whype:'0xba876237b0f021a6c6d852d6c26e107997cc5e81',create2:'0x4e59b44847b379578588920cA78FbF26c0B4956C',ur:'0xA13f7611115752DEB2B13813BDDE16A5073e4b45',quoter:'0x379F556c5a748BD7Cc9baF0F7A344094Ac1814f5',multicall:'0xcA11bde05977b3631167028862bE2a173976CA11'};
(async()=>{for(const [n,a] of Object.entries(A)){const code=require('./elycode/'+n+'.json').result;const r=await fetch('http://127.0.0.1:8548',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'hardhat_setCode',params:[a,code]})});const j=await r.json(); if(!j.result) throw new Error(n+' '+JSON.stringify(j));}console.log('code set');})()"
printf 'PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80\n' > $SP/hh-key0.env
cd /home/user/Launchpad/launchpad-v4 && rm -f deployments/liquidfi-local*.json
KEYFILE=$SP/hh-key0.env FORK_RPC=http://127.0.0.1:8548 LIQUIDFI_OWNER=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 node deploy-liquidfi.cjs --network local --send | grep -E "written|FAILED"
cp deployments/liquidfi-local.json $SP/lqf-local.json; rm -f deployments/liquidfi-local*.json
node -e "
const {ethers}=require('ethers');const d=require('$SP/lqf-local.json');const P=new ethers.JsonRpcProvider('http://127.0.0.1:8548');
(async()=>{const w=new ethers.Wallet('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',P);const f=new ethers.Contract(d.factory,['function setLaunchEnabled(bool)','function launchEnabled() view returns (bool)'],w);await (await f.setLaunchEnabled(true)).wait();console.log('launchEnabled',await f.launchEnabled(), 'factory', d.factory);})()"
