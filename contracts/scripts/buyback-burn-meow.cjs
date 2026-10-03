const fs=require("fs"),path=require("path");
const {ethers}=require("ethers");
function key(){return fs.readFileSync(path.join(__dirname,"..",".env.meow-deployer"),"utf8").match(/PRIVATE_KEY=(0x[0-9a-fA-F]{64})/)[1];}
const MEOW="0x786060009c006a6cb44C5b5E21202dC5a34a1f47";
const WHYPE="0x5555555555555555555555555555555555555555";
const ROUTER="0x6d99e7f6747af2cdbb5164b6dd50e40d4fde1e77"; // HyperSwap SwapRouter02
const DEAD="0x000000000000000000000000000000000000dEaD";
const FEE=10000;
const TOK=["function claimCreatorFees() returns (uint256)","function balanceOf(address) view returns (uint256)","function creatorFeesInPair() view returns (uint256)"];
const ERC=["function balanceOf(address) view returns (uint256)","function approve(address,uint256) returns (bool)","function allowance(address,address) view returns (uint256)"];
const ROUTER02=["function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)"];
async function main(){
  const p=new ethers.JsonRpcProvider("https://rpc.hyperliquid.xyz/evm",999);
  const w=new ethers.Wallet(key(),p);
  const fees={maxFeePerGas:2_000_000_000n,maxPriorityFeePerGas:100_000_000n};
  const meow=new ethers.Contract(MEOW,TOK,w);
  const whype=new ethers.Contract(WHYPE,ERC,w);

  const before=await whype.balanceOf(w.address);
  console.log("claiming creator fees…  (expected ~",ethers.formatUnits(await meow.creatorFeesInPair(),18),"WHYPE)");
  const c=await meow.claimCreatorFees({gasLimit:600_000,...fees});
  console.log("claim tx:",c.hash); await c.wait();
  const after=await whype.balanceOf(w.address);
  const got=after-before;
  console.log("claimed WHYPE:",ethers.formatUnits(got,18));
  if(got===0n){console.log("nothing claimed; done.");return;}

  // approve router if needed
  const router=new ethers.Contract(ROUTER,ROUTER02,w);
  const alw=await whype.allowance(w.address,ROUTER);
  if(alw<got){const a=await whype.approve(ROUTER,ethers.MaxUint256,{gasLimit:80_000,...fees});console.log("approve tx:",a.hash);await a.wait();}

  const deadBefore=await new ethers.Contract(MEOW,ERC,p).balanceOf(DEAD);
  const params={tokenIn:WHYPE,tokenOut:MEOW,fee:FEE,recipient:DEAD,amountIn:got,amountOutMinimum:0n,sqrtPriceLimitX96:0n};
  const s=await router.exactInputSingle(params,{gasLimit:400_000,...fees});
  console.log("buyback+burn swap tx:",s.hash); const r=await s.wait();
  const deadAfter=await new ethers.Contract(MEOW,ERC,p).balanceOf(DEAD);
  const burned=deadAfter-deadBefore;
  console.log("MEOW sent to burn (0xdEaD):",ethers.formatUnits(burned,18));
  console.log("burn address total MEOW now:",ethers.formatUnits(deadAfter,18));
  fs.writeFileSync(path.join(__dirname,"..","deployments","meow-buyback-burn.json"),
    JSON.stringify({token:MEOW,claimTx:c.hash,swapTx:s.hash,whypeClaimed:ethers.formatUnits(got,18),meowBurned:ethers.formatUnits(burned,18),burnAddress:DEAD,at:new Date().toISOString()},null,2));
  console.log("saved deployments/meow-buyback-burn.json");
}
main().catch(e=>{console.error(e.shortMessage||e.message);process.exit(1);});
