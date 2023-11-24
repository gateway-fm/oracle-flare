// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;


import "../../userInterfaces/IDelegationAccount.sol";
import "../interface/IIClaimSetupManager.sol";

interface IIDelegationAccount is IDelegationAccount {

    /**
     * Initialization of a new deployed contract
     * @param _owner                        contract owner address
     * @param _manager                      contract manager address
     */
    function initialize(address _owner, IIClaimSetupManager _manager) external;

    function delegate(WNat _wNat, address _to, uint256 _bips) external;

    function batchDelegate(WNat _wNat, address[] memory _delegatees, uint256[] memory _bips) external;

    function undelegateAll(WNat _wNat) external;

    function revokeDelegationAt(WNat _wNat, address _who, uint256 _blockNumber) external;

    function delegateGovernance(IGovernanceVotePower _governanceVP, address _to) external;

    function undelegateGovernance(IGovernanceVotePower _governanceVP) external;

    function withdraw(WNat _wNat, uint256 _amount) external;
    
    function transferExternalToken(WNat _wNat, IERC20 _token, uint256 _amount) external;
}
