// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../governance/implementation/Governed.sol";
import "../../utils/implementation/SafePct.sol";


/**
 * @title Incentive pool treasury
 * @notice A genesis contract which holds the entire treasury for the incentive pool.
 *         It enables limited flow of funds to the incentive pool.
 */
contract IncentivePoolTreasury is Governed {
    using SafePct for uint256;

    // How often can incentive pool pull funds - 23 hours constant
    uint256 internal constant MAX_PULL_FREQUENCY_SEC = 23 hours;
    // Initial max pull request - 25 million native token
    uint256 internal constant MAX_DAILY_PULL_AMOUNT_WEI = 25000000 ether;
    // How often can the maximal pull request amount be updated
    uint256 internal constant MAX_PULL_REQUEST_FREQUENCY_SEC = 7 days;
    // By how much can the maximum be increased (as a percentage of the previous maximum)
    uint256 internal constant MAX_PULL_REQUEST_INCREASE_PERCENT = 110;

    // Errors
    string internal constant ERR_INCENTIVE_POOL_ONLY = "incentive pool only";
    string internal constant ERR_TOO_OFTEN = "too often";
    string internal constant ERR_TOO_MUCH = "too much";
    string internal constant ERR_PULL_FAILED = "pull failed";
    string internal constant ERR_ADDRESS_ZERO = "address zero";
    string internal constant ERR_ONLY_GOVERNANCE = "only governance";
    string internal constant ERR_UPDATE_GAP_TOO_SHORT = "time gap too short";
    string internal constant ERR_MAX_PULL_TOO_HIGH = "max pull too high";
    string internal constant ERR_MAX_PULL_IS_ZERO = "max pull is zero";

    // Storage
    address public incentivePool;
    uint256 public maxPullRequestWei;
    uint256 public lastPullTs;
    uint256 public lastUpdateMaxPullRequestTs;


    modifier onlyIncentivePool {
        require (msg.sender == incentivePool, ERR_INCENTIVE_POOL_ONLY);
        _;
    }

    constructor(address _governance) Governed(_governance) {
        maxPullRequestWei = MAX_DAILY_PULL_AMOUNT_WEI;
    }

    /**
     * @notice Needed in order to receive funds from governance address
     */
    receive() external payable {
        require(msg.sender == governance(), ERR_ONLY_GOVERNANCE);
    }

    /**
     * @notice Sets incentive pool contract address.
     * @param _incentivePool            Incentive pool contract address.
     */
    function setIncentivePoolContract(address _incentivePool) external onlyGovernance {
        require(_incentivePool != address(0), ERR_ADDRESS_ZERO);
        incentivePool = _incentivePool;
    }

    /**
     * @notice Moves funds to the incentive pool contract (once per day)
     * @param _amountWei   The amount of wei to pull to incentive pool contract
     */
    function pullFunds(uint256 _amountWei) external onlyIncentivePool {
        // this also serves as reentrancy guard, since any re-entry will happen in the same block
        require(lastPullTs + MAX_PULL_FREQUENCY_SEC <= block.timestamp, ERR_TOO_OFTEN);
        require(_amountWei <= MAX_DAILY_PULL_AMOUNT_WEI, ERR_TOO_MUCH);
        lastPullTs = block.timestamp;
        /* solhint-disable avoid-low-level-calls */
        //slither-disable-next-line arbitrary-send-eth
        (bool success, ) = msg.sender.call{value: _amountWei}("");
        /* solhint-enable avoid-low-level-calls */
        require(success, ERR_PULL_FAILED);
    }

    /**
     * @notice Set limit on how much can be pulled per request.
     * @param _maxPullRequestWei    The request maximum in wei.
     * @notice this number can't be updated too often
     */
    function setMaxPullRequest(uint256 _maxPullRequestWei) external onlyGovernance {
        // make sure increase amount is reasonable
        require(
            _maxPullRequestWei <= (maxPullRequestWei.mulDiv(MAX_PULL_REQUEST_INCREASE_PERCENT, 100)),
            ERR_MAX_PULL_TOO_HIGH
        );
        require(_maxPullRequestWei > 0, ERR_MAX_PULL_IS_ZERO);
        // make sure enough time since last update
        require(
            block.timestamp > lastUpdateMaxPullRequestTs + MAX_PULL_REQUEST_FREQUENCY_SEC,
            ERR_UPDATE_GAP_TOO_SHORT
        );

        maxPullRequestWei = _maxPullRequestWei;
        lastUpdateMaxPullRequestTs = block.timestamp;
    }
}
