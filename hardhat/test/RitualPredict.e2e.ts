import { network } from "hardhat";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getAddress, parseEther, type Address, type Hex } from "viem";

// Canonical Ritual Chain addresses (contracts/ritual/RitualChain.sol).
const SCHEDULER = getAddress("0x56e776BAE2DD60664b69Bd5F865F1180ffB7D58B");
const RITUAL_WALLET = getAddress("0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948");
const TEE_SERVICE_REGISTRY = getAddress(
  "0x9644e8562cE0Fe12b4deeC4163c064A8862Bf47F",
);
const HTTP_PRECOMPILE = getAddress(
  "0x0000000000000000000000000000000000000801",
);
const JQ_PRECOMPILE = getAddress(
  "0x0000000000000000000000000000000000000803",
);

const BLOCK_TIME_MS = 200n;

// Enum values as they come back over the ABI (uint8).
const MarketState = { Open: 0, Closed: 1, Resolving: 2, Resolved: 3, Invalid: 4 };
const Outcome = { Unresolved: 0, Yes: 1, No: 2 };
const Comparator = { GT: 0, GTE: 1, LT: 2, LTE: 3 };

describe("RitualPredict e2e", async function () {
  const { viem, networkHelpers } = await network.create();

  /// Deploys a throwaway instance of `contractName` purely to harvest its runtime
  /// bytecode, then writes that bytecode at the canonical `target` address — the
  /// TypeScript-side equivalent of the Solidity tests' `vm.etch`. Like `vm.etch`, this
  /// does not run the mock's constructor, so its storage starts zeroed.
  async function etch(target: Address, contractName: string) {
    const publicClient = await viem.getPublicClient();
    const testClient = await viem.getTestClient();
    const impl = await viem.deployContract(contractName);
    const bytecode = await publicClient.getCode({ address: impl.address });
    if (!bytecode) {
      throw new Error(`no bytecode deployed for ${contractName}`);
    }
    await testClient.setCode({ address: target, bytecode: bytecode as Hex });
  }

  async function deployPredict() {
    await etch(SCHEDULER, "MockScheduler");
    await etch(RITUAL_WALLET, "MockRitualWallet");
    await etch(TEE_SERVICE_REGISTRY, "MockTEEServiceRegistry");
    await etch(HTTP_PRECOMPILE, "MockHttpPrecompile");
    await etch(JQ_PRECOMPILE, "MockJqPrecompile");

    const [, alice, bob, executorAccount] = await viem.getWalletClients();

    const registry = await viem.getContractAt(
      "MockTEEServiceRegistry",
      TEE_SERVICE_REGISTRY,
    );
    await registry.write.setExecutor([executorAccount.account.address]);

    const predict = await viem.deployContract("RitualPredict", [
      BLOCK_TIME_MS,
    ]);

    const scheduler = await viem.getContractAt("MockScheduler", SCHEDULER);
    const http = await viem.getContractAt(
      "MockHttpPrecompile",
      HTTP_PRECOMPILE,
    );
    const jq = await viem.getContractAt("MockJqPrecompile", JQ_PRECOMPILE);

    return { predict, scheduler, http, jq, registry, alice, bob };
  }

  function defaultParams() {
    return {
      question: "Will ETH be >= $4000?",
      oracleUrl: "https://example.com/eth",
      jsonPath: ".price",
      target: 4000n,
      comparator: Comparator.GTE,
      bettingSeconds: 60n,
      resolveDelaySeconds: 30n,
    };
  }

  it("resolves YES end-to-end, and the winner claims the whole pool", async function () {
    const { predict, scheduler, http, jq, alice, bob } =
      await networkHelpers.loadFixture(deployPredict);

    await predict.write.createMarket([defaultParams()]);
    const market = await predict.read.getMarket([1n]);

    await predict.write.bet([1n, true], {
      account: alice.account,
      value: parseEther("1"),
    });
    await predict.write.bet([1n, false], {
      account: bob.account,
      value: parseEther("3"),
    });

    const publicClient = await viem.getPublicClient();
    const currentBlock = await publicClient.getBlockNumber();
    await networkHelpers.mine(
      Number(market.resolveBlock) - Number(currentBlock) + 1,
    );

    await jq.write.setValue([4500n]);
    await http.write.setResponse([200, "0x", ""]);

    // Explicit gas: the trigger -> onScheduledResolve -> _readOracle chain nests
    // several external calls (registry, HTTP mock, jq mock, the self-call through
    // decodeHttpResponse's try/catch), which eth_estimateGas underestimates for.
    await scheduler.write.trigger([market.scheduleId, 0n], {
      gas: 5_000_000n,
    });

    const resolved = await predict.read.getMarket([1n]);
    assert.equal(resolved.state, MarketState.Resolved);
    assert.equal(resolved.outcome, Outcome.Yes);
    assert.equal(resolved.observedValue, 4500n);

    await viem.assertions.balancesHaveChanged(
      predict.write.claimWinnings([1n], { account: alice.account }),
      [{ address: alice.account.address, amount: parseEther("4") }],
    );
  });

  it("invalidates after all resolution attempts fail, and stakers get refunded", async function () {
    const { predict, scheduler, http, alice } =
      await networkHelpers.loadFixture(deployPredict);

    await predict.write.createMarket([defaultParams()]);
    await predict.write.bet([1n, true], {
      account: alice.account,
      value: parseEther("1"),
    });

    const market = await predict.read.getMarket([1n]);
    const publicClient = await viem.getPublicClient();
    const currentBlock = await publicClient.getBlockNumber();
    await networkHelpers.mine(
      Number(market.resolveBlock) - Number(currentBlock) + 1,
    );

    await http.write.setShouldRevert([true]);
    await scheduler.write.trigger([market.scheduleId, 0n], {
      gas: 5_000_000n,
    });
    await scheduler.write.trigger([market.scheduleId, 1n], {
      gas: 5_000_000n,
    });
    await scheduler.write.trigger([market.scheduleId, 2n], {
      gas: 5_000_000n,
    });

    const invalidated = await predict.read.getMarket([1n]);
    assert.equal(invalidated.state, MarketState.Invalid);

    await viem.assertions.balancesHaveChanged(
      predict.write.claimRefund([1n], { account: alice.account }),
      [{ address: alice.account.address, amount: parseEther("1") }],
    );
  });

  it("rejects onScheduledResolve from anyone other than the Scheduler", async function () {
    const { predict } = await networkHelpers.loadFixture(deployPredict);

    await predict.write.createMarket([defaultParams()]);

    await viem.assertions.revertWithCustomError(
      predict.write.onScheduledResolve([0n, 1n]),
      predict,
      "OnlyScheduler",
    );
  });
});
