import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { ChainParameters } from '../chain-config/chain-parameters';
import { Contracts } from "./Contracts";
import { spewNewContractInfo, verifyParameters } from './deploy-utils';
import { InflationAllocationContract, InflationContract, SupplyContract } from '../../typechain-truffle';


export async function redeployContracts(hre: HardhatRuntimeEnvironment, contracts: Contracts, parameters: ChainParameters, quiet: boolean = false) {

  function encodeContractNames(names: string[]): string[] {
    return names.map(name => encodeString(name));
  }

  function encodeString(text: string): string {
    return hre.ethers.utils.keccak256(hre.ethers.utils.defaultAbiCoder.encode(["string"], [text]));
  }

  const web3 = hre.web3;
  const artifacts = hre.artifacts;
  const BN = web3.utils.toBN;


  verifyParameters(parameters);
  // Define accounts in play for the deployment process
  let deployerAccount: any;

  try {
    deployerAccount = web3.eth.accounts.privateKeyToAccount(parameters.deployerPrivateKey);
  } catch (e) {
    throw Error("Check .env file, if the private key is correct and is prefixed by '0x'.\n" + e)
  }

  // Wire up the default account that will do the deployment
  web3.eth.defaultAccount = deployerAccount.address;

  // Contract definitions
  const InflationAllocation: InflationAllocationContract = artifacts.require("InflationAllocation");
  const Inflation: InflationContract = artifacts.require("Inflation");
  const Supply: SupplyContract = artifacts.require("Supply");

  // InflationAllocation contract
  const inflationAllocation = await InflationAllocation.new(
    deployerAccount.address,
    deployerAccount.address, // temp addressUpdater
    parameters.scheduledInflationPercentageBIPS);
  spewNewContractInfo(contracts, null, InflationAllocation.contractName, `InflationAllocation.sol`, inflationAllocation.address, quiet);

  // Inflation contract
  const oldInflation = await Inflation.at(contracts.getContractAddress(Contracts.INFLATION));
  const inflation = await Inflation.new(
    deployerAccount.address,
    contracts.getContractAddress(Contracts.FLARE_DAEMON),
    deployerAccount.address, // temp addressUpdater
    await oldInflation.rewardEpochStartTs()
  );
  spewNewContractInfo(contracts, null, Inflation.contractName, `Inflation.sol`, inflation.address, quiet);

  // Supply contract
  const oldSupply = await Supply.at(contracts.getContractAddress(Contracts.SUPPLY));
  const tokenPools = [];
  let index: number = 0;
  while(true) {
    try {
      tokenPools.push((await oldSupply.tokenPools(index++))[0]);
    } catch (e) {
      break;
    }
  }
  const supply = await Supply.new(
    deployerAccount.address,
    deployerAccount.address, // temp addressUpdater
    BN(parameters.totalNativeSupplyNAT).mul(BN(10).pow(BN(18))),
    BN(parameters.totalExcludedSupplyNAT).mul(BN(10).pow(BN(18))),
    tokenPools,
    parameters.foundationAddresses,
    oldSupply.address
  );
  spewNewContractInfo(contracts, null, Supply.contractName, `Supply.sol`, supply.address, quiet);

  // set other contract addresses
  await inflationAllocation.updateContractAddresses(
    encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION]),
    [contracts.getContractAddress(Contracts.ADDRESS_UPDATER), inflation.address]);

  await inflation.updateContractAddresses(
    encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.SUPPLY, Contracts.INFLATION_ALLOCATION]),
    [contracts.getContractAddress(Contracts.ADDRESS_UPDATER), supply.address, inflationAllocation.address]);

  await supply.updateContractAddresses(
    encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION]),
    [contracts.getContractAddress(Contracts.ADDRESS_UPDATER), inflation.address]);


  // all excluded supply was already distributed
  await supply.increaseDistributedSupply(BN(parameters.totalExcludedSupplyNAT).mul(BN(10).pow(BN(18))));

  // Inflation allocation needs to know about reward managers
  let receiversAddresses = []
  for (let a of parameters.inflationReceivers) {
    receiversAddresses.push(contracts.getContractAddress(a));
  }
  await inflationAllocation.setSharingPercentages(receiversAddresses, parameters.inflationSharingBIPS);

  // setup topup factors on inflation receivers
  for (let i = 0; i < receiversAddresses.length; i++) {
    await inflation.setTopupConfiguration(receiversAddresses[i], parameters.inflationTopUpTypes[i], parameters.inflationTopUpFactorsx100[i]);
  }

  // switch to production mode
  await inflationAllocation.switchToProductionMode();
  await inflation.switchToProductionMode();
  await supply.switchToProductionMode();


  if (!quiet) {
    console.error("Contracts in JSON:");
    console.log(contracts.serialize());
    console.error("Deploy complete.");
  }
}
