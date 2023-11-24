// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

contract WhitelistedGetterMock {
    address[] public whitelisted;

    constructor(address[] memory addresses) {
        whitelisted = addresses;
    }
    
    function getFtsoWhitelistedPriceProviders(uint256 /* _ftsoIndex */) external view returns (address[] memory) {
        return whitelisted;
    }
}