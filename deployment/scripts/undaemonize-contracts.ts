import { HardhatRuntimeEnvironment } from "hardhat/types";
import { Contracts } from "./Contracts";

async function sleep(ms: number) {
  await new Promise((resolve: any) => setTimeout(() => resolve(), ms));
}

export async function undaemonizeContracts(
  hre: HardhatRuntimeEnvironment,
  contracts: Contracts,
  governancePrivateKey: string,
  quiet: boolean = false) {

  const web3 = hre.web3;
  const artifacts = hre.artifacts;
  
  if (!quiet) {
    console.error("Undaemonizing contracts...");
  }
  
  // Define accounts in play
  let governanceAccount: any;

  // Get deployer account
  try {
    governanceAccount = web3.eth.accounts.privateKeyToAccount(governancePrivateKey);
  } catch (e) {
    throw Error("Check .env file, if the private keys are correct and are prefixed by '0x'.\n" + e)
  }
  
  // Wire up the default account that will do unregister
  web3.eth.defaultAccount = governanceAccount.address;

  // Contract definitions
  const FlareDaemon = artifacts.require("FlareDaemon");

  // Get deployed contracts
  const flareDaemon = await FlareDaemon.at(contracts.getContractAddress(Contracts.FLARE_DAEMON));

  await flareDaemon.registerToDaemonize([]);
  await sleep(2000);  // Do we really need to sleep here?
}