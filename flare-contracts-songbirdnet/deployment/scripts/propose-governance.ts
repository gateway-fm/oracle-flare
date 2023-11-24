import { HardhatRuntimeEnvironment } from "hardhat/types";
import { Contracts } from "./Contracts";

export async function proposeGovernance(
  hre: HardhatRuntimeEnvironment,
  contracts: Contracts,
  deployerPrivateKey: string,
  genesisGovernancePrivateKey: string,
  newGovernanceAccountAddress: string,
  quiet: boolean = false) {

  const web3 = hre.web3;
  const artifacts = hre.artifacts;

  // Turn over governance
  if (!quiet) {
    console.error("Proposing governance...");
  }

  // Define accounts in play for the deployment process
  let deployerAccount: any;
  let genesisGovernanceAccount: any;

  // Get deployer account
  try {
    deployerAccount = web3.eth.accounts.privateKeyToAccount(deployerPrivateKey);
    genesisGovernanceAccount = web3.eth.accounts.privateKeyToAccount(genesisGovernancePrivateKey);
  } catch (e) {
    throw Error("Check .env file, if the private keys are correct and are prefixed by '0x'.\n" + e)
  }

  if (!quiet) {
    console.error(`Proposing with address ${deployerAccount.address}`)
  }

  // Wire up the default account that will do the deployment
  web3.eth.defaultAccount = deployerAccount.address;

  // Contract definitions
  const FlareDaemon = artifacts.require("FlareDaemon");
  const PriceSubmitter = artifacts.require("PriceSubmitter");
  const WNat = artifacts.require("WNat");

  // Get deployed contracts
  const flareDaemon = await FlareDaemon.at(contracts.getContractAddress(Contracts.FLARE_DAEMON));
  const priceSubmitter = await PriceSubmitter.at(contracts.getContractAddress(Contracts.PRICE_SUBMITTER));
  const wNat = await WNat.at(contracts.getContractAddress(Contracts.WNAT));

  if (!quiet) {
    console.error(`Proposed address is ${newGovernanceAccountAddress}`);
  }

  // Propose
  await flareDaemon.proposeGovernance(newGovernanceAccountAddress, { from: genesisGovernanceAccount.address });
  await priceSubmitter.proposeGovernance(newGovernanceAccountAddress, { from: genesisGovernanceAccount.address });
  await wNat.proposeGovernance(newGovernanceAccountAddress);
}
