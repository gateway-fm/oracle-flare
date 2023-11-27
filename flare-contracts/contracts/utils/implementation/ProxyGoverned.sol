// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "../../governance/implementation/Governed.sol";

/**
 * @title A governed proxy contract
 */
abstract contract ProxyGoverned is Governed {

    // Storage position of the address of the current implementation
    bytes32 private constant IMPLEMENTATION_POSITION = 
        keccak256("flare.diamond.ProxyGoverned.IMPLEMENTATION_POSITION");

    string internal constant ERR_IMPLEMENTATION_ZERO = "implementation zero";

    event ImplementationSet(address newImplementation);

    constructor(
        address _governance,
        address _initialImplementation
    ) 
        Governed(_governance)
    {
        _setImplementation(_initialImplementation);
    }
    
    /**
     * @dev Fallback function that delegates calls to the address returned by `implementation()`. Will run if call data
     * is empty.
     */
    receive() external payable {
        _delegate();
    }

    /**
     * @dev Fallback function that delegates calls to the address returned by `implementation()`. Will run if no other
     * function in the contract matches the call data.
     */
    fallback() external payable {
        _delegate();
    }

    /**
     * @dev Sets the address of the current implementation
     * @param _newImplementation address representing the new implementation to be set
     */
    function setImplementation(address _newImplementation) external onlyGovernance {
        _setImplementation(_newImplementation);
    }

    /**
     * @dev Tells the address of the current implementation
     */
    function implementation() public view returns (address _impl) {
        bytes32 position = IMPLEMENTATION_POSITION;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            _impl := sload(position)
        }
    }

    // solhint-disable no-complex-fallback
    function _delegate() internal {
        address impl = implementation();
            
        // solhint-disable-next-line no-inline-assembly
        assembly {
            calldatacopy(0, 0, calldatasize())
            let result := delegatecall(gas(), impl, 0, calldatasize(), 0, 0)
            let size := returndatasize()
            returndatacopy(0, 0, size)

            switch result
            case 0 { revert(0, size) }
            default { return(0, size) }
        }
    }

    /**
     * @dev Sets the address of the current implementation
     * @param _newImplementation address representing the new implementation to be set
     */
    function _setImplementation(address _newImplementation) internal {
        require(_newImplementation != address(0), ERR_IMPLEMENTATION_ZERO);
        bytes32 position = IMPLEMENTATION_POSITION;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            sstore(position, _newImplementation)
        }
        emit ImplementationSet(_newImplementation);
    }
}
