// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {RitualPredict} from "./RitualPredict.sol";
import {RitualChain} from "./ritual/RitualChain.sol";
import {MockScheduler, MockRitualWallet, MockTEEServiceRegistry, MockHttpPrecompile, MockJqPrecompile} from "./mocks/RitualMocks.sol";

contract RitualPredictTest is Test {
    uint256 constant BLOCK_TIME_MS = 200;

    RitualPredict predict;
    MockScheduler scheduler;
    MockTEEServiceRegistry registry;
    MockHttpPrecompile httpMock;
    MockJqPrecompile jqMock;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address executor = address(0xE7EC);

    function setUp() public {
        vm.etch(RitualChain.SCHEDULER, address(new MockScheduler()).code);
        vm.etch(
            RitualChain.RITUAL_WALLET,
            address(new MockRitualWallet()).code
        );
        vm.etch(
            RitualChain.TEE_SERVICE_REGISTRY,
            address(new MockTEEServiceRegistry()).code
        );
        vm.etch(
            RitualChain.HTTP_PRECOMPILE,
            address(new MockHttpPrecompile()).code
        );
        vm.etch(RitualChain.JQ_PRECOMPILE, address(new MockJqPrecompile()).code);

        scheduler = MockScheduler(RitualChain.SCHEDULER);
        registry = MockTEEServiceRegistry(RitualChain.TEE_SERVICE_REGISTRY);
        httpMock = MockHttpPrecompile(RitualChain.HTTP_PRECOMPILE);
        jqMock = MockJqPrecompile(RitualChain.JQ_PRECOMPILE);

        registry.setExecutor(executor);

        predict = new RitualPredict(BLOCK_TIME_MS);

        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
    }

    function _defaultParams()
        private
        pure
        returns (RitualPredict.NewMarket memory)
    {
        return
            RitualPredict.NewMarket({
                question: "Will ETH be >= $4000?",
                oracleUrl: "https://example.com/eth",
                jsonPath: ".price",
                target: 4000,
                comparator: RitualPredict.Comparator.GTE,
                bettingSeconds: 60,
                resolveDelaySeconds: 30
            });
    }

    // ─────────────────────────── createMarket ───────────────────────────

    function test_CreateMarket_StoresParamsAndSchedules() public {
        uint256 id = predict.createMarket(_defaultParams());
        assertEq(id, 1);

        RitualPredict.Market memory m = predict.getMarket(id);
        assertEq(m.creator, address(this));
        assertEq(m.question, "Will ETH be >= $4000?");
        assertEq(uint8(m.state), uint8(RitualPredict.MarketState.Open));
        assertGt(m.scheduleId, 0);
    }

    function test_CreateMarket_RevertsOnEmptyQuestion() public {
        RitualPredict.NewMarket memory p = _defaultParams();
        p.question = "";
        vm.expectRevert(RitualPredict.EmptyString.selector);
        predict.createMarket(p);
    }

    function test_CreateMarket_RevertsOnBettingWindowTooShort() public {
        RitualPredict.NewMarket memory p = _defaultParams();
        p.bettingSeconds = 1;
        vm.expectRevert(RitualPredict.BadDuration.selector);
        predict.createMarket(p);
    }

    // ─────────────────────────────── bet ─────────────────────────────────

    function test_Bet_TracksStakesAndPools() public {
        uint256 id = predict.createMarket(_defaultParams());

        vm.prank(alice);
        predict.bet{value: 1 ether}(id, true);
        vm.prank(bob);
        predict.bet{value: 2 ether}(id, false);

        RitualPredict.Market memory m = predict.getMarket(id);
        assertEq(m.totalYes, 1 ether);
        assertEq(m.totalNo, 2 ether);
        assertEq(predict.yesStake(id, alice), 1 ether);
        assertEq(predict.noStake(id, bob), 2 ether);
    }

    function test_Bet_RevertsAfterCloseBlock() public {
        uint256 id = predict.createMarket(_defaultParams());
        RitualPredict.Market memory m = predict.getMarket(id);
        vm.roll(m.closeBlock);

        vm.prank(alice);
        vm.expectRevert(RitualPredict.BettingClosed.selector);
        predict.bet{value: 1 ether}(id, true);
    }

    function test_Bet_RevertsOnZeroStake() public {
        uint256 id = predict.createMarket(_defaultParams());
        vm.prank(alice);
        vm.expectRevert(RitualPredict.ZeroStake.selector);
        predict.bet(id, true);
    }

    // ───────────────────────── resolution: success ─────────────────────────

    function test_Resolve_YesWinsAndPaysOut() public {
        uint256 id = predict.createMarket(_defaultParams());

        vm.prank(alice);
        predict.bet{value: 1 ether}(id, true);
        vm.prank(bob);
        predict.bet{value: 3 ether}(id, false);

        RitualPredict.Market memory m = predict.getMarket(id);
        vm.roll(m.resolveBlock);

        jqMock.setValue(4500); // >= 4000 -> Yes
        httpMock.setResponse(200, bytes("{}"), "");

        scheduler.trigger(m.scheduleId, 0);

        m = predict.getMarket(id);
        assertEq(uint8(m.state), uint8(RitualPredict.MarketState.Resolved));
        assertEq(uint8(m.outcome), uint8(RitualPredict.Outcome.Yes));
        assertEq(m.observedValue, 4500);

        uint256 before = alice.balance;
        vm.prank(alice);
        predict.claimWinnings(id);
        assertEq(alice.balance, before + 4 ether); // whole pool, sole winner
    }

    function test_Resolve_NoWinsBlocksYesClaim() public {
        uint256 id = predict.createMarket(_defaultParams());

        vm.prank(alice);
        predict.bet{value: 1 ether}(id, true);
        vm.prank(bob);
        predict.bet{value: 1 ether}(id, false);

        RitualPredict.Market memory m = predict.getMarket(id);
        vm.roll(m.resolveBlock);

        jqMock.setValue(1000); // < 4000 -> No
        httpMock.setResponse(200, bytes("{}"), "");
        scheduler.trigger(m.scheduleId, 0);

        m = predict.getMarket(id);
        assertEq(uint8(m.outcome), uint8(RitualPredict.Outcome.No));

        vm.prank(alice);
        vm.expectRevert(RitualPredict.NothingToClaim.selector);
        predict.claimWinnings(id);
    }

    // ───────────────────── resolution: failure / retry ─────────────────────

    function test_Resolve_RetriesOnFailureThenInvalidates() public {
        uint256 id = predict.createMarket(_defaultParams());

        vm.prank(alice);
        predict.bet{value: 1 ether}(id, true);

        RitualPredict.Market memory m = predict.getMarket(id);
        vm.roll(m.resolveBlock);

        httpMock.setShouldRevert(true);

        scheduler.trigger(m.scheduleId, 0);
        m = predict.getMarket(id);
        assertEq(uint8(m.state), uint8(RitualPredict.MarketState.Resolving));

        scheduler.trigger(m.scheduleId, 1);
        m = predict.getMarket(id);
        assertEq(uint8(m.state), uint8(RitualPredict.MarketState.Resolving));

        scheduler.trigger(m.scheduleId, 2);
        m = predict.getMarket(id);
        assertEq(uint8(m.state), uint8(RitualPredict.MarketState.Invalid));

        uint256 before = alice.balance;
        vm.prank(alice);
        predict.claimRefund(id);
        assertEq(alice.balance, before + 1 ether);
    }

    function test_Resolve_NoExecutorAvailableFails() public {
        uint256 id = predict.createMarket(_defaultParams());
        vm.prank(alice);
        predict.bet{value: 1 ether}(id, true);

        RitualPredict.Market memory m = predict.getMarket(id);
        vm.roll(m.resolveBlock);

        registry.setExecutor(address(0));
        scheduler.trigger(m.scheduleId, 0);

        m = predict.getMarket(id);
        assertEq(uint8(m.state), uint8(RitualPredict.MarketState.Resolving));
    }

    function test_Resolve_EmptyWinningSideInvalidates() public {
        uint256 id = predict.createMarket(_defaultParams());
        vm.prank(alice);
        predict.bet{value: 1 ether}(id, false); // only NO has stake

        RitualPredict.Market memory m = predict.getMarket(id);
        vm.roll(m.resolveBlock);

        jqMock.setValue(4500); // >= 4000 -> Yes, but nobody backed Yes
        httpMock.setResponse(200, bytes("{}"), "");
        scheduler.trigger(m.scheduleId, 0);

        m = predict.getMarket(id);
        assertEq(uint8(m.state), uint8(RitualPredict.MarketState.Invalid));

        uint256 before = alice.balance;
        vm.prank(alice);
        predict.claimRefund(id);
        assertEq(alice.balance, before + 1 ether);
    }

    function test_OnScheduledResolve_RevertsForNonScheduler() public {
        uint256 id = predict.createMarket(_defaultParams());
        vm.expectRevert(RitualPredict.OnlyScheduler.selector);
        predict.onScheduledResolve(0, id);
    }
}
