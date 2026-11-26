const {ethers}=require("ethers");const {execSync}=require("child_process");const fs=require("fs");
const addr=fs.readFileSync(__dirname+"/../.env.meow-deployer2","utf8").match(/DEPLOYER_ADDRESS=(0x[0-9a-fA-F]{40})/)[1];
(async()=>{
  const p=new ethers.JsonRpcProvider("https://rpc.hyperliquid.xyz/evm",999);
  for(let i=0;i<40;i++){
    let n=0; try{n=await p.getTransactionCount(addr,"latest");}catch{}
    if(n>=3){ // TD + factory deployed; setFactory next. Small-block the rest.
      try{execSync("DEPLOYER_ENV=.env.meow-deployer2 node scripts/enable-bigblocks.cjs off",{cwd:__dirname+"/..",stdio:"inherit"});}catch(e){}
      console.log("big blocks OFF at nonce",n); return;
    }
    await new Promise(r=>setTimeout(r,10000));
  }
  console.log("gave up waiting");
})();
