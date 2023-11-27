/**
 * This script will deploy all contracts for the FTSO MVP.
 * It will output, on stdout, a json encoded list of contracts
 * that were deployed. It will write out to stderr, status info
 * as it executes.
 * @dev Do not send anything out via console.log unless it is
 * json defining the created contracts.
 */

import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { AddressUpdaterContract, ClaimSetupManagerContract, CleanupBlockNumberManagerContract, DelegationAccountContract, FlareAssetRegistryContract, FlareContractRegistryContract, FlareDaemonContract, FlareDaemonInstance, FtsoContract, FtsoInstance, FtsoManagerContract, FtsoRegistryContract, FtsoRegistryProxyContract, FtsoRewardManagerContract, GovernanceSettingsContract, GovernanceSettingsInstance, GovernanceVotePowerContract, InflationAllocationContract, InflationContract, PollingFoundationContract, PollingFtsoContract, PriceSubmitterContract, PriceSubmitterInstance, StateConnectorContract, StateConnectorInstance, SupplyContract, TestableFlareDaemonContract, VoterWhitelisterContract, WNatContract, WNatRegistryProviderContract } from '../../typechain-truffle';
import { ChainParameters } from '../chain-config/chain-parameters';
import { Contracts } from "./Contracts";
import {
  AssetContracts, DeployedFlareContracts, deployNewAsset, rewrapXassetParams, setDefaultVPContract, spewNewContractInfo,
  verifyParameters, waitFinalize3
} from './deploy-utils';


export async function deployContracts(hre: HardhatRuntimeEnvironment, parameters: ChainParameters, quiet: boolean = false) {
  const web3 = hre.web3;
  const artifacts = hre.artifacts;
  const BN = web3.utils.toBN;

  // Define repository for created contracts
  const contracts = new Contracts();
  verifyParameters(parameters);
  // Define address updater contracts names list
  const addressUpdaterContracts: string[] = [];
  // Define accounts in play for the deployment process
  let deployerAccount: any;
  let genesisGovernanceAccount: any;

  try {
    deployerAccount = web3.eth.accounts.privateKeyToAccount(parameters.deployerPrivateKey);
    genesisGovernanceAccount = web3.eth.accounts.privateKeyToAccount(parameters.genesisGovernancePrivateKey);
  } catch (e) {
    throw Error("Check .env file, if the private keys are correct and are prefixed by '0x'.\n" + e)
  }

  // Check whether genesis governance account has some funds. If not, wire 1 NAT
  let genesisGovernanceBalance = await web3.eth.getBalance(genesisGovernanceAccount.address);
  if (genesisGovernanceBalance == '0') {
    console.error("Sending 1 NAT to genesis governance account ...");
    const toTransfer = web3.utils.toWei("1")
    await waitFinalize3(hre, deployerAccount.address, () => web3.eth.sendTransaction({ from: deployerAccount.address, to: genesisGovernanceAccount.address, value: toTransfer }));
  }
  genesisGovernanceBalance = await web3.eth.getBalance(genesisGovernanceAccount.address);
  if (genesisGovernanceBalance == '0') {
    throw Error("Genesis governance account still empty.")
  }
  // Wire up the default account that will do the deployment
  web3.eth.defaultAccount = deployerAccount.address;

  // Contract definitions
  const GovernanceSettings: GovernanceSettingsContract = artifacts.require("GovernanceSettings");
  const AddressUpdater: AddressUpdaterContract = artifacts.require("AddressUpdater");
  const FlareContractRegistry: FlareContractRegistryContract = artifacts.require("FlareContractRegistry");
  const InflationAllocation: InflationAllocationContract = artifacts.require("InflationAllocation");
  const StateConnector: StateConnectorContract = artifacts.require("StateConnector");
  const FlareDaemon: FlareDaemonContract = artifacts.require("FlareDaemon");
  const TestableFlareDaemon: TestableFlareDaemonContract = artifacts.require("TestableFlareDaemon");
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
  const GovernanceVotePower: GovernanceVotePowerContract = artifacts.require("GovernanceVotePower");
  const DelegationAccount: DelegationAccountContract = artifacts.require("DelegationAccount");
  const ClaimSetupManager: ClaimSetupManagerContract = artifacts.require("ClaimSetupManager");
  const FtsoRegistryProxy: FtsoRegistryProxyContract = artifacts.require("FtsoRegistryProxy");
  const PollingFoundation: PollingFoundationContract = artifacts.require("PollingFoundation");
  const FlareAssetRegistry: FlareAssetRegistryContract = artifacts.require("FlareAssetRegistry");
  const WNatRegistryProvider: WNatRegistryProviderContract = artifacts.require("WNatRegistryProvider");
  const PollingFtso: PollingFtsoContract = artifacts.require("PollingFtso");

  // Initialize the state connector
  let stateConnector: StateConnectorInstance;
  try {
    stateConnector = await StateConnector.at(parameters.stateConnectorAddress);
  } catch (e) {
    if (!quiet) {
      console.error("StateConnector not in genesis...creating new.")
    }
    stateConnector = await StateConnector.new();
  }
  spewNewContractInfo(contracts, addressUpdaterContracts, StateConnector.contractName, `StateConnector.sol`, stateConnector.address, quiet);

  // Initialize the daemon
  let flareDaemon: FlareDaemonInstance;
  try {
    flareDaemon = await FlareDaemon.at(parameters.flareDaemonAddress);
  } catch (e) {
    if (!quiet) {
      console.error("FlareDaemon not in genesis...creating new.")
    }
    // If the flare daemon is not in the genesis block, it will never be triggered automatically.
    // Therefore we need TestableFlareDaemon which can be triggered from outside.
    // WARNING: This should only happen in test.
    flareDaemon = await TestableFlareDaemon.new();
  }
  spewNewContractInfo(contracts, addressUpdaterContracts, FlareDaemon.contractName, `FlareDaemon.sol`, flareDaemon.address, quiet);

  try {
    await flareDaemon.initialiseFixedAddress();
  } catch (e) {
    console.error(`flareDaemon.initialiseFixedAddress() failed. Ignore if redeploy. Error = ${e}`);
  }

  let genesisGovernance = await flareDaemon.governance()

  // Unregister whatever is registered with verification
  try {
    console.error("Unregistring contracts");
    try {
      await waitFinalize3(hre, genesisGovernance, () => flareDaemon.registerToDaemonize([], { from: genesisGovernance }));
    } catch (ee) {
      console.error("Error while unregistring. ", ee)
    }
  } catch (e) {
    console.error("No more kept contracts")
  }

  // Set the block holdoff should a kept contract exceeded its max gas allocation
  await flareDaemon.setBlockHoldoff(parameters.flareDaemonGasExceededHoldoffBlocks, { from: genesisGovernance });

  // PriceSubmitter contract
  let priceSubmitter: PriceSubmitterInstance;
  try {
    priceSubmitter = await PriceSubmitter.at(parameters.priceSubmitterAddress);
  } catch (e) {
    if (!quiet) {
      console.error("PriceSubmitter not in genesis...creating new.")
    }
    priceSubmitter = await PriceSubmitter.new();
  }
  // This has to be done always
  try {
    await priceSubmitter.initialiseFixedAddress();
  } catch (e) {
    console.error(`priceSubmitter.initialiseFixedAddress() failed. Ignore if redeploy. Error = ${e}`);
  }

  spewNewContractInfo(contracts, addressUpdaterContracts, PriceSubmitter.contractName, "PriceSubmitter.sol", priceSubmitter.address, quiet);

  let governanceSettings: GovernanceSettingsInstance;
  try {
    governanceSettings = await GovernanceSettings.at(parameters.governanceSettingsAddress);
  } catch (e) {
    if (!quiet) {
      console.error("GovernanceSettings not deployed yet...creating new.")
    }

    // default executors are governancePublicKey and governanceExecutorPublicKey if set
    const executors = [parameters.governancePublicKey];
    if (parameters.governanceExecutorPublicKey != "<use .env: GOVERNANCE_EXECUTOR_PUBLIC_KEY>") {
      console.error(`Adding ${parameters.governanceExecutorPublicKey} as governance executor.`)
      executors.push(parameters.governanceExecutorPublicKey);
    }

    const hardhat: HardhatRuntimeEnvironment = require('hardhat');
    console.error("Network name: " + hardhat.network.name)
    if (hardhat.network.name === "localhost" || hardhat.network.name === "hardhat") {
      const tempGovSettings = await GovernanceSettings.new();
      const governanceSettingsCode = await web3.eth.getCode(tempGovSettings.address);   // get deployed code
      await hardhat.network.provider.send("hardhat_setCode", [parameters.governanceSettingsAddress, governanceSettingsCode]);
      await hardhat.network.provider.send("hardhat_setStorageAt", [parameters.governanceSettingsAddress, "0x0", "0x0000000000000000000000000000000000000000000000000000000000000000"]);  // clear initialisation
      governanceSettings = await GovernanceSettings.at(parameters.governanceSettingsAddress);
      await governanceSettings.initialise(parameters.governancePublicKey, parameters.governanceTimelock, executors);
    } else {
      let governanceSettingsDeployerAddress: string;
      try {
        governanceSettingsDeployerAddress = web3.eth.accounts.privateKeyToAccount(parameters.governanceSettingsDeployerPrivateKey).address;
      } catch (e) {
        throw Error("Check .env file, if the private keys are correct and are prefixed by '0x'.\n" + e)
      }
      await web3.eth.sendTransaction({from: deployerAccount.address, to: governanceSettingsDeployerAddress, value: web3.utils.toWei("1")});
      governanceSettings = await GovernanceSettings.new({from: governanceSettingsDeployerAddress});
      if (governanceSettings.address.toLowerCase() != parameters.governanceSettingsAddress.toLowerCase()) {
        throw Error("Governance settings address mismatch.")
      }
      await governanceSettings.initialise(parameters.governancePublicKey, parameters.governanceTimelock, executors, {from: governanceSettingsDeployerAddress});
    }
  }
  spewNewContractInfo(contracts, addressUpdaterContracts, GovernanceSettings.contractName, `GovernanceSettings.sol`, governanceSettings.address, quiet);

  // AddressUpdater
  const addressUpdater = await AddressUpdater.new(deployerAccount.address);
  spewNewContractInfo(contracts, addressUpdaterContracts, AddressUpdater.contractName, `AddressUpdater.sol`, addressUpdater.address, quiet);

  // Flare contract registry
  const flareContractRegistry = await FlareContractRegistry.new(addressUpdater.address);
  spewNewContractInfo(contracts, addressUpdaterContracts, FlareContractRegistry.contractName, `FlareContractRegistry.sol`, flareContractRegistry.address, quiet);

  // InflationAllocation contract
  const inflationAllocation = await InflationAllocation.new(deployerAccount.address, addressUpdater.address, parameters.scheduledInflationPercentageBIPS);
  spewNewContractInfo(contracts, addressUpdaterContracts, InflationAllocation.contractName, `InflationAllocation.sol`, inflationAllocation.address, quiet);


  // Get the timestamp for the just mined block
  let currentBlock = await web3.eth.getBlock(await web3.eth.getBlockNumber());
  const startTs = BN(currentBlock.timestamp);

  // Delayed reward epoch start time
  const rewardEpochStartTs = startTs.addn(parameters.rewardEpochsStartDelayPriceEpochs * parameters.priceEpochDurationSeconds + parameters.revealEpochDurationSeconds);

  // Inflation contract
  const inflation = await Inflation.new(
    deployerAccount.address,
    flareDaemon.address,
    addressUpdater.address,
    startTs.addn(parameters.inflationStartDelaySeconds)
  );
  spewNewContractInfo(contracts, addressUpdaterContracts, Inflation.contractName, `Inflation.sol`, inflation.address, quiet);

  // Supply contract
  const supply = await Supply.new(
    deployerAccount.address,
    addressUpdater.address,
    BN(parameters.totalNativeSupplyNAT).mul(BN(10).pow(BN(18))),
    BN(parameters.totalExcludedSupplyNAT).mul(BN(10).pow(BN(18))),
    [],
    parameters.foundationAddresses,
    "0x0000000000000000000000000000000000000000" // old supply
  );
  spewNewContractInfo(contracts, addressUpdaterContracts, Supply.contractName, `Supply.sol`, supply.address, quiet);

  // FtsoRewardManager contract (must link first)
  const ftsoRewardManager = await FtsoRewardManager.new(
    deployerAccount.address,
    addressUpdater.address,
    "0x0000000000000000000000000000000000000000", // old ftso reward manager
    parameters.rewardFeePercentageUpdateOffsetEpochs,
    parameters.defaultRewardFeePercentageBIPS);
  spewNewContractInfo(contracts, addressUpdaterContracts, FtsoRewardManager.contractName, `FtsoRewardManager.sol`, ftsoRewardManager.address, quiet);

  // CleanupBlockNumberManager contract
  const cleanupBlockNumberManager = await CleanupBlockNumberManager.new(
    deployerAccount.address,
    addressUpdater.address,
    "FtsoManager"
  );
  spewNewContractInfo(contracts, addressUpdaterContracts, CleanupBlockNumberManager.contractName, `CleanupBlockNumberManager.sol`, cleanupBlockNumberManager.address, quiet);

  // Inflation allocation needs to know about reward managers
  let receiversAddresses = []
  for (let a of parameters.inflationReceivers) {
    receiversAddresses.push(contracts.getContractAddress(a));
  }
  await inflationAllocation.setSharingPercentages(receiversAddresses, parameters.inflationSharingBIPS);

  // Supply contract needs to know about reward managers
  await supply.addTokenPool(ftsoRewardManager.address, 0);

  // setup topup factors on inflation receivers
  for (let i = 0; i < receiversAddresses.length; i++) {
    await inflation.setTopupConfiguration(receiversAddresses[i], parameters.inflationTopUpTypes[i], parameters.inflationTopUpFactorsx100[i])
  }

  // FtsoRegistryContract
  const ftsoRegistry = await FtsoRegistry.new();
  const ftsoRegistryProxy = await FtsoRegistryProxy.new(deployerAccount.address, ftsoRegistry.address);
  const registry = await FtsoRegistry.at(ftsoRegistryProxy.address);
  await registry.initialiseRegistry(addressUpdater.address);
  spewNewContractInfo(contracts, addressUpdaterContracts, FtsoRegistry.contractName, `FtsoRegistry.sol`, registry.address, quiet);

  // VoterWhitelisting
  const voterWhitelister = await VoterWhitelister.new(deployerAccount.address, addressUpdater.address, priceSubmitter.address, parameters.defaultVoterWhitelistSize, "0x0000000000000000000000000000000000000000");
  spewNewContractInfo(contracts, addressUpdaterContracts, VoterWhitelister.contractName, `VoterWhitelister.sol`, voterWhitelister.address, quiet);

  // ClaimSetupManager
  const claimSetupManager = await ClaimSetupManager.new(
    deployerAccount.address,
    addressUpdater.address,
    parameters.executorFeeValueUpdateOffsetEpochs,
    BN(parameters.executorMinFeeValueWei.replace(/\s/g, '')),
    BN(parameters.executorMaxFeeValueNAT).mul(BN(10).pow(BN(18))),
    BN(parameters.executorRegisterFeeValueNAT).mul(BN(10).pow(BN(18)))
  );
  spewNewContractInfo(contracts, addressUpdaterContracts, ClaimSetupManager.contractName, `ClaimSetupManager.sol`, claimSetupManager.address, quiet);

  const delegationAccount = await DelegationAccount.new();
  spewNewContractInfo(contracts, null, DelegationAccount.contractName, `DelegationAccount.sol`, delegationAccount.address, quiet);
  await delegationAccount.initialize(claimSetupManager.address, claimSetupManager.address);
  await claimSetupManager.setLibraryAddress(delegationAccount.address);

  // FtsoManager contract (must link with library first)
  const ftsoManager = await FtsoManager.new(
    deployerAccount.address,
    flareDaemon.address,
    addressUpdater.address,
    "0x0000000000000000000000000000000000000000", // old ftso manager
    startTs,
    parameters.priceEpochDurationSeconds,
    parameters.revealEpochDurationSeconds,
    rewardEpochStartTs,
    parameters.rewardEpochDurationSeconds,
    parameters.votePowerIntervalFraction);
  spewNewContractInfo(contracts, addressUpdaterContracts, FtsoManager.contractName, `FtsoManager.sol`, ftsoManager.address, quiet);

  // Deploy wrapped native token
  const wNat = await WNat.new(deployerAccount.address, parameters.wrappedNativeName, parameters.wrappedNativeSymbol);
  spewNewContractInfo(contracts, addressUpdaterContracts, WNat.contractName, `WNat.sol`, wNat.address, quiet);

  await setDefaultVPContract(hre, wNat, deployerAccount.address);
  await cleanupBlockNumberManager.registerToken(wNat.address);
  await wNat.setCleanupBlockNumberManager(cleanupBlockNumberManager.address);

  // Deploy governance vote power
  const governanceVotePower = await GovernanceVotePower.new(wNat.address);
  spewNewContractInfo(contracts, addressUpdaterContracts, GovernanceVotePower.contractName, `GovernanceVotePower.sol`, governanceVotePower.address, quiet);

  // Tell wNat contract about governance vote power
  await wNat.setGovernanceVotePower(governanceVotePower.address);

  // Deploy polling foundation
  const pollingFoundation = await PollingFoundation.new(
    deployerAccount.address,
    addressUpdater.address,
    parameters.proposers
  );
  spewNewContractInfo(contracts, addressUpdaterContracts, PollingFoundation.contractName, `PollingFoundation.sol`, pollingFoundation.address, quiet);

  // Deploy Flare asset registry
  const flareAssetRegistry = await FlareAssetRegistry.new(deployerAccount.address);
  spewNewContractInfo(contracts, addressUpdaterContracts, FlareAssetRegistry.contractName, `FlareAssetRegistry.sol`, flareAssetRegistry.address, quiet);
  // Deploy polling ftso
  const pollingFtso = await PollingFtso.new(
      deployerAccount.address,
      addressUpdater.address
  );
  await pollingFtso.setMaintainer(deployerAccount.address);
  await pollingFtso.setParameters( // can be called only from maintainer address
    parameters.votingDelaySeconds,
    parameters.votingPeriodSeconds,
    parameters.thresholdConditionBIPS,
    parameters.majorityConditionBIPS,
    BN(parameters.proposalFeeValueNAT).mul(BN(10).pow(BN(18))),
    parameters.addAfterRewardedEpochs,
    parameters.addAfterNotChilledEpochs,
    parameters.removeAfterNotRewardedEpochs,
    parameters.removeAfterEligibleProposals,
    parameters.removeAfterNonParticipatingProposals,
    parameters.removeForDays
  );
  await pollingFtso.setMaintainer(parameters.maintainer);
  spewNewContractInfo(contracts, addressUpdaterContracts, PollingFtso.contractName, `PollingFtso.sol`, pollingFtso.address, quiet);

  // Tell address updater about all contracts
  await addressUpdater.addOrUpdateContractNamesAndAddresses(
    addressUpdaterContracts, addressUpdaterContracts.map(name => contracts.getContractAddress(name))
  );

  // Set other contracts on all address updatable contracts
  let addressUpdatableContracts = [
    inflationAllocation.address,
    inflation.address,
    registry.address,
    cleanupBlockNumberManager.address,
    voterWhitelister.address,
    ftsoManager.address,
    ftsoRewardManager.address,
    supply.address,
    pollingFoundation.address,
    claimSetupManager.address,
    pollingFtso.address
  ];
  await addressUpdater.updateContractAddresses(addressUpdatableContracts);

  await flareDaemon.setInflation(inflation.address, { from: genesisGovernance });
  await priceSubmitter.setContractAddresses(registry.address, voterWhitelister.address, ftsoManager.address, { from: genesisGovernance });

  // WNatRegistryProvider contract - should be deployed after adding WNat to address updater
  const wNatRegistryProvider = await WNatRegistryProvider.new(addressUpdater.address, flareAssetRegistry.address);
  await flareAssetRegistry.registerProvider(wNatRegistryProvider.address, true);
  spewNewContractInfo(contracts, null, WNatRegistryProvider.contractName, `WNatRegistryProvider.sol`, wNatRegistryProvider.address, quiet);

  let assetToContracts = new Map<string, AssetContracts>();

  // Create a FTSO for WNAT
  let ftsoWnat: FtsoInstance;
  if (parameters.deployNATFtso) {
    ftsoWnat = await Ftso.new(parameters.nativeSymbol, parameters.nativeFtsoDecimals, priceSubmitter.address, wNat.address, ftsoManager.address, startTs, parameters.priceEpochDurationSeconds,
      parameters.revealEpochDurationSeconds, parameters.initialWnatPriceUSDDec5, parameters.priceDeviationThresholdBIPS, parameters.priceEpochCyclicBufferSize);
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
      console.error(`Rigging ${asset.assetSymbol}...${parameters.deployDummyXAssetTokensAndMinters ? " with dummy token and minter" : ""}`);
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
      parameters.deployDummyXAssetTokensAndMinters,
      quiet,
    );
    assetToContracts.set(asset.assetSymbol, {
      assetSymbol: asset.assetSymbol,
      ...assetContracts
    });
  }

  // Setup governance parameters for the ftso manager
  if (!quiet) {
    console.error("Setting FTSO manager governance parameters...");
  }
  await ftsoManager.setGovernanceParameters(
    0,
    parameters.maxVotePowerNatThresholdFraction,
    parameters.maxVotePowerAssetThresholdFraction,
    parameters.lowAssetThresholdUSDDec5,
    parameters.highAssetThresholdUSDDec5,
    parameters.highAssetTurnoutThresholdBIPS,
    parameters.lowNatTurnoutThresholdBIPS,
    parameters.elasticBandRewardBIPS,
    Math.floor(parameters.ftsoRewardExpiryOffsetDays * 60 * 60 * 24),
    parameters.trustedAddresses);

  // Add ftsos to the ftso manager
  if (!quiet) {
    console.error("Adding FTSOs to manager...");
  }

  // sgb/flr was added as the last one
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
    await waitFinalize3(hre, deployerAccount.address, () => ftsoManager.addFtso(ftsoContract.address));
  }

  await ftsoManager.setElasticBandWidthPPMFtsos(0, ftsoAddresses, elasticBandWidthsPPM);

  if (parameters.deployNATFtso) {
    // Set FTSOs to multi Asset WNAT contract
    let multiAssets = parameters.NATMultiAssets;
    let multiAssetFtsos = multiAssets.map((asset: any) => assetToContracts.get(asset)!.ftso!.address)
    await ftsoManager.setFtsoAssetFtsos(ftsoWnat!.address, multiAssetFtsos);
  }

  if (!quiet) {
    console.error("Contracts in JSON:");
    console.log(contracts.serialize());
    console.error("Deploy complete.");
  }

  return {
    cleanupBlockNumberManager: cleanupBlockNumberManager,
    ftsoRewardManager: ftsoRewardManager,
    ftsoManager: ftsoManager,
    flareDaemon: flareDaemon,
    priceSubmitter: priceSubmitter,
    supply: supply,
    inflationAllocation: inflationAllocation,
    stateConnector: stateConnector,
    ftsoRegistry: registry,
    ftsoContracts: [
      ...(parameters.deployNATFtso ? [{ xAssetSymbol: 'WNAT' }] : []),
      ...parameters.assets
    ].map(asset => assetToContracts.get(asset.xAssetSymbol)),
    contracts: contracts,
  } as DeployedFlareContracts;
}
