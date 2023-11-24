// (c) 2021, Flare Networks Limited. All rights reserved.
// Please see the file LICENSE for licensing terms.

// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../userInterfaces/IGovernanceSettings.sol";


/**
 * A special contract that holds the Flare governance address and its timelock.
 *
 * All governance calls are delayed by the timelock specified in this contract.
 *
 * This contract enables updating governance address and timelock only by hard-forking the network,
 * this is, only by updating validator code.
 */
contract GovernanceSettings is IGovernanceSettings {

    address public constant SIGNAL_COINBASE = address(0x00000000000000000000000000000000000dEAD0);

    uint256 internal constant MAX_TIMELOCK = 365 days;

    address internal constant GENESIS_GOVERNANCE = 0xfffEc6C83c8BF5c3F4AE0cCF8c45CE20E4560BD7;

    // governance address set by the validator (set in initialise call, can be changed by fork)
    address private governanceAddress;

    // global timelock setting (in seconds), also set by validator (set in initialise call, can be changed by fork)
    uint64 private timelock;

    // prevent double initialisation
    bool private initialised;

    // executor addresses, changeable anytime by the governance
    address[] private executors;
    mapping (address => bool) private executorMap;

    /**
     * Emitted when the governance address has been changed.
     * @param timestamp Timestamp of the block where the change happened, in seconds from UNIX epoch.
     * @param oldGovernanceAddress Governance address before the change.
     * @param newGovernanceAddress Governance address after the change.
     */
    event GovernanceAddressUpdated(
        uint256 timestamp,
        address oldGovernanceAddress,
        address newGovernanceAddress
    );

    /**
     * Emitted when the timelock has been changed.
     * @param timestamp Timestamp of the block where the change happened, in seconds from UNIX epoch.
     * @param oldTimelock Timelock before the change (in seconds).
     * @param newTimelock Timelock after the change (in seconds).
     */
    event GovernanceTimelockUpdated(
        uint256 timestamp,
        uint256 oldTimelock,
        uint256 newTimelock
    );

    /**
     * The list of addresses that are allowed to perform governance calls has been changed.
     * @param timestamp Timestamp of the block where the change happened, in seconds from UNIX epoch.
     * @param oldExecutors Array of executor addresses before the change.
     * @param newExecutors Array of executor addresses after the change.
     */
    event GovernanceExecutorsUpdated(
        uint256 timestamp,
        address[] oldExecutors,
        address[] newExecutors
    );

    /**
     * Perform initialization, which cannot be done in constructor, since this is a genesis contract.
     * Can only be called once.
     * @param _governanceAddress Initial governance address.
     * @param _timelock Initial timelock value, in seconds.
     * @param _executors Initial list of addresses allowed to perform governance calls.
     */
    function initialise(address _governanceAddress, uint256 _timelock, address[] memory _executors) external {
        require(msg.sender == GENESIS_GOVERNANCE, "only genesis governance");
        require(!initialised, "already initialised");
        require(_timelock < MAX_TIMELOCK, "timelock too large");
        // set the field values
        initialised = true;
        governanceAddress = _governanceAddress;
        timelock = uint64(_timelock);
        _setExecutors(_executors);
    }

    /**
     * Change the governance address.
     * Can only be called by validators via fork.
     * @param _newGovernance New governance address.
     */
    function setGovernanceAddress(address _newGovernance) external {
        require(governanceAddress != _newGovernance, "governanceAddress == _newGovernance");
        if (msg.sender == block.coinbase && block.coinbase == SIGNAL_COINBASE) {
            emit GovernanceAddressUpdated(block.timestamp, governanceAddress, _newGovernance);
            governanceAddress = _newGovernance;
        }
    }

    /**
     * Change the timelock, this is, the amount of time between a governance call and
     * its execution.
     * Can only be called by validators via fork.
     * @param _newTimelock New timelock value, in seconds.
     */
    function setTimelock(uint256 _newTimelock) external {
        require(timelock != _newTimelock, "timelock == _newTimelock");
        require(_newTimelock < MAX_TIMELOCK, "timelock too large");
        if (msg.sender == block.coinbase && block.coinbase == SIGNAL_COINBASE) {
            emit GovernanceTimelockUpdated(block.timestamp, timelock, _newTimelock);
            timelock = uint64(_newTimelock);
        }
    }

    /**
     * Set the addresses of the accounts that are allowed to execute the timelocked governance calls
     * once the timelock period expires.
     * It isn't very dangerous to allow for anyone to execute timelocked calls, but we reserve the right to
     * make sure the timing of the execution is under control.
     * Can only be called by the governance.
     * @param _newExecutors New list of allowed executors. The previous list is replaced.
     */
    function setExecutors(address[] memory _newExecutors) external {
        require(msg.sender == governanceAddress, "only governance");
        _setExecutors(_newExecutors);
    }

    /**
     * @inheritdoc IGovernanceSettings
     */
    function getGovernanceAddress() external view override returns (address) {
        return governanceAddress;
    }

    /**
     * @inheritdoc IGovernanceSettings
     */
    function getTimelock() external view override returns (uint256) {
        return timelock;
    }

    /**
     * @inheritdoc IGovernanceSettings
     */
    function getExecutors() external view override returns (address[] memory) {
        return executors;
    }

    /**
     * @inheritdoc IGovernanceSettings
     */
    function isExecutor(address _address) external view override returns (bool) {
        return executorMap[_address];
    }

    function _setExecutors(address[] memory _newExecutors) private {
        emit GovernanceExecutorsUpdated(block.timestamp, executors, _newExecutors);
        // clear old
        while (executors.length > 0) {
            executorMap[executors[executors.length - 1]] = false;
            executors.pop();
        }
        // set new
        for (uint256 i = 0; i < _newExecutors.length; i++) {
            executors.push(_newExecutors[i]);
            executorMap[_newExecutors[i]] = true;
        }
    }
}
