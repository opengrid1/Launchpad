const fs=require("fs"),path=require("path");
const {ethers}=require("ethers");
function key(){return fs.readFileSync(path.join(__dirname,"..",process.env.DEPLOYER_ENV||".env.meow-deployer"),"utf8").match(/PRIVATE_KEY=(0x[0-9a-fA-F]{64})/)[1];}
const FACTORY=process.env.FACTORY||"0x19BEA177067dd79D3D25710D42808e8ec2587239";
const WHYPE="0x5555555555555555555555555555555555555555";
const ABI=["function createToken((string name,string symbol,string metadataURI,address quote,uint256 marketCapUsd8,uint256 devBuyQuote)) payable returns (address token,address pool,uint256 positionId)"];
const metadata = JSON.stringify({
  description: "The official token of meowstock, the memecoin launchpad on HyperEVM. Hold the coin, earn the stock.",
  logo: "https://www.meowstock.fun/meowstock-pfp.png",
  website: "https://www.meowstock.fun",
  twitter: "https://x.com/meowstockX",
});
async function main(){
  const p=new ethers.JsonRpcProvider("https://rpc.hyperliquid.xyz/evm",999);
  const w=new ethers.Wallet(key(),p);
  const f=new ethers.Contract(FACTORY,ABI,w);
  const params={name:"meowstock",symbol:"MEOW",metadataURI:metadata,quote:WHYPE,marketCapUsd8:0,devBuyQuote:0};
  const fees={maxFeePerGas:2_000_000_000n,maxPriorityFeePerGas:100_000_000n};
  const [token,pool,positionId]=await f.createToken.staticCall(params,{value:0});
  console.log("predicted token:",token,"| pool:",pool);
  let gas;try{gas=await f.createToken.estimateGas(params,{value:0});}catch(e){gas=8_000_000n;}
  const tx=await f.createToken(params,{value:0,gasLimit:(gas*15n)/10n,...fees});
  console.log("launch tx:",tx.hash);
  const r=await tx.wait();
  console.log("confirmed block",r.blockNumber,"| status",r.status,"| gasUsed",r.gasUsed.toString());
  fs.writeFileSync(path.join(__dirname,"..","deployments","meow-token-official.json"),
    JSON.stringify({name:"meowstock",symbol:"MEOW",pair:"HYPE",quote:WHYPE,token,pool,positionId:positionId.toString(),tx:tx.hash,metadata:JSON.parse(metadata),creator:w.address},null,2));
  console.log("saved deployments/meow-token-official.json");
}
main().catch(e=>{console.error(e.shortMessage||e.message);process.exit(1);});
