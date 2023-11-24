// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../governance/implementation/GovernedAtGenesis.sol";
import "../implementation/Inflation.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";


/**
 * @title FlareDaemon mock contract
 * @notice A contract to simulate flare daemon daemonize and to request minting.
 **/
contract FlareDaemonWithInflationMock is GovernedAtGenesis {
    using SafeMath for uint256;

    string internal constant ERR_NOT_INFLATION = "not inflation";
    string internal constant ERR_TOO_MANY = "too many";
    string internal constant ERR_TOO_BIG = "too big";
    string internal constant ERR_TOO_OFTEN = "too often";
    string internal constant ERR_INFLATION_ZERO = "inflation zero";

    // Initial max mint request - 50 million native token
    uint256 internal constant MAX_MINTING_REQUEST_DEFAULT = 50000000 ether;
    // How often can inflation request minting from the validator - 23 hours constant
    uint256 internal constant MAX_MINTING_FREQUENCY_SEC = 23 hours;

    Inflation public inflation;
    uint256 public totalMintingRequestedWei;
    uint256 public maxMintingRequestWei;
    uint256 public lastMintRequestTs;
    uint256 public lastUpdateMaxMintRequestTs;

    event MintingRequestReceived(uint256 amountWei);
    event InflationSet(IInflationGenesis theNewContract, IInflationGenesis theOldContract);

    
    /**
     * @dev Access control to protect methods to allow only minters to call select methods
     *   (like transferring balance out).
     */
    modifier onlyInflation (address _inflation) {
        require (address(inflation) == _inflation, ERR_NOT_INFLATION);
        _;
    }

    constructor() GovernedAtGenesis(address(0)) {
        /* empty block */
    }

    function triggerDaemonize() external {
        inflation.daemonize();
    }

    function triggerReceiveMinting(uint256 _toMint) external {
        inflation.receiveMinting{ value: _toMint }();
    }

    /**
     * @notice Sets the inflation contract, which will receive minted inflation funds for funding to
     *   rewarding contracts.
     * @param _inflation   The inflation contract.
     */
    function setInflation(Inflation _inflation) external onlyGovernance {
        require(address(_inflation) != address(0), ERR_INFLATION_ZERO);
        emit InflationSet(inflation, _inflation);
        inflation = _inflation;
        if (maxMintingRequestWei == 0) {
            maxMintingRequestWei = MAX_MINTING_REQUEST_DEFAULT;
        }
    }

     /**
     * @notice Queue up a minting request to send to the validator at next trigger.
     * @param _amountWei    The amount to mint.
     */
    function requestMinting(uint256 _amountWei) external onlyInflation(msg.sender) {
        require(_amountWei <= maxMintingRequestWei, ERR_TOO_BIG);
        require(lastMintRequestTs.add(MAX_MINTING_FREQUENCY_SEC) < block.timestamp, ERR_TOO_OFTEN);
        if (_amountWei > 0) {
            lastMintRequestTs = block.timestamp;
            totalMintingRequestedWei = totalMintingRequestedWei.add(_amountWei);
            emit MintingRequestReceived(_amountWei);
        }
    }
}
