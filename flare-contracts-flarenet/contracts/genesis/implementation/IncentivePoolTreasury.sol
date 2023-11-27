// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../governance/implementation/GovernedAtGenesis.sol";


/**
 * @title Incentive pool treasury
 * @notice A genesis contract which holds the entire treasury for the incentive pool.
 *         It enables limited flow of funds to the incentive pool.
 */
contract IncentivePoolTreasury is GovernedAtGenesis {

    // How often can incentive pool pull funds - 23 hours constant
    uint256 internal constant MAX_PULL_FREQUENCY_SEC = 23 hours;
    uint256 public constant MAX_DAILY_PULL_AMOUNT_WEI = 25000000 ether;

    // Errors
    string internal constant ERR_INCENTIVE_POOL_ONLY = "incentive pool only";
    string internal constant ERR_TOO_OFTEN = "too often";
    string internal constant ERR_TOO_MUCH = "too much";
    string internal constant ERR_PULL_FAILED = "pull failed";
    string internal constant ERR_ALREADY_SET = "already set";

    // Storage
    address public incentivePool;
    uint256 public lastPullTs;


    modifier onlyIncentivePool {
        require (msg.sender == incentivePool, ERR_INCENTIVE_POOL_ONLY);
        _;
    }

    /**
     * @dev This constructor should contain no code as this contract is pre-loaded into the genesis block.
     *   The super constructor is called for testing convenience.
     */
    constructor() GovernedAtGenesis(address(0)) {
        /* empty block */
    }

    /**
     * @notice Sets incentive pool contract address.
     * @param _incentivePool            Incentive pool contract address.
     */
    function setIncentivePoolContract(address _incentivePool) external onlyGovernance {
        require(incentivePool == address(0), ERR_ALREADY_SET);
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
}
