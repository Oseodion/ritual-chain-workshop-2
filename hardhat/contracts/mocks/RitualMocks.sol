// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IScheduler, IRitualWallet, ITEEServiceRegistry} from "../ritual/RitualChain.sol";

/**
 * Test-only stand-ins for the Ritual Chain precompiles and system contracts.
 *
 * `vm.etch` (Solidity tests) or `testClient.setCode` (TypeScript tests) places each
 * mock's runtime bytecode at the canonical Ritual address (see ritual/RitualChain.sol),
 * so RitualPredict's unmodified calls to those addresses land here. No network access
 * or funded account is needed.
 */

/// Records every scheduled call and exposes `trigger` so a test can simulate the
/// Scheduler firing a booked execution, writing `executionIndex` into calldata bytes
/// 4-35 exactly as the real Scheduler does.
contract MockScheduler is IScheduler {
    struct ScheduledCall {
        address target;
        bytes data;
        uint32 numCalls;
        uint32 executed;
        bool canceled;
    }

    /// Starts at storage's zero-value both freshly deployed and after `vm.etch` /
    /// `setCode` (neither runs Solidity's storage initializers), so callIds are
    /// assigned with pre-increment to still start at 1.
    uint256 public nextCallId;
    mapping(uint256 => ScheduledCall) public calls;

    function schedule(
        bytes calldata data,
        uint32 /* gas */,
        uint32 /* startBlock */,
        uint32 numCalls,
        uint32 /* frequency */,
        uint32 /* ttl */,
        uint256 /* maxFeePerGas */,
        uint256 /* maxPriorityFeePerGas */,
        uint256 /* value */,
        address /* payer */
    ) external override returns (uint256 callId) {
        callId = ++nextCallId;
        calls[callId] = ScheduledCall({
            target: msg.sender,
            data: data,
            numCalls: numCalls,
            executed: 0,
            canceled: false
        });
    }

    function cancel(uint256 callId) external override {
        calls[callId].canceled = true;
    }

    function getCallState(
        uint256 callId
    ) external view override returns (uint8) {
        ScheduledCall storage c = calls[callId];
        if (c.canceled) return 2;
        if (c.executed >= c.numCalls) return 1;
        return 0;
    }

    function approveScheduler(address) external override {}

    function isCanceled(uint256 callId) external view returns (bool) {
        return calls[callId].canceled;
    }

    /// Test-only: fires one booked execution against whatever contract called
    /// `schedule()`, exactly as the real Scheduler would.
    function trigger(
        uint256 callId,
        uint256 executionIndex
    ) external returns (bool ok, bytes memory ret) {
        ScheduledCall storage c = calls[callId];
        require(!c.canceled, "MockScheduler: canceled");
        require(c.executed < c.numCalls, "MockScheduler: exhausted");
        c.executed++;

        bytes memory data = c.data;
        assembly {
            mstore(add(data, 36), executionIndex)
        }
        (ok, ret) = c.target.call(data);
    }
}

/// Simple balance + lock ledger, enough to exercise `fundExecution` / `executionBalance`.
contract MockRitualWallet is IRitualWallet {
    mapping(address => uint256) public balances;
    mapping(address => uint256) public locks;

    function deposit(uint256 lockDurationBlocks) external payable override {
        balances[msg.sender] += msg.value;
        locks[msg.sender] = block.number + lockDurationBlocks;
    }

    function balanceOf(
        address account
    ) external view override returns (uint256) {
        return balances[account];
    }

    function lockUntil(
        address account
    ) external view override returns (uint256) {
        return locks[account];
    }
}

/// Single settable executor. `executor` defaults to the zero address (both freshly
/// deployed and after `vm.etch`/`setCode`, which never run Solidity's storage
/// initializers), so a test opts in with `setExecutor(...)` and simulates "no executor
/// available" with `setExecutor(address(0))`.
contract MockTEEServiceRegistry is ITEEServiceRegistry {
    address public executor;

    function setExecutor(address executor_) external {
        executor = executor_;
    }

    function pickServiceByCapability(
        uint8 /* capability */,
        bool /* checkValidity */,
        uint256 /* seed */,
        uint256 /* maxProbes */
    ) external view override returns (address teeAddress, bool found) {
        if (executor == address(0)) return (address(0), false);
        return (executor, true);
    }
}

/// Stand-in for the HTTP call precompile (0x0801). Decodes the same 13-field request
/// RitualPredict._readOracle encodes, and returns a canned, settable response wrapped
/// in the short-running async envelope RitualPredict.decodeHttpResponse expects.
contract MockHttpPrecompile {
    /// No sensible zero-value default exists for an HTTP status, so a test must call
    /// `setResponse` before triggering a resolution it expects to succeed (storage
    /// initializers don't run after `vm.etch` / `setCode`; see MockScheduler.nextCallId).
    uint16 public responseStatus;
    bytes public responseBody;
    string public responseError;
    bool public shouldRevert;

    address public lastExecutor;
    string public lastUrl;
    uint8 public lastMethod;

    function setResponse(
        uint16 status_,
        bytes calldata body_,
        string calldata error_
    ) external {
        responseStatus = status_;
        responseBody = body_;
        responseError = error_;
        shouldRevert = false;
    }

    function setShouldRevert(bool shouldRevert_) external {
        shouldRevert = shouldRevert_;
    }

    fallback(bytes calldata input) external returns (bytes memory) {
        (
            address executor,
            ,
            ,
            ,
            ,
            string memory url,
            uint8 method,
            ,
            ,
            ,
            ,
            ,

        ) = abi.decode(
                input,
                (
                    address,
                    bytes[],
                    uint256,
                    bytes[],
                    bytes,
                    string,
                    uint8,
                    string[],
                    string[],
                    bytes,
                    uint256,
                    uint8,
                    bool
                )
            );
        if (shouldRevert) revert("MockHttpPrecompile: forced failure");

        lastExecutor = executor;
        lastUrl = url;
        lastMethod = method;

        string[] memory empty = new string[](0);
        bytes memory actualOutput = abi.encode(
            responseStatus,
            empty,
            empty,
            responseBody,
            responseError
        );
        return abi.encode(bytes(""), actualOutput);
    }
}

/// Stand-in for the jq precompile (0x0803). Not a real JSON/jq engine — returns a
/// settable canned value, which is all RitualPredict._jqUint's caller needs to be
/// tested against. A test must call `setValue` before triggering a resolution it
/// expects to succeed — `succeed` defaults to false (storage initializers don't run
/// after `vm.etch` / `setCode`), which conveniently mirrors the real precompile's
/// "wrong outputType" zero-length-output behaviour until then.
contract MockJqPrecompile {
    uint256 public value;
    bool public succeed;

    function setValue(uint256 value_) external {
        value = value_;
        succeed = true;
    }

    function setFailure() external {
        succeed = false;
    }

    fallback(bytes calldata) external returns (bytes memory) {
        if (!succeed) return "";
        return abi.encode(value);
    }
}
