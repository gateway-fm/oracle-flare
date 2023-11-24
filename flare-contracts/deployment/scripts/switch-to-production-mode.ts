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
    const FlareDaemon = artifacts.require("FlareDaemon");
    const FtsoManager = artifacts.require("FtsoManager");
    const Inflation = artifacts.require("Inflation");
    const FtsoRewardManager = artifacts.require("FtsoRewardManager");
    const PriceSubmitter = artifacts.require("PriceSubmitter");
    const Supply = artifacts.require("Supply");
    const VoterWhitelister = artifacts.require("VoterWhitelister");
    const CleanupBlockNumberManager = artifacts.require("CleanupBlockNumberManager");
    const DistributionTreasury = artifacts.require("DistributionTreasury");
    const DistributionToDelegators = artifacts.require("DistributionToDelegators");
    const IncentivePoolTreasury = artifacts.require("IncentivePoolTreasury");
    const IncentivePool = artifacts.require("IncentivePool");
    const IncentivePoolAllocation = artifacts.require("IncentivePoolAllocation");
    const InitialAirdrop = artifacts.require("InitialAirdrop");
    const FtsoRegistry = artifacts.require("FtsoRegistry");
    const WNat = artifacts.require("WNat");
    const Escrow = artifacts.require("Escrow");
    const ClaimSetupManager = artifacts.require("ClaimSetupManager");
    const ValidatorRegistry = artifacts.require("ValidatorRegistry");
    const ValidatorRewardManager = artifacts.require("ValidatorRewardManager");
    const PollingFoundation = artifacts.require("PollingFoundation");
    const FlareAssetRegistry = artifacts.require("FlareAssetRegistry");
    const PollingFtso = artifacts.require("PollingFtso");
    const PChainStakeMirrorMultiSigVoting = artifacts.require("PChainStakeMirrorMultiSigVoting");
    const PChainStakeMirror = artifacts.require("PChainStakeMirror");

    // Get deployed contracts
    const addressUpdater = await AddressUpdater.at(contracts.getContractAddress(Contracts.ADDRESS_UPDATER));
    const supply = await Supply.at(contracts.getContractAddress(Contracts.SUPPLY));
    const inflation = await Inflation.at(contracts.getContractAddress(Contracts.INFLATION));
    const inflationAllocation = await InflationAllocation.at(contracts.getContractAddress(Contracts.INFLATION_ALLOCATION));
    const flareDaemon = await FlareDaemon.at(contracts.getContractAddress(Contracts.FLARE_DAEMON));
    const ftsoRewardManager = await FtsoRewardManager.at(contracts.getContractAddress(Contracts.FTSO_REWARD_MANAGER));
    const ftsoManager = await FtsoManager.at(contracts.getContractAddress(Contracts.FTSO_MANAGER));
    const priceSubmitter = await PriceSubmitter.at(contracts.getContractAddress(Contracts.PRICE_SUBMITTER));
    const voterWhitelister = await VoterWhitelister.at(contracts.getContractAddress(Contracts.VOTER_WHITELISTER));
    const cleanupBlockNumberManager = await CleanupBlockNumberManager.at(contracts.getContractAddress(Contracts.CLEANUP_BLOCK_NUMBER_MANAGER));
    const distributionTreasury = await DistributionTreasury.at(contracts.getContractAddress(Contracts.DISTRIBUTION_TREASURY));
    const incentivePoolTreasury = await IncentivePoolTreasury.at(contracts.getContractAddress(Contracts.INCENTIVE_POOL_TREASURY));
    const incentivePool = await IncentivePool.at(contracts.getContractAddress(Contracts.INCENTIVE_POOL));
    const incentivePoolAllocation = await IncentivePoolAllocation.at(contracts.getContractAddress(Contracts.INCENTIVE_POOL_ALLOCATION));
    const initialAirdrop = await InitialAirdrop.at(contracts.getContractAddress(Contracts.INITIAL_AIRDROP));
    const ftsoRegistry = await FtsoRegistry.at(contracts.getContractAddress(Contracts.FTSO_REGISTRY));
    const wNat = await WNat.at(contracts.getContractAddress(Contracts.WNAT));
    const escrow = await Escrow.at(contracts.getContractAddress(Contracts.ESCROW));
    const validatorRegistry = await ValidatorRegistry.at(contracts.getContractAddress(Contracts.VALIDATOR_REGISTRY));
    const validatorRewardManager = await ValidatorRewardManager.at(contracts.getContractAddress(Contracts.VALIDATOR_REWARD_MANAGER));
    const pollingFoundation = await PollingFoundation.at(contracts.getContractAddress(Contracts.POLLING_FOUNDATION));
    const flareAssetRegistry = await FlareAssetRegistry.at(contracts.getContractAddress(Contracts.FLARE_ASSET_REGISTRY));
    const claimSetupManager = await ClaimSetupManager.at(contracts.getContractAddress(Contracts.CLAIM_SETUP_MANAGER));
    const distributionToDelegators = await DistributionToDelegators.at(contracts.getContractAddress(Contracts.DISTRIBUTION_TO_DELEGATORS));
    const pollingFtso = await PollingFtso.at(contracts.getContractAddress(Contracts.POLLING_FTSO));
    const pChainStakeMirrorMultiSigVoting = await PChainStakeMirrorMultiSigVoting.at(contracts.getContractAddress(Contracts.P_CHAIN_STAKE_MIRROR_MULTI_SIG_VOTING));
    const pChainStakeMirror = await PChainStakeMirror.at(contracts.getContractAddress(Contracts.P_CHAIN_STAKE_MIRROR));

    // switch to production mode
    await flareDaemon.switchToProductionMode({ from: genesisGovernanceAccount.address });
    await priceSubmitter.switchToProductionMode({ from: genesisGovernanceAccount.address });
    await incentivePoolTreasury.switchToProductionMode();
    await initialAirdrop.switchToProductionMode();
    await distributionTreasury.switchToProductionMode();
    await addressUpdater.switchToProductionMode();
    await supply.switchToProductionMode();
    await inflation.switchToProductionMode();
    await inflationAllocation.switchToProductionMode();
    await ftsoRewardManager.switchToProductionMode();
    await claimSetupManager.switchToProductionMode();
    await distributionToDelegators.switchToProductionMode();
    await incentivePool.switchToProductionMode();
    await incentivePoolAllocation.switchToProductionMode();
    await ftsoManager.switchToProductionMode();
    await voterWhitelister.switchToProductionMode();
    await cleanupBlockNumberManager.switchToProductionMode();
    await ftsoRegistry.switchToProductionMode();
    await wNat.switchToProductionMode();
    await escrow.switchToProductionMode();
    await validatorRegistry.switchToProductionMode();
    await validatorRewardManager.switchToProductionMode();
    await pollingFoundation.switchToProductionMode();
    await flareAssetRegistry.switchToProductionMode();
    await pollingFtso.switchToProductionMode();
    await pChainStakeMirrorMultiSigVoting.switchToProductionMode();
    await pChainStakeMirror.switchToProductionMode();
}
