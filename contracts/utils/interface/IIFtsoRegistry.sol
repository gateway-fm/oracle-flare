// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;
pragma abicoder v2;

import "../../ftso/interface/IIFtso.sol";
import "../../userInterfaces/IFtsoRegistry.sol";


/**
 * Internal interface for the `FtsoRegistry` contract.
 */
interface IIFtsoRegistry is IFtsoRegistry {

    /**
     * Add a new FTSO contract to the registry.
     * @param _ftsoContract New target FTSO contract.
     * @return The FTSO index assigned to the new asset.
     */
    function addFtso(IIFtso _ftsoContract) external returns(uint256);

    /**
     * Removes the FTSO and keeps part of the history.
     * Reverts if the provided address is not supported.
     *
     * From now on, the index this asset was using is "reserved" and cannot be used again.
     * It will not be returned in any list of currently supported assets.
     * @param _ftso Address of the FTSO contract to remove.
     */
    function removeFtso(IIFtso _ftso) external;
}
