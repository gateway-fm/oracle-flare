// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../governance/implementation/Governed.sol";


/**
 * @title Distribution treasury
 * @notice A contract used to hold funds until the distribution plan is chosen.
 */
contract DistributionTreasury is Governed {

    // How often can the distribution contract pull funds - 29 days constant
    uint256 internal constant MAX_PULL_FREQUENCY_SEC = 29 days;
    uint256 public constant MAX_PULL_AMOUNT_WEI = 725000000 ether;

    // Errors
    string internal constant ERR_DISTRIBUTION_ONLY = "distribution only";
    string internal constant ERR_TOO_OFTEN = "too often";
    string internal constant ERR_TOO_MUCH = "too much";
    string internal constant ERR_SEND_FUNDS_FAILED = "send funds failed";
    string internal constant ERR_ADDRESS_ZERO = "address zero";
    string internal constant ERR_ONLY_GOVERNANCE_OR_DISTRIBUTION = "only governance or distribution";

    // Storage
    address public distribution;
    uint256 public lastPullTs;


    modifier onlyDistribution {
        require (msg.sender == distribution, ERR_DISTRIBUTION_ONLY);
        _;
    }

    constructor(address _governance) Governed(_governance) {
        /* empty block */
    }

    /**
     * @notice Needed in order to receive funds from governance address or from distibution (if stopped)
     */
    receive() external payable {
        require(msg.sender == governance() || msg.sender == distribution, ERR_ONLY_GOVERNANCE_OR_DISTRIBUTION);
    }

    /**
     * @notice Sets distribution contract address.
     * @param _distribution     Distribution contract address.
     */
    function setDistributionContract(address _distribution) external onlyGovernance {
        require(_distribution != address(0), ERR_ADDRESS_ZERO);
        distribution = _distribution;
    }

    /**
     * @notice Moves funds to the distribution contract (once per month)
     * @param _amountWei   The amount of wei to pull to distribution contract
     */
    function pullFunds(uint256 _amountWei) external onlyDistribution {
        // this also serves as reentrancy guard, since any re-entry will happen in the same block
        require(lastPullTs + MAX_PULL_FREQUENCY_SEC <= block.timestamp, ERR_TOO_OFTEN);
        require(_amountWei <= MAX_PULL_AMOUNT_WEI, ERR_TOO_MUCH);
        lastPullTs = block.timestamp;
        _sendFunds(msg.sender, _amountWei);
    }

    function _sendFunds(address _recipient, uint256 _amountWei) internal {
        /* solhint-disable avoid-low-level-calls */
        //slither-disable-next-line arbitrary-send-eth
        (bool success, ) = _recipient.call{value: _amountWei}("");
        /* solhint-enable avoid-low-level-calls */
        require(success, ERR_SEND_FUNDS_FAILED);
    }
}
