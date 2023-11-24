// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
import "../../genesis/implementation/PriceSubmitter.sol";

/**
 * @title Hack for unregister ftsos from PriceSubmitter.sol, if after crash in the middle of deploy.
 * TODO:// FIX the deployment script to clean up price submitter.
 * In hardhat console:
 * const PriceSubmitter = artifacts.require("PriceSubmitter");
 * let priceSubmitter = await PriceSubmitter.at("0x1000000000000000000000000000000000000003")
 * const PriceSubmitterUnregisterHack = artifacts.require("PriceSubmitterUnregisterHack");
 * let unregisterHack = await PriceSubmitterUnregisterHack.new(priceSubmitter.address);
 * const FlareDaemon = artifacts.require("FlareDaemon");
 * let flareDaemon = await FlareDaemon.at("0x1000000000000000000000000000000000000002");
 * let currentGovernanceAddress = await flareDaemon.governance()
 * await priceSubmitter.setFtsoManager(unregisterHack.address, {from: currentGovernanceAddress});
 * await priceSubmitter.setVoterWhitelister(unregisterHack.address, {from: currentGovernanceAddress});
 * // Use all addresses of newly deployed FTSO contarcts and call for each the following.
 * await unregisterHack.unregisterFtso(address)
 **/
contract PriceSubmitterUnregisterHack {
    
    address private ftsoRegistry;
    uint256 private ftsoIndex;
    PriceSubmitter private priceSubmitter;

    constructor(PriceSubmitter _priceSubmitter) {
        priceSubmitter = _priceSubmitter;
    }

    // whitelister 
    function setFtsoRegistry(address _ftsoRegistry) external {
        ftsoRegistry = _ftsoRegistry;
    }

    function removeFtso(uint256 _ftsoIndex) external {
        ftsoIndex = _ftsoIndex;
    }
}
