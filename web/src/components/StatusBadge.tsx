import { MARKET_STATE } from "@/src/lib/format";
import { MarketState } from "@/src/lib/types";

export function StatusBadge({ state }: { state: number }) {
  const label = MARKET_STATE[state] ?? "Unknown";

  const styles = (() => {
    if (state === MarketState.Open) {
      return "border-accent text-accent";
    }
    if (state === MarketState.Resolved || state === MarketState.Invalid) {
      return "border-dark-bg bg-dark-bg text-dark-fg";
    }
    return "border-border-strong text-fg-dim";
  })();

  return (
    <span
      className={`rounded-full border px-2.5 py-1 text-xs uppercase tracking-widest ${styles}`}
    >
      {label}
    </span>
  );
}
