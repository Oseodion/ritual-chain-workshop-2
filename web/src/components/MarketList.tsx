"use client";

import { useReadContract } from "wagmi";
import { predictAbi } from "@/src/lib/predict-abi";
import { Market } from "@/src/lib/types";
import { PREDICT_ADDRESS } from "@/src/lib/wagmi";
import { MarketCard } from "./MarketCard";

export function MarketList() {
  const { data: markets, isLoading, error } = useReadContract({
    address: PREDICT_ADDRESS,
    abi: predictAbi,
    functionName: "getMarkets",
    query: { enabled: !!PREDICT_ADDRESS, refetchInterval: 3000 },
  });

  if (!PREDICT_ADDRESS) {
    return (
      <p className="text-sm text-fg-dim">
        No contract address configured. Set NEXT_PUBLIC_PREDICT_ADDRESS in
        web/.env.local and restart the dev server.
      </p>
    );
  }

  if (isLoading) return <p className="text-sm text-fg-dim">Loading markets</p>;

  if (error) {
    return (
      <p className="text-sm text-fg-dim">
        Could not reach the contract. Check the local Hardhat node is running.
      </p>
    );
  }

  if (!markets || markets.length === 0) {
    return <p className="text-sm text-fg-dim">No markets yet.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {(markets as readonly Market[]).map((market) => (
        <MarketCard key={market.id.toString()} market={market} />
      ))}
    </div>
  );
}
