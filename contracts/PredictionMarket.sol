// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title PredictionMarket (PoC)
/// @notice Minimal parimutuel YES/NO prediction rounds paid in the native coin.
/// @dev Demo only: no fees, no oracle integration, single trusted resolver. Not audited.
contract PredictionMarket {
    struct Round {
        string question;
        uint64 closesAt;   // unix time after which no new predictions are accepted
        bool resolved;
        bool yesWon;
        uint256 yesPool;
        uint256 noPool;
    }

    address public immutable resolver;
    uint256 public roundCount;

    mapping(uint256 => Round) private _rounds;
    // roundId => user => side (true = YES) => staked amount
    mapping(uint256 => mapping(address => mapping(bool => uint256))) private _stakes;

    event RoundCreated(uint256 indexed roundId, string question, uint64 closesAt);
    event Predicted(uint256 indexed roundId, address indexed user, bool yes, uint256 amount);
    event Resolved(uint256 indexed roundId, bool yesWon);
    event Claimed(uint256 indexed roundId, address indexed user, uint256 amount);

    error NotResolver();
    error RoundClosed();
    error RoundNotClosed();
    error AlreadyResolved();
    error NotResolved();
    error NothingToClaim();
    error ZeroStake();
    error BadRound();
    error TransferFailed();

    constructor() {
        resolver = msg.sender;
    }

    modifier onlyResolver() {
        if (msg.sender != resolver) revert NotResolver();
        _;
    }

    /// @notice Open a new round.
    function createRound(string calldata question, uint64 closesAt) external onlyResolver returns (uint256 id) {
        if (closesAt <= block.timestamp) revert BadRound();
        id = ++roundCount;
        _rounds[id].question = question;
        _rounds[id].closesAt = closesAt;
        emit RoundCreated(id, question, closesAt);
    }

    /// @notice Stake the sent value on YES (true) or NO (false).
    function predict(uint256 roundId, bool yes) external payable {
        Round storage r = _rounds[roundId];
        if (r.closesAt == 0) revert BadRound();
        if (block.timestamp >= r.closesAt || r.resolved) revert RoundClosed();
        if (msg.value == 0) revert ZeroStake();

        _stakes[roundId][msg.sender][yes] += msg.value;
        if (yes) r.yesPool += msg.value;
        else r.noPool += msg.value;

        emit Predicted(roundId, msg.sender, yes, msg.value);
    }

    /// @notice Resolver sets the outcome once the round is closed.
    function resolve(uint256 roundId, bool yesWon) external onlyResolver {
        Round storage r = _rounds[roundId];
        if (r.closesAt == 0) revert BadRound();
        if (block.timestamp < r.closesAt) revert RoundNotClosed();
        if (r.resolved) revert AlreadyResolved();

        r.resolved = true;
        r.yesWon = yesWon;
        emit Resolved(roundId, yesWon);
    }

    /// @notice Winners receive a pro-rata share of the whole pool.
    ///         If nobody bet on the winning side, everyone gets their stake back.
    function claim(uint256 roundId) external {
        Round storage r = _rounds[roundId];
        if (!r.resolved) revert NotResolved();

        uint256 yesStake = _stakes[roundId][msg.sender][true];
        uint256 noStake = _stakes[roundId][msg.sender][false];
        uint256 winningPool = r.yesWon ? r.yesPool : r.noPool;
        uint256 payout;

        if (winningPool == 0) {
            payout = yesStake + noStake; // refund
        } else {
            uint256 myWinStake = r.yesWon ? yesStake : noStake;
            payout = (myWinStake * (r.yesPool + r.noPool)) / winningPool;
        }
        if (payout == 0) revert NothingToClaim();

        // effects before interaction
        _stakes[roundId][msg.sender][true] = 0;
        _stakes[roundId][msg.sender][false] = 0;

        (bool ok, ) = msg.sender.call{value: payout}("");
        if (!ok) revert TransferFailed();
        emit Claimed(roundId, msg.sender, payout);
    }

    // ---------- views (used by the SDK) ----------

    function getRound(uint256 roundId) external view returns (Round memory) {
        return _rounds[roundId];
    }

    function getStakes(uint256 roundId, address user) external view returns (uint256 yesStake, uint256 noStake) {
        return (_stakes[roundId][user][true], _stakes[roundId][user][false]);
    }
}
