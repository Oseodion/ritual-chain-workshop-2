"use client";

import { useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { localHardhat } from "@/src/lib/chain";
import { shortenAddress } from "@/src/lib/format";
import { Button } from "./Button";

type InjectedProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

function getInjectedProvider(): InjectedProvider | undefined {
  return (window as unknown as { ethereum?: InjectedProvider }).ethereum;
}

export function ConnectButton() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const [connectFailed, setConnectFailed] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
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
      const ethereum = getInjectedProvider();
      if (!ethereum) {
        setSwitchError("No wallet found.");
        return;
      }

      setIsSwitching(true);
      try {
        // wallet_addEthereumChain adds the chain if the wallet doesn't know it
        // yet, or just switches to it if it does — either way MetaMask prompts
        // directly, unlike wallet_switchEthereumChain, which rejects silently
        // for an unrecognized chain with no popup at all.
        await ethereum.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: "0x7a69",
              chainName: "Hardhat Local",
              rpcUrls: ["http://127.0.0.1:8545"],
              nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
            },
          ],
        });
      } catch {
        setSwitchError("Could not switch. Add Hardhat Local in your wallet manually.");
      } finally {
        setIsSwitching(false);
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
