import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          // MockHttpPrecompile decodes the same wide 13-field precompile calldata
          // RitualPredict._readOracle encodes; the legacy codegen can't fit that many
          // ABI-decoded locals (several dynamic-typed) on the stack at once.
          viaIR: true,
        },
      },
      production: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          viaIR: true,
        },
      },
    },
  },
  networks: {
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
    },
    // A persistent local node (`npx hardhat node`), as opposed to hardhatMainnet's
    // throwaway in-process chain. Scripts and the frontend both target this so state
    // (deployed contracts, markets, bets) survives between commands.
    localhost: {
      type: "http",
      chainType: "l1",
      url: "http://127.0.0.1:8545",
    },
    // Ritual Chain testnet. Requires EIP-1559 (type-2) transactions; viem sends
    // those by default.
    ritual: {
      type: "http",
      chainType: "l1",
      chainId: 1979,
      url: "https://rpc.ritualfoundation.org",
      accounts: [configVariable("DEPLOYER_PRIVATE_KEY")],
    },
  },
});
