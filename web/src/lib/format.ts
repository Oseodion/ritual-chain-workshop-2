// Mirrors RitualPredict's enums (contracts/RitualPredict.sol).
export const MARKET_STATE = [
  "Open",
  "Closed",
  "Resolving",
  "Resolved",
  "Invalid",
] as const;

export const OUTCOME = ["Unresolved", "Yes", "No"] as const;

const COMPARATOR_SYMBOL = [">", "≥", "<", "≤"] as const;

export function comparatorSymbol(comparator: number): string {
  return COMPARATOR_SYMBOL[comparator] ?? "?";
}

export function formatEth(wei: bigint, decimals = 4): string {
  const whole = wei / 10n ** 18n;
  const frac = wei % 10n ** 18n;
  const fracStr = frac.toString().padStart(18, "0").slice(0, decimals);
  return `${whole}.${fracStr}`;
}

export function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
