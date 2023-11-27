// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;


/**
 * Interface for contracts that receive triggers from the `FlareDaemon` contract.
 */
interface IFlareDaemonize {

    /**
     * Implement this function to receive a trigger from the `FlareDaemon`.
     * The trigger method is called by the validator right at the end of block state transition.
     * @return bool Whether the contract is still active after the call.
     * Currently unused.
     */
    function daemonize() external returns (bool);

    /**
     * This function will be called after an error is caught in daemonize().
     * It will switch the contract to a simpler fallback mode, which hopefully works when full mode doesn't.
     * Not every contract needs to support fallback mode (FtsoManager does), so this method may be empty.
     * Switching back to normal mode is left to the contract (typically a governed method call).
     * This function may be called due to low-gas error, so it shouldn't use more than ~30.000 gas.
     * @return True if switched to fallback mode, false if already in fallback mode or
     * if fallback mode is not supported.
     */
    function switchToFallbackMode() external returns (bool);

    /**
     * Implement this function to allow updating daemonized contracts through the `AddressUpdater`.
     * @return string Contract name.
     */
    function getContractName() external view returns (string memory);
}
