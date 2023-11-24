// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../implementation/VPToken.sol";
import "../implementation/VPContract.sol";
import "../interface/IIVPContract.sol";

/**
 * @title Vote Power Token mock contract
 * @notice A contract to stub minting and burning for testing purposes.
 **/
contract VPTokenMock is VPToken {

    constructor(
        address _governance,
        string memory _name, 
        string memory _symbol
    )
        VPToken(_governance, _name, _symbol)
    {
    }

    function mint(address _to, uint256 _amount) public virtual {
        _mint(_to, _amount);
    }

    function burn(uint256 _amount) public virtual {
        _burn(msg.sender, _amount);
    }

    function setDecimals(uint8 _decimals) public {
        _setupDecimals(_decimals);
    }
    
    // some forbidden functions
    
    function revokeDelegationAtNow(address _to) public {
        revokeDelegationAt(_to, block.number);
    }

    function votePowerOfAtNowCached(address _who) public returns (uint256) {
        return votePowerOfAtCached(_who, block.number);
    }
    
    function votePowerAtNowCached() public returns (uint256) {
        return totalVotePowerAtCached(block.number);
    }
    
    function getReadVpContract() public view returns (IIVPContract) {
        return _getReadVpContract();
    }

    function getWriteVpContract() public view returns (IIVPContract) {
        return _getWriteVpContract();
    }
}
