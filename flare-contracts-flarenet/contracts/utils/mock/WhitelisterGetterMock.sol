// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../implementation/VoterWhitelister.sol";

contract WhitelisterGetterMock {
    address public voterWhitelister;

    constructor(address _voterWhitelister) {
        voterWhitelister = _voterWhitelister;
    }

    function getVoterWhitelister() public view returns(address) {
        return voterWhitelister;
    }
    
}
