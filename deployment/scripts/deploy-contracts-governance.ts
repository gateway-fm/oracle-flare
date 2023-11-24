/**
 * This script will deploy PollingFoundation contract.
 * It will output, on stdout, a json encoded list of contracts
 * that were deployed. It will write out to stderr, status info
 * as it executes.
 * @dev Do not send anything out via console.log unless it is
 * json defining the created contracts.
 */

import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { PollingFoundationContract } from '../../typechain-truffle';
import { ChainParameters } from '../chain-config/chain-parameters';
import { Contracts } from "./Contracts";
import { spewNewContractInfo } from './deploy-utils';

export async function deployContractsGovernance(hre: HardhatRuntimeEnvironment,  contracts: Contracts, parameters: ChainParameters, quiet: boolean = false) {
  const web3 = hre.web3;
  const artifacts = hre.artifacts;

  // Define accounts in play for the deployment process
  let deployerAccount: any;


  try {
    deployerAccount = web3.eth.accounts.privateKeyToAccount(parameters.deployerPrivateKey);
  } catch (e) {
    throw Error("Check .env file, if the private keys are correct and are prefixed by '0x'.\n" + e)
  }

  // Wire up the default account that will do the deployment
  web3.eth.defaultAccount = deployerAccount.address;

  const PollingFoundation: PollingFoundationContract = artifacts.require("PollingFoundation");

  const addressUpdater = contracts.getContractAddress(Contracts.ADDRESS_UPDATER);

  // Deploy polling foundation
  const pollingFoundation = await PollingFoundation.new(
    deployerAccount.address,
    parameters.priceSubmitterAddress,
    addressUpdater,
    parameters.proposers
  );
  spewNewContractInfo(contracts, null, PollingFoundation.contractName, `PollingFoundation.sol`, pollingFoundation.address, quiet);

  if (!quiet) {
    console.error("Contracts in JSON:");
    console.log(contracts.serialize());
    console.error("Deploy complete.");
  }

  await pollingFoundation.switchToProductionMode();

  return {
    contracts: contracts,
  };
}
