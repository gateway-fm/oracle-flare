// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../governance/implementation/GovernedAtGenesis.sol";
import "../../addressUpdater/implementation/AddressUpdatable.sol";
import "../interface/IIPriceSubmitter.sol";


/**
 * Receives prices from [FTSO data providers](https://docs.flare.network/tech/ftso).
 *
 * It then forwards the submissions to the appropriate FTSO contract,
 * allowing data providers to perform all required operations in a single transaction
 * per price epoch.
 */
contract PriceSubmitter is IIPriceSubmitter, GovernedAtGenesis, AddressUpdatable {

    string internal constant ERR_ALREADY_SET = "Already set";
    string internal constant ERR_ARRAY_LENGTHS = "Array lengths do not match";
    string internal constant ERR_NOT_WHITELISTED = "Not whitelisted";
    string internal constant ERR_FTSO_MANAGER_ONLY = "FTSO manager only";
    string internal constant ERR_WHITELISTER_ONLY = "Voter whitelister only";
    string internal constant ERR_WRONG_EPOCH_ID = "Wrong epoch id";
    string internal constant ERR_DUPLICATE_SUBMIT_IN_EPOCH = "Duplicate submit in epoch";
    string internal constant ERR_PRICE_INVALID = "Price already revealed or not valid";
    string internal constant ERR_RANDOM_TOO_SMALL = "Too small random number";
    string internal constant ERR_FTSO_INDICES_NOT_INCREASING = "FTSO indices not increasing";

    /// Minimal random value accepted along price submissions.
    /// Submitted random values below this threshold will revert.
    uint256 public constant MINIMAL_RANDOM = 2**128;
    /// Number of past random numbers remembered.
    uint256 public constant RANDOM_EPOCH_CYCLIC_BUFFER_SIZE = 50;

    IFtsoRegistryGenesis internal ftsoRegistry;
    IFtsoManagerGenesis internal ftsoManager;
    address internal voterWhitelister;

    // Bit at index `i` corresponds to being whitelisted for vote on ftso at index `i`
    mapping(address => uint256) internal whitelistedFtsoBitmap;

    address[] internal trustedAddresses;
    // for checking addresses at submit/reveal
    mapping(address => bool) internal trustedAddressesMapping;

    mapping(uint256 => mapping(address => bytes32)) internal epochVoterHash;
    uint256[RANDOM_EPOCH_CYCLIC_BUFFER_SIZE] internal randoms;

    /// Only the `ftsoManager` can call this method.
    modifier onlyFtsoManager {
        require(msg.sender == address(ftsoManager), ERR_FTSO_MANAGER_ONLY);
        _;
    }

    /// Only the `voterWhitelister` can call this method.
    modifier onlyWhitelister {
        require(msg.sender == voterWhitelister, ERR_WHITELISTER_ONLY);
        _;
    }

    /**
     * @dev This constructor should contain no code as this contract is pre-loaded into the genesis block.
     *   The super constructors are called for testing convenience.
     */
    constructor() GovernedAtGenesis(address(0)) AddressUpdatable(address(0)) {
        /* empty block */
    }


    /**
     * Sets the address updater contract.
     * Only governance cal call this method.
     * @param _addressUpdater Address of the `AddressUpdater` contract.
     */
    function setAddressUpdater(address _addressUpdater) external onlyGovernance {
        require(getAddressUpdater() == address(0), ERR_ALREADY_SET);
        setAddressUpdaterValue(_addressUpdater);
    }

    /**
     * Set the trusted addresses that are always allowed to submit and reveal.
     * Trusted addresses are used, for example, in fallback mode.
     * Only FTSO Manager can call this method.
     * @param _trustedAddresses Array of FTSO data provider addresses (voters).
     * The previous list of trusted addresses is discarded.
     */
    function setTrustedAddresses(address[] memory _trustedAddresses) external override onlyFtsoManager {
        // remove old addresses mapping
        uint256 len = trustedAddresses.length;
        for (uint256 i = 0; i < len; i++) {
            trustedAddressesMapping[trustedAddresses[i]] = false;
        }
        // set new addresses mapping
        len = _trustedAddresses.length;
        for (uint256 i = 0; i < len; i++) {
            trustedAddressesMapping[_trustedAddresses[i]] = true;
        }
        trustedAddresses = _trustedAddresses;
    }

    /**
     * @inheritdoc IIPriceSubmitter
     * @dev Only the `VoterWhitelister` contract can call this method.
     */
    function voterWhitelisted(address _voter, uint256 _ftsoIndex) external override onlyWhitelister {
        whitelistedFtsoBitmap[_voter] |= 1 << _ftsoIndex;
    }

    /**
     * @inheritdoc IIPriceSubmitter
     * @dev Only the `VoterWhitelister` contract can call this method.
     */
    function votersRemovedFromWhitelist(address[] memory _removedVoters, uint256 _ftsoIndex)
        external override
        onlyWhitelister
    {
        for (uint256 i = 0; i < _removedVoters.length; i++) {
            whitelistedFtsoBitmap[_removedVoters[i]]  &= ~(1 << _ftsoIndex);
        }
    }

    /**
     * @inheritdoc IPriceSubmitter
     */
    function submitHash(
        uint256 _epochId,
        bytes32 _hash
    )
        external override
    {
        require(_epochId == ftsoManager.getCurrentPriceEpochId(), ERR_WRONG_EPOCH_ID);
        require(epochVoterHash[_epochId][msg.sender] == 0, ERR_DUPLICATE_SUBMIT_IN_EPOCH);
        require(whitelistedFtsoBitmap[msg.sender] != 0 || trustedAddressesMapping[msg.sender], ERR_NOT_WHITELISTED);

        epochVoterHash[_epochId][msg.sender] = _hash;
        emit HashSubmitted(msg.sender, _epochId, _hash, block.timestamp);
    }

    /**
     * @inheritdoc IPriceSubmitter
     */
    function revealPrices(
        uint256 _epochId,
        uint256[] memory _ftsoIndices,
        uint256[] memory _prices,
        uint256 _random
    )
        external override
    {
        uint256 length  = _ftsoIndices.length;
        require(length == _prices.length, ERR_ARRAY_LENGTHS);
        require(_random >= MINIMAL_RANDOM, ERR_RANDOM_TOO_SMALL);
        require(epochVoterHash[_epochId][msg.sender] ==
            keccak256(abi.encode(_ftsoIndices, _prices, _random, msg.sender)),
            ERR_PRICE_INVALID);

        IFtsoGenesis[] memory ftsos = ftsoRegistry.getFtsos(_ftsoIndices);
        uint256 allowedBitmask = whitelistedFtsoBitmap[msg.sender];
        bool isTrustedAddress = false;

        // read native VP only once
        uint256 wNatVP = length > 0 ? ftsos[0].wNatVotePowerCached(msg.sender, _epochId) : 0;
        uint256 currentIndex;

        for (uint256 i = 0; i < length; i++) {
            if (i != 0 && currentIndex >= _ftsoIndices[i]) {
                revert(ERR_FTSO_INDICES_NOT_INCREASING);
            }
            currentIndex = _ftsoIndices[i];
            if (allowedBitmask & (1 << currentIndex) == 0) {
                if (!isTrustedAddress) {
                    if (trustedAddressesMapping[msg.sender]) {
                        isTrustedAddress = true;
                    } else {
                        revert(ERR_NOT_WHITELISTED);
                    }
                }
            }

            // call reveal price on ftso
            ftsos[i].revealPriceSubmitter(msg.sender, _epochId, _prices[i], wNatVP);
        }
        // prevent price submission from being revealed twice
        delete epochVoterHash[_epochId][msg.sender];

        // random can overflow but still ok
        //slither-disable-next-line weak-prng // not used for random
        randoms[_epochId % RANDOM_EPOCH_CYCLIC_BUFFER_SIZE] += uint256(keccak256(abi.encode(_random, _prices)));

        emit PricesRevealed(msg.sender, _epochId, ftsos, _prices, _random, block.timestamp);
    }

    /**
     * @inheritdoc IPriceSubmitter
     * @dev It never reverts.
     */
    function getCurrentRandom() external view override returns (uint256) {
        uint256 currentEpochId = ftsoManager.getCurrentPriceEpochId();
        if (currentEpochId == 0) {
            return 0;
        }
        //slither-disable-next-line weak-prng // not used for random
        return randoms[(currentEpochId - 1) % RANDOM_EPOCH_CYCLIC_BUFFER_SIZE];
    }

    /**
     * @inheritdoc IPriceSubmitter
     */
    function getRandom(uint256 _epochId) external view override returns (uint256) {
        //slither-disable-next-line weak-prng // not used for random
        return randoms[_epochId % RANDOM_EPOCH_CYCLIC_BUFFER_SIZE];
    }

    /**
     * @inheritdoc IPriceSubmitter
     */
    function voterWhitelistBitmap(address _voter) external view override returns (uint256) {
        return whitelistedFtsoBitmap[_voter];
    }

    /**
     * @inheritdoc IIPriceSubmitter
     */
    function getTrustedAddresses() external view override returns (address[] memory) {
        return trustedAddresses;
    }

    /**
     * @inheritdoc IPriceSubmitter
     */
    function getVoterWhitelister() external view override returns (address) {
        return voterWhitelister;
    }

    /**
     * @inheritdoc IPriceSubmitter
     */
    function getFtsoRegistry() external view override returns (IFtsoRegistryGenesis) {
        return ftsoRegistry;
    }

    /**
     * @inheritdoc IPriceSubmitter
     */
    function getFtsoManager() external view override returns (IFtsoManagerGenesis) {
        return ftsoManager;
    }

    /**
     * @notice Implementation of the AddressUpdatable abstract method.
     * @dev If replacing the registry or the whitelist and the old one is not empty, make sure to replicate the state,
     * otherwise internal whitelist bitmaps won't match.
     */
    function _updateContractAddresses(
        bytes32[] memory _contractNameHashes,
        address[] memory _contractAddresses
    )
        internal override
    {
        ftsoRegistry = IFtsoRegistryGenesis(
            _getContractAddress(_contractNameHashes, _contractAddresses, "FtsoRegistry"));
        ftsoManager = IFtsoManagerGenesis(_getContractAddress(_contractNameHashes, _contractAddresses, "FtsoManager"));
        voterWhitelister = _getContractAddress(_contractNameHashes, _contractAddresses, "VoterWhitelister");
    }
}
