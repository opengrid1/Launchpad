// Generates everything the Solidity side needs to be tested against the real
// circuit:
//   build/PoseidonT3.bytecode  - EVM bytecode for an on-chain Poseidon(2) hasher
//   build/zeros.json           - empty-subtree roots (must match the contract)
//   build/fixture.json         - a real deposit + a real Groth16 withdraw proof
//
// Run AFTER js/build-circuit.sh (needs build/withdraw_final.zkey + wasm).
const fs = require("fs");
const path = require("path");
const { poseidonContract } = require("circomlibjs");
const snarkjs = require("snarkjs");
const { poseidon, computeZeros, MerkleTree, FIELD_SIZE } = require("./lib");

const LEVELS = 20;
const BUILD = path.join(__dirname, "..", "build");
const WASM = path.join(BUILD, "withdraw_js", "withdraw.wasm");
const ZKEY = path.join(BUILD, "withdraw_final.zkey");

function rand() {
  // a uniform-ish field element from 31 random bytes
  const bytes = require("crypto").randomBytes(31);
  return BigInt("0x" + bytes.toString("hex")) % FIELD_SIZE;
}

async function main() {
  // 1. On-chain Poseidon(2) hasher bytecode + ABI.
  const bytecode = poseidonContract.createCode(2);
  const abi = poseidonContract.generateABI(2);
  fs.writeFileSync(path.join(BUILD, "PoseidonT3.bytecode"), bytecode);
  fs.writeFileSync(path.join(BUILD, "PoseidonT3.abi.json"), JSON.stringify(abi, null, 2));

  // 2. Zero subtree roots.
  const zeros = await computeZeros(LEVELS);
  fs.writeFileSync(
    path.join(BUILD, "zeros.json"),
    JSON.stringify(zeros.map((z) => z.toString()), null, 2)
  );

  // 3. A real note + deposit + withdraw proof.
  const nullifier = rand();
  const secret = rand();
  const commitment = await poseidon([nullifier, secret]);
  const nullifierHash = await poseidon([nullifier]);

  const tree = new MerkleTree(LEVELS, zeros);
  const index = tree.insert(commitment);
  const { root, pathElements, pathIndices } = await tree.path(index);

  // public withdraw params
  const recipient = BigInt("0x1111111111111111111111111111111111111111");
  const relayer = 0n;
  const fee = 0n;
  const refund = 0n;

  const input = {
    root: root.toString(),
    nullifierHash: nullifierHash.toString(),
    recipient: recipient.toString(),
    relayer: relayer.toString(),
    fee: fee.toString(),
    refund: refund.toString(),
    nullifier: nullifier.toString(),
    secret: secret.toString(),
    pathElements: pathElements.map((x) => x.toString()),
    pathIndices: pathIndices.map((x) => x.toString()),
  };

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM, ZKEY);
  const ok = await snarkjs.groth16.verify(
    JSON.parse(fs.readFileSync(path.join(BUILD, "verification_key.json"))),
    publicSignals,
    proof
  );
  if (!ok) throw new Error("self-check: proof failed to verify off-chain");

  // snarkjs calldata helper gives EVM-ready arrays.
  const calldata = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
  const [pA, pB, pC, pubSignals] = JSON.parse("[" + calldata + "]");

  fs.writeFileSync(
    path.join(BUILD, "fixture.json"),
    JSON.stringify(
      {
        commitment: commitment.toString(),
        nullifier: nullifier.toString(),
        secret: secret.toString(),
        nullifierHash: nullifierHash.toString(),
        root: root.toString(),
        recipient: "0x1111111111111111111111111111111111111111",
        pA,
        pB,
        pC,
        pubSignals,
        // flattened for easy Solidity/Foundry parsing
        pAflat: [pA[0], pA[1]],
        pBflat: [pB[0][0], pB[0][1], pB[1][0], pB[1][1]],
        pCflat: [pC[0], pC[1]],
        pubFlat: pubSignals,
      },
      null,
      2
    )
  );

  console.log("OK  commitment =", commitment.toString());
  console.log("OK  root       =", root.toString());
  console.log("OK  off-chain proof verified");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
