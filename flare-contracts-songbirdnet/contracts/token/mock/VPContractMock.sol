// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../implementation/VPContract.sol";

/**
 * @title Vote Power Contract testable contract
 * @notice A contract to expose internal methods for testing purposes.
 **/
contract VPContractMock is VPContract {

    constructor(IVPToken _ownerToken, bool _isReplacement) 
        VPContract(_ownerToken, _isReplacement)
    {
    }
    
    function initializeVotePower(address _owner, uint256 _balance) external {
        _initializeVotePower(_owner, _balance);
    }
    
    function votePowerInitialized(address _owner) external view returns (bool) {
        return _votePowerInitialized(_owner);
    }
    
    function votePowerInitializedAt(address _owner, uint256 _blockNumber) external view returns (bool) {
        return _votePowerInitializedAt(_owner, _blockNumber);
    }
}
