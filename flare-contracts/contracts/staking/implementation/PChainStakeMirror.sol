// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "../../utils/implementation/GovernedAndFlareDaemonized.sol";
import "../../genesis/interface/IFlareDaemonize.sol";
import "../../token/interface/IICleanable.sol";
import "../../token/interface/IIGovernanceVotePower.sol";
import "../../addressUpdater/implementation/AddressUpdatable.sol";
import "../../userInterfaces/IPChainStakeMirror.sol";
import "../interface/IIPChainStakeMirrorVerifier.sol";
import "../../userInterfaces/IAddressBinder.sol";
import "./PChainStake.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/SafeCast.sol";
import "../../utils/implementation/SafePct.sol";


/**
 * Contract used to mirror all stake amounts from P-chain.
 */
contract PChainStakeMirror is IPChainStakeMirror, PChainStake, GovernedAndFlareDaemonized,
        IFlareDaemonize, IICleanable, AddressUpdatable {
    using SafeMath for uint256;
    using SafeCast for uint256;
    using SafePct for uint256;

    /**
     * Structure with data needed to end stakes
     */
    struct PChainStakingData {
        address owner;
        bytes20 nodeId;
        uint64 weightGwei;
    }

    uint256 constant internal GWEI = 1e9;

    /// Indicates if stakes can be mirrored.
    bool public active;
    /// Max number of stake ends that Flare daemon updates per block.
    uint256 public maxUpdatesPerBlock;
    /// Indicates timestamp of stake ends that Flare daemon will trigger next.
    uint256 public nextTimestampToTrigger;

    /// Mapping from stake end time to the list of tx hashes - `keccak256(abi.encode(txId, inputAddress))`
    mapping(uint256 => bytes32[]) public endTimeToTransactionHashList;
    /// Return staking data for given tx hash - `keccak256(abi.encode(txId, inputAddress))`
    mapping(bytes32 => PChainStakingData) public transactionHashToPChainStakingData;

    // addresses
    /// The contract to use for governance vote power and delegation.
    /// Here only to properly update governance VP at stake start/end,
    /// all actual operations go directly to governance VP contract.
    IIGovernanceVotePower public governanceVotePower;
    /// The contract used for P-chain stake verifications.
    IIPChainStakeMirrorVerifier public verifier;
    /// The contract used for converting P-chain address to C-chain address - both derived from the same public key.
    IAddressBinder public addressBinder;
    /// The contract that is allowed to set cleanupBlockNumber.
    /// Usually this will be an instance of CleanupBlockNumberManager.
    address public cleanupBlockNumberManager;

    /// This method can only be called when the PChainStakeMirror is active.
    modifier whenActive {
        require(active, "not active");
        _;
    }

    /**
     * Initializes the contract with default parameters
     * @param _governance Address identifying the governance address
     * @param _flareDaemon Address identifying the flare daemon contract
     * @param _addressUpdater Address identifying the address updater contract
     * @param _maxUpdatesPerBlock Max number of updates (stake ends) per block
     */
    constructor(
        address _governance,
        FlareDaemon _flareDaemon,
        address _addressUpdater,
        uint256 _maxUpdatesPerBlock
    )
        GovernedAndFlareDaemonized(_governance, _flareDaemon) AddressUpdatable(_addressUpdater)
    {
        maxUpdatesPerBlock = _maxUpdatesPerBlock;
        emit MaxUpdatesPerBlockSet(_maxUpdatesPerBlock);
    }

    /**
     * Activates PChainStakeMirror contract - enable mirroring.
     * @dev Only governance can call this.
     */
    function activate() external onlyImmediateGovernance {
        active = true;
        if (nextTimestampToTrigger == 0) {
            nextTimestampToTrigger = block.timestamp;
        }
    }

    /**
     * Deactivates PChainStakeMirror contract - disable mirroring.
     * @dev Only governance can call this.
     */
    function deactivate() external onlyImmediateGovernance {
        active = false;
    }

    /**
     * @inheritdoc IFlareDaemonize
     * @dev Only flare daemon can call this.
     * Reduce balances and vote powers for stakes that just ended.
     */
    function daemonize() external override onlyFlareDaemon returns (bool) {
        uint256 nextTimestampToTriggerTmp = nextTimestampToTrigger;
        // flare daemon trigger. once every block
        if (nextTimestampToTriggerTmp == 0) return false;

        uint256 maxUpdatesPerBlockTemp = maxUpdatesPerBlock;
        uint256 noOfUpdates = 0;
        while (nextTimestampToTriggerTmp <= block.timestamp) {
            for (uint256 i = endTimeToTransactionHashList[nextTimestampToTriggerTmp].length; i > 0; i--) {
                noOfUpdates++;
                if (noOfUpdates > maxUpdatesPerBlockTemp) {
                    break;
                } else {
                    bytes32 txHash = endTimeToTransactionHashList[nextTimestampToTriggerTmp][i - 1];
                    endTimeToTransactionHashList[nextTimestampToTriggerTmp].pop();
                    _decreaseStakeAmount(transactionHashToPChainStakingData[txHash], txHash);
                    delete transactionHashToPChainStakingData[txHash];
                }
            }
            if (noOfUpdates > maxUpdatesPerBlockTemp) {
                break;
            } else {
                nextTimestampToTriggerTmp++;
            }
        }

        nextTimestampToTrigger = nextTimestampToTriggerTmp;
        return true;
    }

    /**
     * @inheritdoc IPChainStakeMirror
     */
    function mirrorStake(
        IPChainStakeMirrorVerifier.PChainStake calldata _stakeData,
        bytes32[] calldata _merkleProof
    )
        external override whenActive
    {
        bytes32 txHash = _getTxHash(_stakeData.txId, _stakeData.inputAddress);
        require(transactionHashToPChainStakingData[txHash].owner == address(0), "transaction already mirrored");
        require(_stakeData.startTime <= block.timestamp, "staking not started yet");
        require(_stakeData.endTime > block.timestamp, "staking already ended");
        address cChainAddress = addressBinder.pAddressToCAddress(_stakeData.inputAddress);
        require(cChainAddress != address(0), "unknown staking address");
        require(verifier.verifyStake(_stakeData, _merkleProof), "staking data invalid");

        PChainStakingData memory pChainStakingData =
            PChainStakingData(cChainAddress, _stakeData.nodeId, _stakeData.weight);
        transactionHashToPChainStakingData[txHash] = pChainStakingData;
        endTimeToTransactionHashList[_stakeData.endTime].push(txHash);
        _increaseStakeAmount(pChainStakingData, txHash, _stakeData.txId);
    }

    /**
     * Sets max number of updates (stake ends) per block (a daemonize call).
     * @param _maxUpdatesPerBlock Max number of updates (stake ends) per block
     * @dev Only governance can call this.
     */
    function setMaxUpdatesPerBlock(uint256 _maxUpdatesPerBlock) external onlyGovernance {
        maxUpdatesPerBlock = _maxUpdatesPerBlock;
        emit MaxUpdatesPerBlockSet(_maxUpdatesPerBlock);
    }

    /**
     * Revokes stake in case of invalid stakes - voting should be reset first,
     * so that Merkle root is not valid and it cannot be used for mirroring again.
     * @param _txId P-chain stake transaction id.
     * @param _inputAddress P-chain address that opened stake.
     * @param _endTime Time when stake ends, in seconds from UNIX epoch.
     * @param _endTimeTxHashIndex Index of `txHash = keccak256(abi.encode(_txId, _inputAddress))`
     *                            in the `endTimeToTransactionHashList[_endTime]` list.
     * @dev Only governance can call this.
     */
    function revokeStake(
        bytes32 _txId,
        bytes20 _inputAddress,
        uint256 _endTime,
        uint256 _endTimeTxHashIndex)
        external
        onlyImmediateGovernance
    {
        bytes32 txHash = _getTxHash(_txId, _inputAddress);
        require(transactionHashToPChainStakingData[txHash].owner != address(0), "stake not mirrored");
        bytes32[] storage txHashList = endTimeToTransactionHashList[_endTime];
        uint256 length = txHashList.length;
        require(length > _endTimeTxHashIndex && txHashList[_endTimeTxHashIndex] == txHash, "wrong end time or index");
        if (length - 1 != _endTimeTxHashIndex) {  // length >= 1
            txHashList[_endTimeTxHashIndex] = txHashList[length - 1];
        }
        txHashList.pop();
        PChainStakingData memory stakingData = transactionHashToPChainStakingData[txHash];
        emit StakeRevoked(stakingData.owner, stakingData.nodeId, txHash, GWEI.mul(stakingData.weightGwei));
        _decreaseStakeAmount(stakingData, txHash);
        delete transactionHashToPChainStakingData[txHash];
    }

    /**
     * @inheritdoc IFlareDaemonize
     * @dev Only flare daemon can call this.
     */
    function switchToFallbackMode() external override onlyFlareDaemon returns (bool) {
        if (maxUpdatesPerBlock > 0) {
            maxUpdatesPerBlock = maxUpdatesPerBlock.mulDiv(4, 5);
            emit MaxUpdatesPerBlockSet(maxUpdatesPerBlock);
            return true;
        }
        return false;
    }

    /**
     * @inheritdoc IICleanable
     * @dev The method can be called only by `cleanupBlockNumberManager`.
     */
    function setCleanupBlockNumber(uint256 _blockNumber) external override {
        require(msg.sender == cleanupBlockNumberManager, "only cleanup block manager");
        _setCleanupBlockNumber(_blockNumber);
    }

    /**
     * @inheritdoc IICleanable
     * @dev Only governance can call this.
     */
    function setCleanerContract(address _cleanerContract) external override onlyGovernance {
        _setCleanerContract(_cleanerContract);
    }

    /**
     * @inheritdoc IICleanable
     */
    function cleanupBlockNumber() external view override returns (uint256) {
        return _cleanupBlockNumber();
    }

    /**
     * @inheritdoc IPChainStakeMirror
     */
    function isActiveStakeMirrored(
        bytes32 _txId,
        bytes20 _inputAddress
    )
        external view override returns(bool)
    {
        bytes32 txHash = _getTxHash(_txId, _inputAddress);
        return transactionHashToPChainStakingData[txHash].owner != address(0);
    }

    /**
     * Returns the list of transaction hashes of stakes that end at given `_endTime`.
     * @param _endTime Time when stakes end, in seconds from UNIX epoch.
     * @return List of transaction hashes - `keccak256(abi.encode(txId, inputAddress))`.
     */
    function getTransactionHashList(uint256 _endTime) external view returns (bytes32[] memory) {
        return endTimeToTransactionHashList[_endTime];
    }

    /**
     * @inheritdoc IFlareDaemonize
     */
    function getContractName() external pure override returns (string memory) {
        return "PChainStakeMirror";
    }

    /**
     * @inheritdoc IPChainStakeMirror
     */
    function totalSupply() public view override returns(uint256) {
        return CheckPointable.totalSupplyAt(block.number);
    }

    /**
     * @inheritdoc IPChainStakeMirror
     */
    function balanceOf(address _owner) public view override returns (uint256) {
        return CheckPointable.balanceOfAt(_owner, block.number);
    }

    /**
     * @inheritdoc IPChainStakeMirror
     */
    function totalSupplyAt(
        uint256 _blockNumber
    )
        public view
        override(IPChainStakeMirror, CheckPointable)
        returns(uint256)
    {
        return CheckPointable.totalSupplyAt(_blockNumber);
    }

    /**
     * @inheritdoc IPChainStakeMirror
     */
    function balanceOfAt(
        address _owner,
        uint256 _blockNumber
    )
        public view
        override(IPChainStakeMirror, CheckPointable)
        returns (uint256)
    {
        return CheckPointable.balanceOfAt(_owner, _blockNumber);
    }

    /**
     * Implementation of the AddressUpdatable abstract method.
     */
    function _updateContractAddresses(
        bytes32[] memory _contractNameHashes,
        address[] memory _contractAddresses
    )
        internal override
    {
        addressBinder = IAddressBinder(
            _getContractAddress(_contractNameHashes, _contractAddresses, "AddressBinder"));
        cleanupBlockNumberManager =
            _getContractAddress(_contractNameHashes, _contractAddresses, "CleanupBlockNumberManager");
        governanceVotePower = IIGovernanceVotePower(
            _getContractAddress(_contractNameHashes, _contractAddresses, "GovernanceVotePower"));
        verifier = IIPChainStakeMirrorVerifier(
            _getContractAddress(_contractNameHashes, _contractAddresses, "PChainStakeMirrorVerifier"));
    }

    /**
     * Increase balance for owner and add vote power to nodeId.
     */
    function _increaseStakeAmount(PChainStakingData memory _data, bytes32 _txHash, bytes32 _txId) internal {
        uint256 amountWei = GWEI.mul(_data.weightGwei);
        _mintForAtNow(_data.owner, amountWei); // increase balance
        _increaseVotePower(_data.owner, _data.nodeId, amountWei);

        // update governance vote powers
        governanceVotePower.updateAtTokenTransfer(address(0), _data.owner, 0, 0, amountWei);

        emit StakeConfirmed(_data.owner, _data.nodeId, _txHash, amountWei, _txId);
    }

    /**
     * Decrease balance for owner and remove vote power from nodeId.
     */
    function _decreaseStakeAmount(PChainStakingData memory _data, bytes32 _txHash) internal {
        uint256 amountWei = GWEI.mul(_data.weightGwei);
        _burnForAtNow(_data.owner, amountWei); // decrease balance
        _decreaseVotePower(_data.owner, _data.nodeId, amountWei);

        // update governance vote powers
        governanceVotePower.updateAtTokenTransfer(_data.owner, address(0), 0, 0, amountWei);

        emit StakeEnded(_data.owner, _data.nodeId, _txHash, amountWei);
    }

    /**
     * unique tx hash is combination of transaction id and input address as
     * staking can be done from multiple P-chain addresses in one transaction
     */
    function _getTxHash(
        bytes32 _txId,
        bytes20 _inputAddress
    )
        internal pure returns(bytes32)
    {
        return keccak256(abi.encode(_txId, _inputAddress));
    }
}
