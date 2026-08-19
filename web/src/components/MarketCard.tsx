"use client";

import { useEffect, useState } from "react";
import { parseEther } from "viem";
import {
  useAccount,
  useBlockNumber,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { localHardhat } from "@/src/lib/chain";
import { comparatorSymbol, formatEth } from "@/src/lib/format";
import { predictAbi } from "@/src/lib/predict-abi";
import { Market, MarketState } from "@/src/lib/types";
import { PREDICT_ADDRESS } from "@/src/lib/wagmi";
import { Button } from "./Button";
import { StatusBadge } from "./StatusBadge";

export function MarketCard({ market, index }: { market: Market; index: number }) {
  const { address, isConnected, chainId } = useAccount();
  const onRightChain = chainId === localHardhat.id;
  const { data: currentBlock } = useBlockNumber({ watch: true });

  const { data: stakes, refetch: refetchStakes } = useReadContract({
    address: PREDICT_ADDRESS,
    abi: predictAbi,
    functionName: "stakesOf",
    args: address ? [market.id, address] : undefined,
    query: { enabled: !!address && !!PREDICT_ADDRESS, refetchInterval: 3000 },
  });

  const pool = market.totalYes + market.totalNo;
  const yesPct = pool === 0n ? 50 : Number((market.totalYes * 100n) / pool);

  const showActions =
    market.state === MarketState.Open ||
    ((market.state === MarketState.Resolved || market.state === MarketState.Invalid) &&
      isConnected &&
      !!stakes);

  return (
    <div className="rounded-2xl border border-border p-6">
      <div className="flex items-start justify-between gap-4">
        <span className="text-xs uppercase tracking-widest text-fg-faint">
          {String(index + 1).padStart(2, "0")}
        </span>
        <StatusBadge state={market.state} />
      </div>

      <h3 className="mt-3 font-serif text-xl leading-snug">{market.question}</h3>

      <p className="mt-2 font-mono text-xs text-fg-faint">
        Resolves YES if observed {comparatorSymbol(market.comparator)}{" "}
        {market.target.toString()}
      </p>

      <PoolBar yesPct={yesPct} pool={pool} />

      <StatusLine market={market} currentBlock={currentBlock} />

      {showActions && <div className="mt-5 border-t border-border pt-5" />}

      {market.state === MarketState.Open && (
        <BetForm market={market} onRightChain={onRightChain} isConnected={isConnected} />
      )}

      {(market.state === MarketState.Resolved || market.state === MarketState.Invalid) &&
        isConnected &&
        stakes && (
          <ClaimSection
            market={market}
            stakes={stakes}
            onRightChain={onRightChain}
            onClaimed={refetchStakes}
          />
        )}
    </div>
  );
}

function PoolBar({ yesPct, pool }: { yesPct: number; pool: bigint }) {
  const empty = pool === 0n;
  return (
    <div className="mt-4">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
        {!empty && (
          <div className="h-full rounded-full bg-accent" style={{ width: `${yesPct}%` }} />
        )}
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-xs text-fg-dim">
        <span>{empty ? "YES" : `YES ${yesPct}%`}</span>
        <span>{empty ? "No bets yet" : `${formatEth(pool)} ETH pool`}</span>
        <span>{empty ? "NO" : `NO ${100 - yesPct}%`}</span>
      </div>
    </div>
  );
}

function StatusLine({
  market,
  currentBlock,
}: {
  market: Market;
  currentBlock: bigint | undefined;
}) {
  const text = (() => {
    if (market.state === MarketState.Open) {
      const left = currentBlock ? market.closeBlock - currentBlock : undefined;
      return `Closes at block ${market.closeBlock}${left !== undefined ? ` · ${left} blocks left` : ""}`;
    }
    if (market.state === MarketState.Closed) {
      return `Betting closed · resolution due at block ${market.resolveBlock}`;
    }
    if (market.state === MarketState.Resolving) {
      return `Resolution attempt ${market.attempts} failed · retrying`;
    }
    if (market.state === MarketState.Resolved) {
      return `Resolved ${market.outcome === 1 ? "YES" : "NO"} · observed ${market.observedValue}`;
    }
    return market.invalidReason ? `Invalid · ${market.invalidReason}` : "Invalid · refundable";
  })();

  return <p className="mt-3 font-mono text-xs text-fg-dim">{text}</p>;
}

function BetForm({
  market,
  onRightChain,
  isConnected,
}: {
  market: Market;
  onRightChain: boolean;
  isConnected: boolean;
}) {
  const [amount, setAmount] = useState("0.1");
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming } = useWaitForTransactionReceipt({ hash });

  if (!isConnected) {
    return <p className="text-sm text-fg-dim">Connect a wallet to bet.</p>;
  }
  if (!onRightChain) {
    return <p className="text-sm text-fg-dim">Switch to Hardhat Local to bet.</p>;
  }

  function bet(isYes: boolean) {
    if (!PREDICT_ADDRESS || !amount) return;
    writeContract({
      address: PREDICT_ADDRESS,
      abi: predictAbi,
      functionName: "bet",
      args: [market.id, isYes],
      value: parseEther(amount),
    });
  }

  const busy = isPending || isConfirming;

  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        min="0"
        step="0.01"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        className="w-24 rounded-full border border-border-strong bg-transparent px-3 py-2 text-sm font-mono text-fg outline-none focus-visible:border-fg"
        aria-label="Bet amount in ETH"
      />
      <Button variant="primary" disabled={busy} onClick={() => bet(true)}>
        Bet YES
      </Button>
      <Button disabled={busy} onClick={() => bet(false)}>
        Bet NO
      </Button>
      {error && <span className="text-xs text-fg-dim">{error.message.split("\n")[0]}</span>}
    </div>
  );
}

function ClaimSection({
  market,
  stakes,
  onRightChain,
  onClaimed,
}: {
  market: Market;
  stakes: readonly [bigint, bigint, boolean, bigint];
  onRightChain: boolean;
  onClaimed: () => void;
}) {
  const [, , alreadySettled, claimable] = stakes;
  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (isSuccess) onClaimed();
  }, [isSuccess, onClaimed]);

  if (alreadySettled) {
    return (
      <p className="text-sm text-fg-dim">
        {market.state === MarketState.Invalid ? "Refunded." : "Claimed."}
      </p>
    );
  }
  if (claimable === 0n) return null;
  if (!onRightChain) {
    return <p className="text-sm text-fg-dim">Switch to Hardhat Local to claim.</p>;
  }

  function claim() {
    if (!PREDICT_ADDRESS) return;
    writeContract({
      address: PREDICT_ADDRESS,
      abi: predictAbi,
      functionName: market.state === MarketState.Invalid ? "claimRefund" : "claimWinnings",
      args: [market.id],
    });
  }

  return (
    <div className="flex items-center gap-3">
      <Button variant="primary" disabled={isPending || isConfirming} onClick={claim}>
        {market.state === MarketState.Invalid ? "Claim refund" : "Claim winnings"}
      </Button>
      <span className="font-mono text-xs text-fg-dim">{formatEth(claimable)} ETH</span>
    </div>
  );
}
