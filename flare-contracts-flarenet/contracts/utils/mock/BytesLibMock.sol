// SPDX-License-Identifier: Unlicense

pragma solidity 0.7.6;

import "../../utils/implementation/BytesLib.sol";

contract BytesLibMock {
    function toBytes32(bytes memory _bytes, uint256 _start) external pure returns (bytes32) {
        return BytesLib.toBytes32(_bytes, _start);
    }
}