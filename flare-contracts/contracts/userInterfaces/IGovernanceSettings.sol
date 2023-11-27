// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;


/**
 * Interface for the `GovernanceSettings` that hold the Flare governance address and its timelock.
 *
 * All governance calls are delayed by the timelock specified in this contract.
 *
 * **NOTE**: This contract enables updating the governance address and timelock only
 * by hard-forking the network, meaning only by updating validator code.
 */
interface IGovernanceSettings {
    /**
     * Gets the governance account address.
     * The governance address can only be changed by a hard fork.
     * @return _address The governance account address.
     */
    function getGovernanceAddress() external view returns (address _address);

    /**
     * Gets the time in seconds that must pass between a governance call and its execution.
     * The timelock value can only be changed by a hard fork.
     * @return _timelock Time in seconds that passes between the governance call and execution.
     */
    function getTimelock() external view returns (uint256 _timelock);

    /**
     * Gets the addresses of the accounts that are allowed to execute the timelocked governance calls,
     * once the timelock period expires.
     * Executors can be changed without a hard fork, via a normal governance call.
     * @return _addresses Array of executor addresses.
     */
    function getExecutors() external view returns (address[] memory _addresses);

    /**
     * Checks whether an address is one of the allowed executors. See `getExecutors`.
     * @param _address The address to check.
     * @return True if `_address` is in the executors list.
     */
    function isExecutor(address _address) external view returns (bool);
}
