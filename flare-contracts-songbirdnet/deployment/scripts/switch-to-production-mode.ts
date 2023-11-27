import { HardhatRuntimeEnvironment } from "hardhat/types";
import { Contracts } from "./Contracts";

type Account = ReturnType<typeof web3.eth.accounts.privateKeyToAccount>;

export async function switchToProductionMode(
    hre: HardhatRuntimeEnvironment,
    contracts: Contracts,
    deployerPrivateKey: string,
    genesisGovernancePrivateKey: string,
    quiet: boolean = false
) {
    const web3 = hre.web3;
    const artifacts = hre.artifacts as Truffle.Artifacts;

    // Turn over governance
    if (!quiet) {
        console.error("Switching to production mode...");
    }

    // Define accounts in play for the deployment process
    let deployerAccount: Account;
    let genesisGovernanceAccount: Account;

    // Get deployer account
    try {
        deployerAccount = web3.eth.accounts.privateKeyToAccount(deployerPrivateKey);
    } catch (e) {
        throw Error("Check .env file, if the private keys are correct and are prefixed by '0x'.\n" + e)
    }

    // Get deployer account
    try {
        genesisGovernanceAccount = web3.eth.accounts.privateKeyToAccount(genesisGovernancePrivateKey);
    } catch (e) {
        throw Error("Check .env file, if the private keys are correct and are prefixed by '0x'.\n" + e)
    }


    if (!quiet) {
        console.error(`Switching to production from deployer address ${deployerAccount.address} and genesis governance address ${genesisGovernanceAccount.address}`);
        console.error(`Using governance settings at ${contracts.getContractAddress(Contracts.GOVERNANCE_SETTINGS)}`);
    }

    // Wire up the default account that will do the deployment
    web3.eth.defaultAccount = deployerAccount.address;

    // Contract definitions
    const AddressUpdater = artifacts.require("AddressUpdater");
    const InflationAllocation = artifacts.require("InflationAllocation");
    const FtsoManager = artifacts.require("FtsoManager");
    const Inflation = artifacts.require("Inflation");
    const FtsoRewardManager = artifacts.require("FtsoRewardManager");
    const Supply = artifacts.require("Supply");
    const VoterWhitelister = artifacts.require("VoterWhitelister");
    const CleanupBlockNumberManager = artifacts.require("CleanupBlockNumberManager");
    const FtsoRegistry = artifacts.require("FtsoRegistry");
    const ClaimSetupManager = artifacts.require("ClaimSetupManager");
    const PollingFoundation = artifacts.require("PollingFoundation");
    const FlareAssetRegistry = artifacts.require("FlareAssetRegistry");
    const PollingFtso = artifacts.require("PollingFtso");

    // Get deployed contracts
    const addressUpdater = await AddressUpdater.at(contracts.getContractAddress(Contracts.ADDRESS_UPDATER));
    const supply = await Supply.at(contracts.getContractAddress(Contracts.SUPPLY));
    const inflation = await Inflation.at(contracts.getContractAddress(Contracts.INFLATION));
    const inflationAllocation = await InflationAllocation.at(contracts.getContractAddress(Contracts.INFLATION_ALLOCATION));
    const ftsoRewardManager = await FtsoRewardManager.at(contracts.getContractAddress(Contracts.FTSO_REWARD_MANAGER));
    const ftsoManager = await FtsoManager.at(contracts.getContractAddress(Contracts.FTSO_MANAGER));
    const voterWhitelister = await VoterWhitelister.at(contracts.getContractAddress(Contracts.VOTER_WHITELISTER));
    const cleanupBlockNumberManager = await CleanupBlockNumberManager.at(contracts.getContractAddress(Contracts.CLEANUP_BLOCK_NUMBER_MANAGER));
    const ftsoRegistry = await FtsoRegistry.at(contracts.getContractAddress(Contracts.FTSO_REGISTRY));
    const pollingFoundation = await PollingFoundation.at(contracts.getContractAddress(Contracts.POLLING_FOUNDATION));
    const flareAssetRegistry = await FlareAssetRegistry.at(contracts.getContractAddress(Contracts.FLARE_ASSET_REGISTRY));
    const claimSetupManager = await ClaimSetupManager.at(contracts.getContractAddress(Contracts.CLAIM_SETUP_MANAGER));
    const pollingFtso = await PollingFtso.at(contracts.getContractAddress(Contracts.POLLING_FTSO));

    // switch to production mode
    await addressUpdater.switchToProductionMode();
    await supply.switchToProductionMode();
    await inflation.switchToProductionMode();
    await inflationAllocation.switchToProductionMode();
    await ftsoRewardManager.switchToProductionMode();
    await claimSetupManager.switchToProductionMode();
    await ftsoManager.switchToProductionMode();
    await voterWhitelister.switchToProductionMode();
    await cleanupBlockNumberManager.switchToProductionMode();
    await ftsoRegistry.switchToProductionMode();
    await pollingFoundation.switchToProductionMode();
    await flareAssetRegistry.switchToProductionMode();
    await pollingFtso.switchToProductionMode();
}
