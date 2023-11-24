// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "../lib/VotePower.sol";


/**
 * @title Vote power library
 * @notice A library to record delegate vote power balances by delegator 
 *  and delegatee.
 **/
library VotePowerCache {
    using SafeMath for uint256;
    using VotePower for VotePower.VotePowerState;

    struct RevocationCacheRecord {
        // revoking delegation only affects cached value therefore we have to track
        // the revocation in order not to revoke twice
        // mapping delegatee => revokedValue
        mapping(address => uint256) revocations;
    }
    
    /**
     * @dev `CacheState` is state structure used by this library to manage vote
     *  power amounts by delegator and it's delegates.
     */
    struct CacheState {
        // map keccak256([address, _blockNumber]) -> (value + 1)
        mapping(bytes32 => uint256) valueCache;
        
        // map keccak256([address, _blockNumber]) -> RevocationCacheRecord
        mapping(bytes32 => RevocationCacheRecord) revocationCache;
    }

    /**
    * @notice Get the cached value at given block. If there is no cached value, original
    *    value is returned and stored to cache. Cache never gets stale, because original
    *    value can never change in a past block.
    * @param _self A VotePowerCache instance to manage.
    * @param _votePower A VotePower instance to read from if cache is empty.
    * @param _who Address to get vote power.
    * @param _blockNumber Block number of the block to fetch vote power.
    * precondition: _blockNumber < block.number
    */
    function valueOfAt(
        CacheState storage _self,
        VotePower.VotePowerState storage _votePower,
        address _who,
        uint256 _blockNumber
    )
        internal 
        returns (uint256 _value, bool _createdCache)
    {
        bytes32 key = keccak256(abi.encode(_who, _blockNumber));
        // is it in cache?
        uint256 cachedValue = _self.valueCache[key];
        if (cachedValue != 0) {
            return (cachedValue - 1, false);    // safe, cachedValue != 0
        }
        // read from _votePower
        uint256 votePowerValue = _votePower.votePowerOfAt(_who, _blockNumber);
        _writeCacheValue(_self, key, votePowerValue);
        return (votePowerValue, true);
    }

    /**
    * @notice Get the cached value at given block. If there is no cached value, original
    *    value is returned. Cache is never modified.
    * @param _self A VotePowerCache instance to manage.
    * @param _votePower A VotePower instance to read from if cache is empty.
    * @param _who Address to get vote power.
    * @param _blockNumber Block number of the block to fetch vote power.
    * precondition: _blockNumber < block.number
    */
    function valueOfAtReadonly(
        CacheState storage _self,
        VotePower.VotePowerState storage _votePower,
        address _who,
        uint256 _blockNumber
    )
        internal view 
        returns (uint256 _value)
    {
        bytes32 key = keccak256(abi.encode(_who, _blockNumber));
        // is it in cache?
        uint256 cachedValue = _self.valueCache[key];
        if (cachedValue != 0) {
            return cachedValue - 1;     // safe, cachedValue != 0
        }
        // read from _votePower
        return _votePower.votePowerOfAt(_who, _blockNumber);
    }
    
    /**
    * @notice Delete cached value for `_who` at given block.
    *   Only used for history cleanup.
    * @param _self A VotePowerCache instance to manage.
    * @param _who Address to get vote power.
    * @param _blockNumber Block number of the block to fetch vote power.
    * @return _deleted The number of cache items deleted (always 0 or 1).
    * precondition: _blockNumber < cleanupBlockNumber
    */
    function deleteValueAt(
        CacheState storage _self,
        address _who,
        uint256 _blockNumber
    )
        internal
        returns (uint256 _deleted)
    {
        bytes32 key = keccak256(abi.encode(_who, _blockNumber));
        if (_self.valueCache[key] != 0) {
            delete _self.valueCache[key];
            return 1;
        }
        return 0;
    }
    
    /**
    * @notice Revoke vote power delegation from `from` to `to` at given block.
    *   Updates cached values for the block, so they are the only vote power values respecting revocation.
    * @dev Only delegatees cached value is changed, delegator doesn't get the vote power back; so
    *   the revoked vote power is forfeit for as long as this vote power block is in use. This is needed to
    *   prevent double voting.
    * @param _self A VotePowerCache instance to manage.
    * @param _votePower A VotePower instance to read from if cache is empty.
    * @param _from The delegator.
    * @param _to The delegatee.
    * @param _revokedValue Value of delegation is not stored here, so it must be supplied by caller.
    * @param _blockNumber Block number of the block to modify.
    * precondition: _blockNumber < block.number
    */
    function revokeAt(
        CacheState storage _self,
        VotePower.VotePowerState storage _votePower,
        address _from,
        address _to,
        uint256 _revokedValue,
        uint256 _blockNumber
    )
        internal
    {
        if (_revokedValue == 0) return;
        bytes32 keyFrom = keccak256(abi.encode(_from, _blockNumber));
        if (_self.revocationCache[keyFrom].revocations[_to] != 0) {
            revert("Already revoked");
        }
        // read values and prime cacheOf
        (uint256 valueTo,) = valueOfAt(_self, _votePower, _to, _blockNumber);
        // write new values
        bytes32 keyTo = keccak256(abi.encode(_to, _blockNumber));
        _writeCacheValue(_self, keyTo, valueTo.sub(_revokedValue, "Revoked value too large"));
        // mark as revoked
        _self.revocationCache[keyFrom].revocations[_to] = _revokedValue;
    }
    
    /**
    * @notice Delete revocation from `_from` to `_to` at block `_blockNumber`.
    *   Only used for history cleanup.
    * @param _self A VotePowerCache instance to manage.
    * @param _from The delegator.
    * @param _to The delegatee.
    * @param _blockNumber Block number of the block to modify.
    * precondition: _blockNumber < cleanupBlockNumber
    */
    function deleteRevocationAt(
        CacheState storage _self,
        address _from,
        address _to,
        uint256 _blockNumber
    )
        internal
        returns (uint256 _deleted)
    {
        bytes32 keyFrom = keccak256(abi.encode(_from, _blockNumber));
        RevocationCacheRecord storage revocationRec = _self.revocationCache[keyFrom];
        uint256 value = revocationRec.revocations[_to];
        if (value != 0) {
            delete revocationRec.revocations[_to];
            return 1;
        }
        return 0;
    }

    /**
    * @notice Returns true if `from` has revoked vote pover delgation of `to` in block `_blockNumber`.
    * @param _self A VotePowerCache instance to manage.
    * @param _from The delegator.
    * @param _to The delegatee.
    * @param _blockNumber Block number of the block to fetch result.
    * precondition: _blockNumber < block.number
    */
    function revokedFromToAt(
        CacheState storage _self,
        address _from,
        address _to,
        uint256 _blockNumber
    )
        internal view
        returns (bool revoked)
    {
        bytes32 keyFrom = keccak256(abi.encode(_from, _blockNumber));
        return _self.revocationCache[keyFrom].revocations[_to] != 0;
    }
    
    function _writeCacheValue(CacheState storage _self, bytes32 _key, uint256 _value) private {
        // store to cacheOf (add 1 to differentiate from empty)
        _self.valueCache[_key] = _value.add(1);
    }
}
