/**
 * Deploy RitualPredict to a local Hardhat node, with mock Ritual Chain precompiles
 * and system contracts etched at their canonical addresses (see contracts/mocks).
 *
 * There's no real Scheduler, HTTP precompile, or jq precompile on a local node, so
 * without this the constructor's `approveScheduler` call would revert. Once deployed,
 * pair this with `scripts/local-relay.ts` running alongside `npx hardhat node` to
 * simulate the Scheduler firing scheduled resolutions.
 *
 *   npx hardhat node                          # separate terminal, keep running
 *   npx hardhat run scripts/local-deploy.ts --network localhost
 */
import { network } from "hardhat";
import { parseEther } from "viem";
import { COMPARATOR, DEMO_MARKET } from "./market-presets.ts";
import { RITUAL } from "./ritual.ts";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const FUNDING_LOCK_BLOCKS = 500_000n;
const EXECUTION_FUNDING = parseEther("10");
const LOCAL_BLOCK_TIME_MS = 1000n;

const connection = await network.create({ network: "localhost", chainType: "l1" });
const { viem } = connection;
const publicClient = await viem.getPublicClient();
const [, executorAccount] = await viem.getWalletClients();

console.log("── Etch mocks at canonical Ritual addresses ────────────────");

async function etch(target: `0x${string}`, contractName: string) {
  const impl = await viem.deployContract(contractName);
  const bytecode = await publicClient.getCode({ address: impl.address });
  if (!bytecode) throw new Error(`no bytecode deployed for ${contractName}`);
  await connection.provider.request({
    method: "hardhat_setCode",
    params: [target, bytecode],
  });
  console.log(`${contractName.padEnd(24)} -> ${target}`);
}

await etch(RITUAL.scheduler as `0x${string}`, "MockScheduler");
await etch(RITUAL.ritualWallet as `0x${string}`, "MockRitualWallet");
await etch(RITUAL.teeServiceRegistry as `0x${string}`, "MockTEEServiceRegistry");
await etch(RITUAL.httpPrecompile as `0x${string}`, "MockHttpPrecompile");
await etch(RITUAL.jqPrecompile as `0x${string}`, "MockJqPrecompile");

const registry = await viem.getContractAt(
  "MockTEEServiceRegistry",
  RITUAL.teeServiceRegistry as `0x${string}`,
);
await registry.write.setExecutor([executorAccount.account.address]);

console.log("");
console.log("── Deploy RitualPredict ──────────────────────────────────");

const predict = await viem.deployContract("RitualPredict", [LOCAL_BLOCK_TIME_MS]);
console.log(`RitualPredict: ${predict.address}`);

const fundHash = await predict.write.fundExecution([FUNDING_LOCK_BLOCKS], {
  value: EXECUTION_FUNDING,
});
await publicClient.waitForTransactionReceipt({ hash: fundHash });
console.log(`Funded execution balance with ${EXECUTION_FUNDING} wei-scaled RITUAL`);

console.log("");
console.log("── Create demo markets ───────────────────────────────────");

// A spread of questions and windows so the list has some variety and markets
// don't all close/resolve at the exact same block.
const LOCAL_MARKETS = [
  {
    question: DEMO_MARKET.question,
    oracleUrl: DEMO_MARKET.oracleUrl,
    jsonPath: DEMO_MARKET.jsonPath,
    target: BigInt(DEMO_MARKET.target),
    comparator: COMPARATOR[DEMO_MARKET.comparator],
    bettingSeconds: 90n,
    resolveDelaySeconds: 30n,
  },
  {
    question: "Will BTC/USD be at least $100,000 when this market resolves?",
    oracleUrl: "http://localhost:3000/api/oracle/btc",
    jsonPath: ".price",
    target: 100_000n,
    comparator: COMPARATOR.gte,
    bettingSeconds: 120n,
    resolveDelaySeconds: 30n,
  },
  {
    question: "Will ETH gas stay under 50 gwei when this market resolves?",
    oracleUrl: "http://localhost:3000/api/oracle/gas",
    jsonPath: ".gwei",
    target: 50n,
    comparator: COMPARATOR.lt,
    bettingSeconds: 60n,
    resolveDelaySeconds: 30n,
  },
  {
    question: "Will Ritual Chain process over 1,000,000 transactions by resolution?",
    oracleUrl: "http://localhost:3000/api/oracle/txcount",
    jsonPath: ".count",
    target: 1_000_000n,
    comparator: COMPARATOR.gt,
    bettingSeconds: 150n,
    resolveDelaySeconds: 30n,
  },
] as const;

for (const [i, preset] of LOCAL_MARKETS.entries()) {
  const hash = await predict.write.createMarket([preset]);
  await publicClient.waitForTransactionReceipt({ hash });
  const id = BigInt(i + 1);
  const market = await predict.read.getMarket([id]);
  console.log(`#${id} ${preset.question}`);
  console.log(`  closes at block ${market.closeBlock}, resolves at block ${market.resolveBlock}`);
}

const envPath = resolve(here, "../../web/.env.local");
await mkdir(dirname(envPath), { recursive: true });
await writeFile(
  envPath,
  `NEXT_PUBLIC_PREDICT_ADDRESS=${predict.address}\n`,
  "utf8",
);
console.log("");
console.log(`Wrote ${envPath}`);
console.log("");
console.log("Next: run scripts/local-relay.ts alongside this node to auto-resolve markets,");
console.log("then `cd web && pnpm dev`.");

await connection.close();
