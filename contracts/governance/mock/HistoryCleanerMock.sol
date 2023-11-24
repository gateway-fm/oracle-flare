// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

contract HistoryCleanerMock {
    /**
     * Perform several cleanup methods in a batch.
     * @param _targets addresses of contracts on which the corresponding method calls will be executed
     * @param _methodCalls ABI encoded clenup method calls
     * @return _deletedCounts for each method call, an uint256 indicating the number of checkpoints or
     *    cache entries deleted; the idea is to first call this method on your node to find out which
     *    data has been cleaned already instead of wasting gas
     */
    function cleanup(
        address[] memory _targets,
        bytes[] memory _methodCalls
    ) 
        external 
        returns (uint256[] memory _deletedCounts) 
    {
        require(_targets.length == _methodCalls.length, "Mismatched length of call targets and methods");
        _deletedCounts = new uint256[](_targets.length);
        for (uint256 i = 0; i < _targets.length; i++) {
            // solhint-disable-next-line avoid-low-level-calls
            (bool success, bytes memory result) = _targets[i].call(_methodCalls[i]);
            require(success, appendUintToString("Cleanup method call failed at ", i));
            _deletedCounts[i] = abi.decode(result, (uint256));
        }
    }

    function appendUintToString(string memory prefix, uint256 value) private pure returns (string memory) {
        bytes memory reversed = new bytes(80);  // longest uint256 decimal string is ~77 < 80
        uint256 len = 0;
        if (value == 0) {
            reversed[len++] = "0";
        }
        while (value != 0) {
            uint256 remainder = value % 10;
            value = value / 10;
            reversed[len++] = bytes1(uint8(48 + remainder));
        }
        bytes memory prefixBytes = bytes(prefix);
        bytes memory result = new bytes(prefixBytes.length + len);
        for (uint256 i = 0; i < prefixBytes.length; i++) {
            result[i] = prefixBytes[i];
        }
        for (uint256 i = 0; i < len; i++) {
            result[i + prefixBytes.length] = reversed[len - 1 - i];
        }
        return string(result);
    }    
}
