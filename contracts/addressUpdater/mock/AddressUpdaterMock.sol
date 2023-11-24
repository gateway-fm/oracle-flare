// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "../../governance/implementation/Governed.sol";
import "../interface/IIAddressUpdatable.sol";

contract AddressUpdaterMock is Governed {
    address private wnat;

    constructor(address _governance, address _wnat) Governed(_governance) {
        wnat = _wnat;
    }

    function getContractAddress(string memory /* _name */) external view returns(address) {
        return wnat;
    }

    function updateContractAddresses(
        address _updatable,
        bytes32[] memory _contractNameHashes,
        address[] memory _contractAddresses
    )
        external
    {
        IIAddressUpdatable(_updatable).updateContractAddresses(_contractNameHashes, _contractAddresses);
    } 
}
