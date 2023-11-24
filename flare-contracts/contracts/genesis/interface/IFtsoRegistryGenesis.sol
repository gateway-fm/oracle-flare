
// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "./IFtsoGenesis.sol";


/**
 * Portion of the `IFtsoRegistry` interface that is available to contracts deployed at genesis.
 */
interface IFtsoRegistryGenesis {

    /**
     * Get the addresses of the active FTSOs at the given indices.
     * Reverts if any of the provided indices is non-existing or inactive.
     * @param _indices Array of FTSO indices to query.
     * @return _ftsos The array of FTSO addresses.
     */
    function getFtsos(uint256[] memory _indices) external view returns(IFtsoGenesis[] memory _ftsos);
}
