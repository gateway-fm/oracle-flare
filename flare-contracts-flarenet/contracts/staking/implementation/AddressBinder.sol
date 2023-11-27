// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../utils/implementation/BytesLib.sol";
import "../../userInterfaces/IAddressBinder.sol";

/**
 * Contract used to register P-chain and C-chain address pairs.
 */
contract AddressBinder is IAddressBinder {

    /**
     * @inheritdoc IAddressBinder
     */
    mapping(bytes20 => address) public override pAddressToCAddress;
    /**
     * @inheritdoc IAddressBinder
     */
    mapping(address => bytes20) public override cAddressToPAddress;

    uint256 constant private P = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F;

    /**
     * @inheritdoc IAddressBinder
     */
    // register validator/delegator (self-bonding/delegating) P-chain and C-chain addresses
    function registerAddresses(bytes calldata _publicKey, bytes20 _pAddress, address _cAddress) external override {
        require(_pAddress == _publicKeyToPAddress(_publicKey), "p chain address doesn't match public key");
        require(_cAddress == _publicKeyToCAddress(_publicKey), "c chain address doesn't match public key");
        pAddressToCAddress[_pAddress] = _cAddress;
        cAddressToPAddress[_cAddress] = _pAddress;
        emit AddressesRegistered(_publicKey, _pAddress, _cAddress);
    }

    /**
     * @inheritdoc IAddressBinder
     */
    function registerPublicKey(
        bytes calldata _publicKey
    )
        external override
        returns(bytes20 _pAddress, address _cAddress)
    {
        _pAddress = _publicKeyToPAddress(_publicKey);
        _cAddress = _publicKeyToCAddress(_publicKey);
        pAddressToCAddress[_pAddress] = _cAddress;
        cAddressToPAddress[_cAddress] = _pAddress;
        emit AddressesRegistered(_publicKey, _pAddress, _cAddress);
    }


    function _publicKeyToCAddress(
        bytes calldata publicKey
    )
        internal pure
        returns (address)
    {
        (uint256 x, uint256 y) = _extractPublicKeyPair(publicKey);
        uint256[2] memory publicKeyPair = [x, y];
        bytes32 hash = keccak256(abi.encodePacked(publicKeyPair));
        return address(uint160(uint256(hash)));
    }

    function _publicKeyToPAddress(
        bytes calldata publicKey
    )
        internal pure
        returns (bytes20)
    {
        (uint256 x, uint256 y) = _extractPublicKeyPair(publicKey);
        bytes memory compressedPublicKey = _compressPublicKey(x, y);
        bytes32 sha = sha256(abi.encodePacked(compressedPublicKey));
        return ripemd160(abi.encodePacked(sha));
    }


    ///// helper methods
    function _extractPublicKeyPair(
        bytes calldata encodedPublicKey
    )
        internal pure
        returns (uint256, uint256)
    {
        bytes1 prefix = encodedPublicKey[0];
        if (encodedPublicKey.length == 64) {
            // ethereum specific public key encoding
            return (
                uint256(BytesLib.toBytes32(encodedPublicKey, 0)),
                uint256(BytesLib.toBytes32(encodedPublicKey, 32)));
        } else if (encodedPublicKey.length == 65 && prefix == bytes1(0x04)) {
                return (
                    uint256(BytesLib.toBytes32(encodedPublicKey, 1)),
                    uint256(BytesLib.toBytes32(encodedPublicKey, 33))
                );
        } else if (encodedPublicKey.length == 33) {
                uint256 x = uint256(BytesLib.toBytes32(encodedPublicKey, 1));
                // Tonelli–Shanks algorithm for calculating square root modulo prime of x^3 + 7
                uint256 y = _powmod(mulmod(x, mulmod(x, x, P), P) + 7, (P + 1) / 4, P);
                if (prefix == bytes1(0x02)) {
                    return (x, (y % 2 == 0) ? y : P - y);
                } else if (prefix == bytes1(0x03)) {
                    return (x, (y % 2 == 0) ? P - y : y);
                }
        }
        revert("wrong format of public key");
    }

    function _compressPublicKey(uint256 x, uint256 y) internal pure returns (bytes memory) {
        return BytesLib.concat(_compressedPublicKeyBytePrefix(y % 2 == 0), abi.encodePacked(bytes32(x)));
    }

    function _compressedPublicKeyBytePrefix(bool evenY) internal pure returns (bytes memory) {
        return abi.encodePacked(evenY ? bytes1(0x02) : bytes1(0x03));
    }

    function _powmod(uint256 x, uint256 n, uint256 p) private pure returns (uint256) {
        uint256 result = 1;
        while (n > 0) {
            if (n & 1 == 1) {
                result = mulmod(result, x, p);
            }
            x = mulmod(x, x, p);
            n >>= 1;
        }
        return result;
    }

}