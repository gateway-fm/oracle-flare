import { HardhatRuntimeEnvironment } from "hardhat/types";
import { Contracts } from "./Contracts";
import { ChainParameters } from "../chain-config/chain-parameters";

/**
 * This script will register all required contracts to the FlareDaemon.
 * It assumes that all contracts have been deployed and contract addresses
 * provided in Contracts object. It will check to insure that all inflation 
 * receivers have a reference to the inflation contract, as this is required
 * in order for receivers to request their tokens once minting has been received by inflation.
 * @dev Do not send anything out via console.log unless it is json defining the created contracts.
 */  
export async function daemonizeContracts(
  hre: HardhatRuntimeEnvironment,
  contracts: Contracts,
  parameters: ChainParameters,
  quiet: boolean = false) {

  const web3 = hre.web3;
  const artifacts = hre.artifacts;
  
  if (!quiet) {
    console.error("Daemonizing contracts...");
  }

  // Define accounts in play for the deployment process
  let deployerAccount: any;
  let genesisGovernanceAccount: any;

  // Get deployer account
  try {
    deployerAccount = web3.eth.accounts.privateKeyToAccount(parameters.deployerPrivateKey);
  } catch (e) {
    throw Error("Check .env file, if the private keys are correct and are prefixed by '0x'.\n" + e)
  }

  try {
    genesisGovernanceAccount = web3.eth.accounts.privateKeyToAccount(parameters.genesisGovernancePrivateKey);
  } catch (e) {
    throw Error("Check .env file, if the private keys are correct and are prefixed by '0x'.\n" + e)
  }
  
  if (!quiet) {
    console.error(`Deploying with address ${deployerAccount.address}`)
  }

  // Wire up the default account that will do the deployment
  web3.eth.defaultAccount = deployerAccount.address;

  // Get contract definitions
  const FlareDaemon = artifacts.require("FlareDaemon");
  const FtsoManager = artifacts.require("FtsoManager");
  const Inflation = artifacts.require("Inflation");
  const IncentivePool = artifacts.require("IncentivePool");
  const DistributionToDelegators = artifacts.require("DistributionToDelegators");
  const IIInflationReceiver = artifacts.require("IIInflationReceiver");
  const PChainStakeMirror = artifacts.require("PChainStakeMirror");

  // Fetch already deployed contracts
  const flareDaemon = await FlareDaemon.at(contracts.getContractAddress(Contracts.FLARE_DAEMON));
  const ftsoManager = await FtsoManager.at(contracts.getContractAddress(Contracts.FTSO_MANAGER));
  const inflation = await Inflation.at(contracts.getContractAddress(Contracts.INFLATION));
  const incentivePool = await IncentivePool.at(contracts.getContractAddress(Contracts.INCENTIVE_POOL));
  const distributionToDelegators = await DistributionToDelegators.at(contracts.getContractAddress(Contracts.DISTRIBUTION_TO_DELEGATORS));
  const pChainStakeMirror = await PChainStakeMirror.at(contracts.getContractAddress(Contracts.P_CHAIN_STAKE_MIRROR));

  // Do inflation receivers know about inflation?
  for (let inflationReceiverName of parameters.inflationReceivers) {
    const inflationReceiverContract = await IIInflationReceiver.at(contracts.getContractAddress(inflationReceiverName));
    const knownInflationAddress = await inflationReceiverContract.getInflationAddress.call();
    if (knownInflationAddress != inflation.address) {
      throw Error(`Contract ${inflationReceiverName} does not have a reference to Inflation at address ${inflation.address}.`);
    }
  }

  // Register daemonized contracts to the daemon...order matters. Inflation first.
  if (!quiet) {
    console.error(`Registering Inflation with gas limit ${parameters.inflationGasLimit}`);
    console.error(`Registering FtsoManager with gas limit ${parameters.ftsoManagerGasLimit}`);
    console.error(`Registering PChainStakeMirror with gas limit ${parameters.pChainStakeMirrorGasLimit}`);
    console.error(`Registering IncentivePool with gas limit ${parameters.incentivePoolGasLimit}`);
    console.error(`Registering DistributionToDelegators with gas limit ${parameters.distributionToDelegatorsGasLimit}`);
  }
  const registrations = [
    { daemonizedContract: inflation.address, gasLimit: parameters.inflationGasLimit },
    { daemonizedContract: ftsoManager.address, gasLimit: parameters.ftsoManagerGasLimit },
    { daemonizedContract: pChainStakeMirror.address, gasLimit: parameters.pChainStakeMirrorGasLimit },
    { daemonizedContract: incentivePool.address, gasLimit: parameters.incentivePoolGasLimit },
    { daemonizedContract: distributionToDelegators.address, gasLimit: parameters.distributionToDelegatorsGasLimit }
  ];
  await flareDaemon.registerToDaemonize(registrations, { from: genesisGovernanceAccount.address });
}
