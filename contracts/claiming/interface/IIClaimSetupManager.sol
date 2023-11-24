// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;


import "../../userInterfaces/IClaimSetupManager.sol";
import "../../token/implementation/WNat.sol";

interface IIClaimSetupManager is IClaimSetupManager {
    event SetLibraryAddress(address libraryAddress);

    function setLibraryAddress(address _libraryAddress) external;

    function setMinFeeValueWei(uint256 _minFeeValueWei) external;

    function setMaxFeeValueWei(uint256 _maxFeeValueWei) external;

    function setRegisterExecutorFeeValueWei(uint256 _registerExecutorFeeValueWei) external;

    function wNat() external view returns(WNat);

    function getAutoClaimAddressesAndExecutorFee(address _executor, address[] memory _owners)
        external view returns (address[] memory _claimAddresses, uint256 _executorFeeValue);

    function checkExecutorAndAllowedRecipient(address _executor, address _owner, address _recipient)
        external view;
}
