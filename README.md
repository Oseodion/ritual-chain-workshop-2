# Ritual Predict

A self-resolving binary prediction market on [Ritual Chain](https://docs.ritualfoundation.org), with a frontend to use it.

Create a market like "Will ETH/USD be at least $4,000 when this market resolves?", stake native RITUAL on YES or NO, and watch it settle itself. When the betting window closes, nobody presses a resolve button and no backend cron job runs. The Ritual Scheduler wakes the contract at a block fixed when the market was created. The contract calls the HTTP precompile to read the configured oracle URL, extracts one number with the jq precompile, compares it to the target, and settles. Winners then pull their proportional share of the pool.

```
                 createMarket()                    ┌──────────────────────────┐
   user  ─────────────────────────────────────────▶│  RitualPredict.sol       │
   user  ─────────── bet(id, YES|NO) ─────────────▶│                          │
                                                    │  markets, pools, stakes  │
                                     schedule() ◀──┤                          │
                                                    └──────────────────────────┘
    ┌─────────────────────────────┐                     ▲              │
    │ Scheduler  0x56e7…D58B      │  onScheduledResolve │              │ deposit()
    │ system contract             │─────────────────────┘              ▼
    │ fires at resolveBlock,      │                        ┌────────────────────────┐
    │ 3 attempts, 200 blocks apart│                        │ RitualWallet 0x532F…   │
    └─────────────────────────────┘                        │ prepaid execution fees │
                                                            └────────────────────────┘
                        inside that one scheduled transaction:

   TEEServiceRegistry 0x9644…  ──pickServiceByCapability(HTTP_CALL)──▶  executor address
   HTTP precompile    0x0801   ──GET oracleUrl (in a TEE)───────────▶  demo oracle
   jq  precompile     0x0803   ──jsonPath, outputType=uint256───────▶  observed value
                                          │
                                          ▼
                        observed vs target  →  Resolved(YES|NO)
                        read failed 3 times →  Invalid (everyone refunds)
```

## Repo layout

```
hardhat/     Solidity contracts, mocks, tests, deploy scripts
web/         Next.js frontend
```

## What's here

**Contract** (`hardhat/contracts/RitualPredict.sol`): market creation, betting, self-resolution via the Scheduler callback, and pull-based payouts. See the "Design decisions" section below for the details that aren't obvious from the code.

**Mocks** (`hardhat/contracts/mocks/RitualMocks.sol`): stand-ins for the Scheduler, RitualWallet, TEEServiceRegistry, and the HTTP and jq precompiles. Tests and local development etch these onto the canonical Ritual addresses, so nothing needs a real chain or a real oracle.

**Tests**: 12 Solidity unit tests (`hardhat/contracts/RitualPredict.t.sol`) covering market creation, betting, and every resolution path (win, loss, refund on an empty side, retry then invalidate, no executor available, and the Scheduler-only auth check). 3 TypeScript end-to-end tests (`hardhat/test/RitualPredict.e2e.ts`) driving the same flows through real transactions with viem.

**Local dev scripts** (`hardhat/scripts/local-deploy.ts`, `local-relay.ts`): deploy the mocks and contract to a local Hardhat node, seed 4 demo markets, and simulate the Scheduler firing scheduled resolutions, since there's no real one on a local node.

**Frontend** (`web/`): Next.js with wagmi and viem, MetaMask wallet connect, a live market list with betting and claiming.

## Design decisions worth knowing

**Deadlines are block numbers, not timestamps.** The Scheduler fires at a block, so betting also closes at a block. That way "betting is closed" and "the Scheduler woke us" can never disagree, whatever the chain's block time does. `createMarket` takes human durations in seconds and converts them using the `blockTimeMs` fixed at deployment. Nothing on-chain reads `block.timestamp`.

**On Ritual Chain, `block.timestamp` is Unix milliseconds** (about `1.786e12`), not seconds, verified against the live chain, not assumed. That's a good reason to avoid it entirely, which this contract does. Measured block time was about 195ms when this was written; run `npx hardhat run scripts/block-time.ts` to check it yourself.

**A failed oracle read is never a NO.** `onScheduledResolve` treats a precompile failure, a non-200 response, an undecodable envelope, an executor error message, and an unparseable body all as failures, not as a negative outcome. The response decode happens through an external `try`, so malformed bytes surface as a caught failure instead of reverting the execution and rolling back the attempt counter.

**Retries are the Scheduler's own mechanism.** `createMarket` books 3 executions 200 blocks apart in a single `schedule()` call. Attempt 1 lands at `resolveBlock`; if it succeeds, the contract cancels the remainder; if all three fail, the market becomes `Invalid` and every stake is refundable. Each attempt re-rolls the TEE executor seed, so one unhealthy executor cannot sink a market.

**No executor is hardcoded.** The contract calls `TEEServiceRegistry.pickServiceByCapability` at resolution time and picks from whatever's attested and healthy.

**Payouts are pull-based and loop-free.** `claimWinnings` computes `stake * totalPool / winningPool` for the caller only. Integer division leaves sub-wei dust in the contract; that's deliberate and negligible.

**Empty winning side is refundable.** Pari-mutuel has no denominator when nobody backed the winning answer, so the market records the outcome and observed value, then becomes `Invalid` so everyone takes their stake back.

**Resolution parameters are immutable.** `target`, `comparator`, `oracleUrl`, `jsonPath`, and `resolveBlock` have no setter. The `ResolutionRuleSet` event records them at creation.

## Running the tests

```bash
cd hardhat
npx hardhat build
npx hardhat test solidity
npx hardhat test nodejs test/RitualPredict.e2e.ts
```

## Running locally

Four terminals: a local chain, a deploy step, a resolution relay, and the frontend.

```bash
# Terminal 1: local chain
cd hardhat
npx hardhat node
```

```bash
# Terminal 2: deploy mocks, the contract, and 4 demo markets
cd hardhat
npx hardhat run scripts/local-deploy.ts --network localhost
```

```bash
# Terminal 3: simulate the Scheduler (there isn't a real one on a local node)
cd hardhat
PREDICT_ADDRESS=$(grep -o '0x[a-fA-F0-9]*' ../web/.env.local) npx hardhat run scripts/local-relay.ts --network localhost
```

```bash
# Terminal 4: frontend
cd web
pnpm install
pnpm dev
```

Open http://localhost:3000 and connect MetaMask. If it's not already added, the app will prompt to add Hardhat Local (chain ID 31337, RPC `http://127.0.0.1:8545`).

## Running on Ritual Chain testnet

```bash
cd hardhat
pnpm install
cp .env.example .env
```

Fund the deployer key from https://faucet.ritualfoundation.org, then see `hardhat/scripts/deploy.ts`.

## Scope

Intentionally not included: an AMM, an order book, an order-matching engine, governance, a separate ERC-20, a centralized resolver, or an upgrade proxy. Staking uses the chain's native asset, and the betting model is plain pari-mutuel: two running totals and one mapping per side.

## Reference

- Ritual Chain docs: https://docs.ritualfoundation.org
- dApp skills: https://github.com/ritual-foundation/ritual-dapp-skills
- Explorer: https://explorer.ritualfoundation.org
- Faucet: https://faucet.ritualfoundation.org
