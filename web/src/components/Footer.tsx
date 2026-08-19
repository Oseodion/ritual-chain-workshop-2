"use client";

import { useAccount } from "wagmi";
import { localHardhat } from "@/src/lib/chain";
import { shortenAddress } from "@/src/lib/format";
import { PREDICT_ADDRESS } from "@/src/lib/wagmi";

function FooterField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-dark-fg-dim">
        {label}
      </div>
      <div className="mt-1.5 font-mono text-sm text-dark-fg">{value}</div>
    </div>
  );
}

export function Footer() {
  const { isConnected, chainId } = useAccount();

  return (
    <footer className="mt-16 rounded-2xl bg-dark-bg px-6 py-8 sm:px-8">
      <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
        <FooterField label="Network" value={localHardhat.name} />
        <FooterField label="Chain" value={String(localHardhat.id)} />
        <FooterField
          label="Contract"
          value={PREDICT_ADDRESS ? shortenAddress(PREDICT_ADDRESS) : "Not set"}
        />
        <FooterField
          label="Wallet"
          value={
            !isConnected
              ? "Not connected"
              : chainId === localHardhat.id
                ? "Connected"
                : "Wrong network"
          }
        />
      </div>
    </footer>
  );
}
