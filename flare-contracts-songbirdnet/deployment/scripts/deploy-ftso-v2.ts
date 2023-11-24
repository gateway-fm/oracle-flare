/**
 * This script will deploy all contracts for the FTSO MVP.
 * It will output, on stdout, a json encoded list of contracts
 * that were deployed. It will write out to stderr, status info
 * as it executes.
 * @dev Do not send anything out via console.log unless it is
 * json defining the created contracts.
 */

import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { AddressUpdaterContract, CleanupBlockNumberManagerContract, FlareDaemonContract, FtsoContract, FtsoManagerContract, FtsoRegistryContract, FtsoRegistryProxyContract, FtsoRewardManagerContract, FtsoV2UpgraderContract, GovernanceSettingsContract, GovernedBaseContract, IIFtsoManagerV1Contract, InflationAllocationContract, InflationContract, MockContractContract, PollingFoundationContract, PriceSubmitterContract, StateConnectorContract, SupplyContract, VoterWhitelisterContract, WNatContract } from '../../typechain-truffle';
import { ChainParameters } from '../chain-config/chain-parameters';
import { Contracts } from "./Contracts";
import { AssetContracts, DeployedFlareContracts, deployNewAsset, rewrapXassetParams, spewNewContractInfo, verifyParameters } from './deploy-utils';


export async function deployFtsoV2(hre: HardhatRuntimeEnvironment, oldContracts: Contracts, parameters: ChainParameters, quiet: boolean = false) {
  const web3 = hre.web3;
  const artifacts = hre.artifacts;

  // Define repository for created contracts
  const contracts = new Contracts();
  verifyParameters(parameters);
  // Define address updater contracts names list
  const addressUpdaterContracts: string[] = [];
  // Define accounts in play for the deployment process
  let deployerAccount: any;

  try {
    deployerAccount = web3.eth.accounts.privateKeyToAccount(parameters.deployerPrivateKey);
  } catch (e) {
    throw Error("Check .env file, if the private key is correct and are prefixed by '0x'.\n" + e)
  }

  // Wire up the default account that will do the deployment
  web3.eth.defaultAccount = deployerAccount.address;

  // Contract definitions
  const GovernanceSettings: GovernanceSettingsContract = artifacts.require("GovernanceSettings");
  const AddressUpdater: AddressUpdaterContract = artifacts.require("AddressUpdater");
  const InflationAllocation: InflationAllocationContract = artifacts.require("InflationAllocation");
  const StateConnector: StateConnectorContract = artifacts.require("StateConnector");
  const FlareDaemon: FlareDaemonContract = artifacts.require("FlareDaemon");
  // const TestableFlareDaemon: TestableFlareDaemonContract = artifacts.require("TestableFlareDaemon");
  const Ftso: FtsoContract = artifacts.require("Ftso");
  const FtsoManager: FtsoManagerContract = artifacts.require("FtsoManager");
  const Inflation: InflationContract = artifacts.require("Inflation");
  const FtsoRegistry: FtsoRegistryContract = artifacts.require("FtsoRegistry");
  const FtsoRewardManager: FtsoRewardManagerContract = artifacts.require("FtsoRewardManager");
  const CleanupBlockNumberManager: CleanupBlockNumberManagerContract = artifacts.require("CleanupBlockNumberManager");
  const PriceSubmitter: PriceSubmitterContract = artifacts.require("PriceSubmitter");
  const Supply: SupplyContract = artifacts.require("Supply");
  const VoterWhitelister: VoterWhitelisterContract = artifacts.require("VoterWhitelister");
  const WNat: WNatContract = artifacts.require("WNat");
  const GovernanceVotePower: WNatContract = artifacts.require("GovernanceVotePower");
  const FtsoRegistryProxy: FtsoRegistryProxyContract = artifacts.require("FtsoRegistryProxy");
  const PollingFoundation: PollingFoundationContract = artifacts.require("PollingFoundation");
  const FtsoV2Upgrader: FtsoV2UpgraderContract = artifacts.require("FtsoV2Upgrader");

  // import old ftso manager interface
  const OldFtsoManager: IIFtsoManagerV1Contract = artifacts.require("IIFtsoManagerV1");

  const stateConnector = await StateConnector.at(oldContracts.getContractAddress(Contracts.STATE_CONNECTOR));
  spewNewContractInfo(contracts, addressUpdaterContracts, StateConnector.contractName, `StateConnector.sol`, stateConnector.address, quiet);
  const flareDaemon = await FlareDaemon.at(oldContracts.getContractAddress(Contracts.FLARE_DAEMON));
  spewNewContractInfo(contracts, addressUpdaterContracts, FlareDaemon.contractName, `FlareDaemon.sol`, flareDaemon.address, quiet);
  const priceSubmitter = await PriceSubmitter.at(oldContracts.getContractAddress(Contracts.PRICE_SUBMITTER));
  spewNewContractInfo(contracts, addressUpdaterContracts, PriceSubmitter.contractName, `PriceSubmitter.sol`, priceSubmitter.address, quiet);
  const inflationAllocation = await InflationAllocation.at(oldContracts.getContractAddress(Contracts.INFLATION_ALLOCATION));
  spewNewContractInfo(contracts, addressUpdaterContracts, InflationAllocation.contractName, `InflationAllocation.sol`, inflationAllocation.address, quiet);
  const inflation = await Inflation.at(oldContracts.getContractAddress(Contracts.INFLATION));
  spewNewContractInfo(contracts, addressUpdaterContracts, Inflation.contractName, `Inflation.sol`, inflation.address, quiet);
  const supply = await Supply.at(oldContracts.getContractAddress(Contracts.SUPPLY));
  spewNewContractInfo(contracts, addressUpdaterContracts, Supply.contractName, `Supply.sol`, supply.address, quiet);
  const ftsoRewardManager = await FtsoRewardManager.at(oldContracts.getContractAddress(Contracts.FTSO_REWARD_MANAGER));
  spewNewContractInfo(contracts, addressUpdaterContracts, FtsoRewardManager.contractName, `FtsoRewardManager.sol`, ftsoRewardManager.address, quiet);
  const cleanupBlockNumberManager = await CleanupBlockNumberManager.at(oldContracts.getContractAddress(Contracts.CLEANUP_BLOCK_NUMBER_MANAGER));
  spewNewContractInfo(contracts, addressUpdaterContracts, CleanupBlockNumberManager.contractName, `CleanupBlockNumberManager.sol`, cleanupBlockNumberManager.address, quiet);
  const voterWhitelister = await VoterWhitelister.at(oldContracts.getContractAddress(Contracts.VOTER_WHITELISTER));
  spewNewContractInfo(contracts, addressUpdaterContracts, VoterWhitelister.contractName, `VoterWhitelister.sol`, voterWhitelister.address, quiet);
  const wNat = await WNat.at(oldContracts.getContractAddress(Contracts.WNAT));
  spewNewContractInfo(contracts, addressUpdaterContracts, WNat.contractName, `WNat.sol`, wNat.address, quiet);
  const governanceVotePower = await GovernanceVotePower.at(oldContracts.getContractAddress(Contracts.GOVERNANCE_VOTE_POWER));
  spewNewContractInfo(contracts, addressUpdaterContracts, GovernanceVotePower.contractName, `GovernanceVotePower.sol`, governanceVotePower.address, quiet);
  const governanceSettings = await GovernanceSettings.at(oldContracts.getContractAddress(Contracts.GOVERNANCE_SETTINGS));
  spewNewContractInfo(contracts, addressUpdaterContracts, GovernanceSettings.contractName, `GovernanceSettings.sol`, governanceSettings.address, quiet);

  const oldFtsoManager = await OldFtsoManager.at(oldContracts.getContractAddress(Contracts.FTSO_MANAGER));
  const oldFtsoRegistry = await FtsoRegistry.at(oldContracts.getContractAddress(Contracts.FTSO_REGISTRY));

  // FtsoV2Upgrader contract
  const ftsoV2Upgrader = await FtsoV2Upgrader.new(deployerAccount.address, oldFtsoManager.address);
  spewNewContractInfo(contracts, null, FtsoV2Upgrader.contractName, `FtsoV2Upgrader.sol`, ftsoV2Upgrader.address, quiet);

  // new AddressUpdater contract
  const addressUpdater = await AddressUpdater.new(ftsoV2Upgrader.address);
  spewNewContractInfo(contracts, addressUpdaterContracts, AddressUpdater.contractName, `AddressUpdater.sol`, addressUpdater.address, quiet);

  // tell FtsoV2Upgrader about addressUpdater
  await ftsoV2Upgrader.setAddressUpdater(addressUpdater.address);

  const priceEpochConfiguration = await oldFtsoManager.getPriceEpochConfiguration();
  const startTs = priceEpochConfiguration[0];
  const priceEpochDurationSeconds = priceEpochConfiguration[1];
  const revealEpochDurationSeconds = priceEpochConfiguration[2];

  // Delayed reward epoch start time
  const rewardEpochStartTs = await oldFtsoManager.rewardEpochsStartTs();
  const rewardEpochDurationSeconds = await oldFtsoManager.rewardEpochDurationSeconds();

  // new FtsoManager contract
  const ftsoManager = await FtsoManager.new(
    ftsoV2Upgrader.address,
    flareDaemon.address,
    addressUpdater.address,
    oldFtsoManager.address,
    startTs,
    priceEpochDurationSeconds,
    revealEpochDurationSeconds,
    rewardEpochStartTs,
    rewardEpochDurationSeconds,
    parameters.votePowerIntervalFraction);
  spewNewContractInfo(contracts, addressUpdaterContracts, FtsoManager.contractName, `FtsoManager.sol`, ftsoManager.address, quiet);

  // new FtsoRegistry contract
  const ftsoRegistryImpl = await FtsoRegistry.new();
  const ftsoRegistryProxy = await FtsoRegistryProxy.new(deployerAccount.address, ftsoRegistryImpl.address);
  const ftsoRegistry = await FtsoRegistry.at(ftsoRegistryProxy.address);
  await ftsoRegistry.initialiseRegistry(addressUpdater.address);
  spewNewContractInfo(contracts, null, FtsoRegistry.contractName, `FtsoRegistry.sol`, ftsoRegistry.address, quiet);

  // Deploy polling foundation
  const pollingFoundation = await PollingFoundation.new(
    deployerAccount.address,
    addressUpdater.address,
    parameters.proposers
  );
  spewNewContractInfo(contracts, addressUpdaterContracts, PollingFoundation.contractName, `PollingFoundation.sol`, pollingFoundation.address, quiet);

  let assetToContracts = new Map<string, AssetContracts>();
  // Create a FTSO for WNAT
  let ftsoWnat: any;
  if (parameters.deployNATFtso) {
    ftsoWnat = await Ftso.new(parameters.nativeSymbol, parameters.nativeFtsoDecimals, priceSubmitter.address, wNat.address, ftsoManager.address, startTs, priceEpochDurationSeconds,
      revealEpochDurationSeconds, parameters.initialWnatPriceUSDDec5, parameters.priceDeviationThresholdBIPS, parameters.priceEpochCyclicBufferSize);
    spewNewContractInfo(contracts, null, `FTSO WNAT`, `Ftso.sol`, ftsoWnat.address, quiet);

    assetToContracts.set(parameters.nativeSymbol, {
      xAssetToken: wNat,
      ftso: ftsoWnat,
      assetSymbol: parameters.nativeSymbol
    })
  }
  // Deploy asset, minter, and initial FTSOs

  for (let asset of parameters.assets) {
    if (!quiet) {
      console.error(`Rigging ${asset.assetSymbol}...`);
    }

    let assetContracts = await deployNewAsset(
      hre,
      contracts,
      deployerAccount.address,
      ftsoManager,
      priceSubmitter.address,
      wNat.address,
      cleanupBlockNumberManager,
      startTs,
      parameters.priceEpochDurationSeconds,
      parameters.revealEpochDurationSeconds,
      rewrapXassetParams(asset),
      parameters.priceDeviationThresholdBIPS,
      parameters.priceEpochCyclicBufferSize,
      false,
      quiet,
    );
    assetToContracts.set(asset.assetSymbol, {
      assetSymbol: asset.assetSymbol,
      ...assetContracts
    });
  }

  if (!quiet) {
    console.error("Adding contract names and addresses to address updater and setting them on ftso manager...");
  }

  // Tell address updater about all contracts - use old Ftso registry in order to be able to copy old prices
  // Set contracts on ftso manager and ftso registry
  await ftsoV2Upgrader.updateContractsUsingAddressUpdater(
    ["FtsoRegistry", ...addressUpdaterContracts],
    [oldFtsoRegistry.address, ...addressUpdaterContracts.map( name => contracts.getContractAddress(name) )],
    [ftsoManager.address, ftsoRegistry.address]
  );

  // Update with new ftso registry and set contracts on polling foundation
  await ftsoV2Upgrader.updateContractsUsingAddressUpdater(["FtsoRegistry"], [ftsoRegistry.address], [pollingFoundation.address]);

  // Setup governance parameters for the ftso manager
  if (!quiet) {
    console.error("Setting FTSO manager governance parameters...");
  }
  await ftsoV2Upgrader.setGovernanceParametersOnFtsoManager(
    parameters.maxVotePowerNatThresholdFraction,
    parameters.maxVotePowerAssetThresholdFraction,
    parameters.lowAssetThresholdUSDDec5,
    parameters.highAssetThresholdUSDDec5,
    parameters.highAssetTurnoutThresholdBIPS,
    parameters.lowNatTurnoutThresholdBIPS,
    parameters.elasticBandRewardBIPS,
    Math.floor(parameters.ftsoRewardExpiryOffsetDays * 60 * 60 * 24),
    parameters.trustedAddresses);

  if (!quiet) {
    console.error(`Setting upgrade data...`);
  }
  let assetList = [
    ...parameters.assets,
    ...(parameters.deployNATFtso ? [{ assetSymbol: parameters.nativeSymbol, elasticBandWidthPPM: parameters.nativeElasticBandWidthPPM }] : [])
  ]
  let ftsoAddresses: string[] = [];
  let elasticBandWidthsPPM: number[] = [];
  for (let asset of assetList) {
    let ftsoContract = (assetToContracts.get(asset.assetSymbol) as AssetContracts).ftso;
    ftsoAddresses.push(ftsoContract.address);
    elasticBandWidthsPPM.push(asset.elasticBandWidthPPM);
  }

  let multiAssetFtsos: string[] = [];
  if (parameters.deployNATFtso) {
    // Set FTSOs to multi Asset WNAT contract
    let multiAssets = parameters.NATMultiAssets;
    multiAssetFtsos = multiAssets.map((asset: any) => assetToContracts.get(asset)!.ftso!.address)
  }
  await ftsoV2Upgrader.setUpgradeData(ftsoAddresses, elasticBandWidthsPPM, parameters.deployNATFtso ? ftsoWnat.address : "0x0000000000000000000000000000000000000000", multiAssetFtsos);

  if (!quiet) {
    console.error(`Switching to production mode...`);
  }
  await pollingFoundation.switchToProductionMode();
  await ftsoRegistry.switchToProductionMode();
  await ftsoV2Upgrader.switchToProductionMode();

  if (!quiet) {
    console.error("Contracts in JSON:");
    console.log(contracts.serialize());
    console.error("Deploy complete.");
  }

  return {
    ftsoManager: ftsoManager,
    ftsoContracts: [
      ...(parameters.deployNATFtso ? [{ xAssetSymbol: 'WNAT' }] : []),
      ...parameters.assets
    ].map(asset => assetToContracts.get(asset.xAssetSymbol))
  } as DeployedFlareContracts;
}
