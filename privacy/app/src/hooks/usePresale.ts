import { useAccount, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseEther } from "viem";
import { ADDRESSES, isAddress } from "../lib/config";
import { presaleAbi } from "../lib/abis";

export type SaleState = {
  price: bigint;
  tokensForSale: bigint;
  softCap: bigint;
  hardCap: bigint;
  startTime: bigint;
  endTime: bigint;
  totalRaised: bigint;
  tokensSold: bigint;
  finalized: boolean;
  succeeded: boolean;
  perWalletCap: bigint;
};

const FIELDS = [
  "price", "tokensForSale", "softCap", "hardCap", "startTime", "endTime",
  "totalRaised", "tokensSold", "finalized", "succeeded", "perWalletCap",
] as const;

export function usePresale() {
  const { address } = useAccount();
  const configured = isAddress(ADDRESSES.presale);
  const presale = ADDRESSES.presale as `0x${string}`;

  const globals = useReadContracts({
    query: { enabled: configured, refetchInterval: 12_000 },
    contracts: FIELDS.map((name) => ({ address: presale, abi: presaleAbi, functionName: name })),
  });

  const account = useReadContracts({
    query: { enabled: configured && !!address },
    contracts: [
      { address: presale, abi: presaleAbi, functionName: "contributed", args: [address ?? "0x0"] },
      { address: presale, abi: presaleAbi, functionName: "owed", args: [address ?? "0x0"] },
    ],
  });

  let sale: SaleState | null = null;
  if (globals.data && globals.data.every((r) => r.status === "success")) {
    const v = globals.data.map((r) => r.result);
    sale = {
      price: v[0] as bigint,
      tokensForSale: v[1] as bigint,
      softCap: v[2] as bigint,
      hardCap: v[3] as bigint,
      startTime: v[4] as bigint,
      endTime: v[5] as bigint,
      totalRaised: v[6] as bigint,
      tokensSold: v[7] as bigint,
      finalized: v[8] as boolean,
      succeeded: v[9] as boolean,
      perWalletCap: v[10] as bigint,
    };
  }

  const mine = {
    contributed: (account.data?.[0]?.result as bigint | undefined) ?? 0n,
    owed: (account.data?.[1]?.result as bigint | undefined) ?? 0n,
  };

  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash });

  function refetch() {
    globals.refetch();
    account.refetch();
  }

  const buy = (eth: string) =>
    writeContract({ address: presale, abi: presaleAbi, functionName: "buy", value: parseEther(eth) });
  const claim = () => writeContract({ address: presale, abi: presaleAbi, functionName: "claim" });
  const refund = () => writeContract({ address: presale, abi: presaleAbi, functionName: "refund" });
  const finalize = () => writeContract({ address: presale, abi: presaleAbi, functionName: "finalize" });

  return {
    configured,
    sale,
    mine,
    loading: globals.isLoading,
    refetch,
    actions: { buy, claim, refund, finalize },
    tx: { hash, isPending, error, reset, mining: receipt.isLoading, confirmed: receipt.isSuccess },
  };
}
