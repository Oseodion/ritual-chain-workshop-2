import { defineChain } from "viem";

// The chain `npx hardhat node` runs, with the mock Ritual system contracts etched at
// their canonical addresses by hardhat/scripts/local-deploy.ts.
export const localHardhat = defineChain({
  id: 31337,
  name: "Hardhat Local",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["http://127.0.0.1:8545"] },
  },
});
