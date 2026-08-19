"use client";

import { useState } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { localHardhat } from "@/src/lib/chain";
import { shortenAddress } from "@/src/lib/format";
import { Button } from "./Button";

export function ConnectButton() {
  const { address, isConnected, chainId, connector } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync, isPending: isSwitching } = useSwitchChain();
  const [connectFailed, setConnectFailed] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);

  if (!isConnected) {
    const target = connectors[0];
    return (
      <div className="flex items-center gap-3">
        {connectFailed && (
          <span className="text-xs text-fg-dim">No wallet found</span>
        )}
        <Button
          variant="primary"
          disabled={!target || isPending}
          onClick={() => {
            setConnectFailed(false);
            if (target) connect({ connector: target }, { onError: () => setConnectFailed(true) });
          }}
        >
          {isPending ? "Connecting" : "Connect wallet"}
        </Button>
      </div>
    );
  }

  if (chainId !== localHardhat.id) {
    async function handleSwitch() {
      setSwitchError(null);
      try {
        await switchChainAsync({ chainId: localHardhat.id });
      } catch {
        // Most wallets reject wallet_switchEthereumChain outright for a chain
        // they don't know yet, with no prompt at all. Add it explicitly, then
        // switch to it.
        try {
          const provider = await connector?.getProvider();
          if (!provider || typeof provider !== "object" || !("request" in provider)) {
            throw new Error("no provider");
          }
          await (
            provider as { request: (args: unknown) => Promise<unknown> }
          ).request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: `0x${localHardhat.id.toString(16)}`,
                chainName: localHardhat.name,
                nativeCurrency: localHardhat.nativeCurrency,
                rpcUrls: localHardhat.rpcUrls.default.http,
              },
            ],
          });
          await switchChainAsync({ chainId: localHardhat.id });
        } catch {
          setSwitchError("Could not switch. Add Hardhat Local in your wallet manually.");
        }
      }
    }

    return (
      <div className="flex items-center gap-3">
        {switchError && (
          <span className="max-w-48 text-xs text-fg-dim">{switchError}</span>
        )}
        <Button disabled={isSwitching} onClick={handleSwitch}>
          {isSwitching ? "Switching" : "Switch to Hardhat Local"}
        </Button>
      </div>
    );
  }

  return (
    <Button onClick={() => disconnect()} className="font-mono">
      {address && shortenAddress(address)}
    </Button>
  );
}
