// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "./GenericRewardManager.sol";


contract AttestationProviderRewardManager is GenericRewardManager {

    constructor(
        address _governance,
        address _addressUpdater,
        address _oldRewardManager
    )
        GenericRewardManager(
            _governance,
            _addressUpdater,
            _oldRewardManager
        )
    { }

    /**
     * @notice Implement this function for updating inflation receiver contracts through AddressUpdater.
     */
    function getContractName() external pure override returns (string memory) {
        return "AttestationProviderRewardManager";
    }
}
