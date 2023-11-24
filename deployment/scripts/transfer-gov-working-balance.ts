import { HardhatRuntimeEnvironment } from "hardhat/types";
import { governanceAccounts, WORKING_BALANCE_WEI } from "./multisig-governance-accounts";

export async function transferGovWorkingBalance(
  hre: HardhatRuntimeEnvironment,
  deployerPrivateKey: string, 
  quiet: boolean = false) {

  const web3 = hre.web3;

  if (!quiet) {
    console.error("Transfering working balance to governance accounts...");
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
 
  for (let i = 0; i < governanceAccounts.length; i++) {
    console.log(`Send ${WORKING_BALANCE_WEI} WEI to ${governanceAccounts[i]}`);
    await web3.eth.sendTransaction({ from: deployerAccount.address, to: governanceAccounts[i], value: WORKING_BALANCE_WEI });
  };

  if (!quiet) {
    console.error("Transfering complete.");
  }
}