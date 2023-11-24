import { HardhatRuntimeEnvironment } from "hardhat/types";
import { Contracts } from "./Contracts";

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
  deployerPrivateKey: string,
  genesisGovernancePrivateKey: string,
  inflationReceivers: string[], 
  inflationGasLimit: number,
  ftsoManagerGasLimit: number,
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
    deployerAccount = web3.eth.accounts.privateKeyToAccount(deployerPrivateKey);
  } catch (e) {
    throw Error("Check .env file, if the private keys are correct and are prefixed by '0x'.\n" + e)
  }

  try {
    genesisGovernanceAccount = web3.eth.accounts.privateKeyToAccount(genesisGovernancePrivateKey);
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
  const IIInflationReceiver = artifacts.require("IIInflationReceiver");

  // Fetch already deployed contracts
  const flareDaemon = await FlareDaemon.at(contracts.getContractAddress(Contracts.FLARE_DAEMON));
  const ftsoManager = await FtsoManager.at(contracts.getContractAddress(Contracts.FTSO_MANAGER));
  const inflation = await Inflation.at(contracts.getContractAddress(Contracts.INFLATION));

  // Do inflation receivers know about inflation?
  for (let inflationReceiverName of inflationReceivers) {
    const inflationReceiverContract = await IIInflationReceiver.at(contracts.getContractAddress(inflationReceiverName));
    const knownInflationAddress = await inflationReceiverContract.getInflationAddress.call();
    if (knownInflationAddress != inflation.address) {
      throw Error(`Contract ${inflationReceiverName} does not have a reference to Inflation at address ${inflation.address}.`);
    }
  }

  // Register daemonized contracts to the daemon...order matters. Inflation first.
  if (!quiet) {
    console.error(`Registering Inflation with gas limit ${inflationGasLimit}`);
    console.error(`Registering FtsoManager with gas limit ${ftsoManagerGasLimit}`);
  }
  const registrations = [
    { daemonizedContract: inflation.address, gasLimit: inflationGasLimit },
    { daemonizedContract: ftsoManager.address, gasLimit: ftsoManagerGasLimit }
  ];
  await flareDaemon.registerToDaemonize(registrations, { from: genesisGovernanceAccount.address }); 
}
