
// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;


/**
 * Portion of the Inflation contract that is available to contracts deployed at genesis.
 */
interface IInflationGenesis {
    /**
     * Receive newly minted native tokens from the FlareDaemon.
     *
     * Assume that the received amount will be >= last topup requested across all services.
     * If there is not enough balance sent to cover the topup request, expect the library method to revert.
     * Also assume that any received balance greater than the calculated topup request
     * came from self-destructor sending a balance to this contract.
     */
    function receiveMinting() external payable;
}
