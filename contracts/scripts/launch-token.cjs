const fs=require("fs"),path=require("path");
const {ethers}=require("ethers");
function key(){return fs.readFileSync(path.join(__dirname,"..",".env.meow-deployer"),"utf8").match(/PRIVATE_KEY=(0x[0-9a-fA-F]{64})/)[1];}
const FACTORY="0x24Ba7013C7c0074255A35E019c688FbD5D1b71ec";
const ABI=["function createToken((string name,string symbol,string metadataURI,address quote,uint256 marketCapUsd8,uint256 devBuyQuote)) payable returns (address token,address pool,uint256 positionId)"];
async function main(){
  const [name,symbol,quote,slug]=[process.argv[2],process.argv[3],process.argv[4],process.argv[5]];
  const p=new ethers.JsonRpcProvider("https://rpc.hyperliquid.xyz/evm",999);
  const w=new ethers.Wallet(key(),p);
  const f=new ethers.Contract(FACTORY,ABI,w);
  const params={name,symbol,metadataURI:"",quote,marketCapUsd8:0,devBuyQuote:0};
  const fees={maxFeePerGas:2_000_000_000n,maxPriorityFeePerGas:100_000_000n};
  const [token,pool,positionId]=await f.createToken.staticCall(params,{value:0});
  console.log("predicted token:",token,"| pool:",pool,"| positionId:",positionId.toString());
  let gas; try{gas=await f.createToken.estimateGas(params,{value:0});}catch(e){gas=8_000_000n;}
  const tx=await f.createToken(params,{value:0,gasLimit:(gas*15n)/10n,...fees});
  console.log("launch tx:",tx.hash);
  const r=await tx.wait();
  console.log("confirmed block",r.blockNumber,"| status",r.status,"| gasUsed",r.gasUsed.toString());
  fs.writeFileSync(path.join(__dirname,"..","deployments","meow-token-"+slug+".json"),
    JSON.stringify({name,symbol,quote,token,pool,positionId:positionId.toString(),tx:tx.hash,creator:w.address},null,2));
  console.log("saved deployments/meow-token-"+slug+".json");
}
main().catch(e=>{console.error(e.shortMessage||e.message);process.exit(1);});
