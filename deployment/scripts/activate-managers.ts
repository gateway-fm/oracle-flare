import { HardhatRuntimeEnvironment } from "hardhat/types";
import { Contracts } from "./Contracts";

/**
 * This script will will activate all manager applications.
 * It assumes that all contracts have been deployed and contract addresses
 * provided in Contracts object. It also expects to receive deployment parameters
 * and validates them the same as during deployment as a sanity check.
 * @dev Do not send anything out via console.log unless it is json defining the created contracts.
 */
export async function activateManagers(
  hre: HardhatRuntimeEnvironment,
  contracts: Contracts,
  deployerPrivateKey: string,
  quiet: boolean = false) {

  const web3 = hre.web3;
  const artifacts = hre.artifacts;

  // Activate the managers
  if (!quiet) {
    console.error("Activating managers...");
  }

  // Define accounts in play for the deployment process
  let deployerAccount: any;

  // Get deployer account
  try {
    deployerAccount = web3.eth.accounts.privateKeyToAccount(deployerPrivateKey);
  } catch (e) {
    throw Error("Check .env file, if the private keys are correct and are prefixed by '0x'.\n" + e)
  }

  // Wire up the default account that will do the deployment
  web3.eth.defaultAccount = deployerAccount.address;

  // Get needed contract definitions
  const FtsoManager = artifacts.require("FtsoManager");
  const FtsoRewardManager = artifacts.require("FtsoRewardManager");
  const ValidatorRewardManager = artifacts.require("ValidatorRewardManager");
  const PChainStakeMirror = artifacts.require("PChainStakeMirror");

  // Fetch already deployed contracts
  const ftsoManager = await FtsoManager.at(contracts.getContractAddress(Contracts.FTSO_MANAGER));
  const ftsoRewardManager = await FtsoRewardManager.at(contracts.getContractAddress(Contracts.FTSO_REWARD_MANAGER));
  const validatorRewardManager = await ValidatorRewardManager.at(contracts.getContractAddress(Contracts.VALIDATOR_REWARD_MANAGER));
  const pChainStakeMirror = await PChainStakeMirror.at(contracts.getContractAddress(Contracts.P_CHAIN_STAKE_MIRROR));

  // Activate them
  await ftsoManager.activate();
  await ftsoRewardManager.activate();
  await validatorRewardManager.activate();
  await pChainStakeMirror.activate();

  if (!quiet) {
    console.error("Managers activated.");
  }
}