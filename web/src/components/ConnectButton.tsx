"use client";

import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { localHardhat } from "@/src/lib/chain";
import { shortenAddress } from "@/src/lib/format";
import { Button } from "./Button";

export function ConnectButton() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();

  if (!isConnected) {
    const connector = connectors[0];
    return (
      <div className="flex items-center gap-3">
        {error && <span className="text-xs text-fg-dim">No wallet found</span>}
        <Button
          variant="primary"
          disabled={!connector || isPending}
          onClick={() => connector && connect({ connector })}
        >
          {isPending ? "Connecting" : "Connect wallet"}
        </Button>
      </div>
    );
  }

  if (chainId !== localHardhat.id) {
    return (
      <Button
        disabled={isSwitching}
        onClick={() => switchChain({ chainId: localHardhat.id })}
      >
        {isSwitching ? "Switching" : "Switch to Hardhat Local"}
      </Button>
    );
  }

  return (
    <Button onClick={() => disconnect()} className="font-mono">
      {address && shortenAddress(address)}
    </Button>
  );
}
