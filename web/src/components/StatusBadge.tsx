import { MARKET_STATE } from "@/src/lib/format";
import { MarketState } from "@/src/lib/types";

export function StatusBadge({ state }: { state: number }) {
  const label = MARKET_STATE[state] ?? "Unknown";
  const filled = state === MarketState.Resolved || state === MarketState.Invalid;

  return (
    <span
      className={
        "rounded-full border px-2.5 py-0.5 text-xs font-mono uppercase tracking-wide " +
        (filled
          ? "border-fg bg-fg text-bg"
          : "border-border-strong text-fg-dim")
      }
    >
      {label}
    </span>
  );
}
