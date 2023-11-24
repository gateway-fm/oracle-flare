// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../interface/IICombinedNatBalance.sol";
import "../../token/implementation/WNat.sol";
import "../../staking/implementation/PChainStakeMirror.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";


/**
 * Contract used for combining the balances from WNat and PChainStakeMirror contracts.
 */
contract CombinedNat is IICombinedNatBalance {
    using SafeMath for uint256;

    /// WNat contract address
    WNat public immutable wNat;
    /// PChainStakeMirror contract address
    PChainStakeMirror public immutable pChainStakeMirror;

    /**
     * Initializes the contract with default parameters
     * @param _wNat WNat contract address.
     * @param _pChainStakeMirror PChainStakeMirror contract address.
     */
    constructor(WNat _wNat, PChainStakeMirror _pChainStakeMirror) {
        require(_wNat != WNat(0), "_wNat zero");
        require(_pChainStakeMirror != PChainStakeMirror(0), "_pChainStakeMirror zero");
        wNat = _wNat;
        pChainStakeMirror = _pChainStakeMirror;
    }

    /**
     * @inheritdoc IICombinedNatBalance
     */
    function totalSupply() external view override returns (uint256) {
        return wNat.totalSupply().add(pChainStakeMirror.totalSupply());
    }

    /**
     * @inheritdoc IICombinedNatBalance
     */
    function totalSupplyAt(uint _blockNumber) external view override returns(uint256) {
        return wNat.totalSupplyAt(_blockNumber).add(pChainStakeMirror.totalSupplyAt(_blockNumber));
    }

    /**
     * @inheritdoc IICombinedNatBalance
     */
    function balanceOf(address _owner) external view override returns (uint256) {
        return wNat.balanceOf(_owner).add(pChainStakeMirror.balanceOf(_owner));
    }

    /**
     * @inheritdoc IICombinedNatBalance
     */
    function balanceOfAt(address _owner, uint _blockNumber) external view override returns (uint256) {
        return wNat.balanceOfAt(_owner, _blockNumber).add(pChainStakeMirror.balanceOfAt(_owner, _blockNumber));
    }
}
