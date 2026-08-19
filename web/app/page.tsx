import { MarketList } from "@/src/components/MarketList";

export default function Home() {
  return (
    <div>
      <h1 className="mb-6 text-sm font-medium text-fg-dim">Active markets</h1>
      <MarketList />
    </div>
  );
}
