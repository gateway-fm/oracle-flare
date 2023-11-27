// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../implementation/CloneFactory.sol";

contract CloneFactoryMock is CloneFactory {

    function isClonePublic(address target, address query) public view returns(bool) {
        return isClone(target, query);
    }
}