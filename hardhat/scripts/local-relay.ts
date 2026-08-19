/**
 * Simulates the Ritual Scheduler for a local node: polls every market and, once its
 * resolveBlock has passed, fires the mock Scheduler's `trigger()` — exactly what the
 * real Scheduler does automatically on Ritual Chain. Also feeds the mock HTTP/jq
 * precompiles a plausible observed value before each attempt, since there's no real
 * oracle to call locally.
 *
 * Run this in its own terminal, alongside `npx hardhat node`, after local-deploy.ts:
 *
 *   npx hardhat run scripts/local-relay.ts --network localhost
 */
import { network } from "hardhat";
import { MARKET_STATE, OUTCOME } from "./market-presets.ts";
import { RITUAL } from "./ritual.ts";

const POLL_INTERVAL_MS = 2000;
const TERMINAL_STATES = new Set(["Resolved", "Invalid"]);

const address = process.env.PREDICT_ADDRESS;
if (!address) {
  throw new Error(
    "Set PREDICT_ADDRESS to the RitualPredict address printed by local-deploy.ts.",
  );
}

const connection = await network.create({ network: "localhost", chainType: "l1" });
const { viem } = connection;
const publicClient = await viem.getPublicClient();

const predict = await viem.getContractAt("RitualPredict", address as `0x${string}`);
const scheduler = await viem.getContractAt("MockScheduler", RITUAL.scheduler as `0x${string}`);
const http = await viem.getContractAt("MockHttpPrecompile", RITUAL.httpPrecompile as `0x${string}`);
const jq = await viem.getContractAt("MockJqPrecompile", RITUAL.jqPrecompile as `0x${string}`);

console.log(`Watching ${predict.address} for markets past their resolve block...`);

const seen = new Map<bigint, string>();

async function tick() {
  const currentBlock = await publicClient.getBlockNumber();
  const count = await predict.read.marketCount();

  for (let id = 1n; id <= count; id++) {
    const market = await predict.read.getMarket([id]);
    const state = MARKET_STATE[market.state];

    if (seen.get(id) !== state) {
      console.log(`#${id} -> ${state}${market.outcome ? ` (${OUTCOME[market.outcome]})` : ""}`);
      seen.set(id, state);
    }

    if (TERMINAL_STATES.has(state)) continue;
    if (currentBlock < market.resolveBlock) continue;

    // A plausible reading near the market's target, so outcomes vary run to run.
    const jitter = Math.round(Number(market.target) * (Math.random() * 0.4 - 0.2));
    const observed = BigInt(Math.max(0, Number(market.target) + jitter));

    try {
      await jq.write.setValue([observed]);
      await http.write.setResponse([200, "0x7b7d", ""]); // "{}"
      await scheduler.write.trigger([market.scheduleId, BigInt(market.attempts)], {
        gas: 5_000_000n,
      });
      console.log(`#${id} resolution attempt ${market.attempts + 1} fired, observed=${observed}`);
    } catch (err) {
      console.error(`#${id} resolution attempt failed:`, (err as Error).message);
    }
  }
}

while (true) {
  await tick();
  await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
}
