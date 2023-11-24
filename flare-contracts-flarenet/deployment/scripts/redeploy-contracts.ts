import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { ChainParameters } from '../chain-config/chain-parameters';
import { Contracts } from "./Contracts";
import { spewNewContractInfo, verifyParameters } from './deploy-utils';
import { AddressBinderContract, CombinedNatContract, FtsoManagerContract, GovernanceVotePowerContract, PChainStakeMirrorContract, PChainStakeMirrorMultiSigVotingContract, PChainStakeMirrorVerifierContract } from '../../typechain-truffle';


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
    throw Error("Check .env file, if the private keys are correct and are prefixed by '0x'.\n" + e)
  }

  const FtsoManager: FtsoManagerContract = artifacts.require("FtsoManager");
  const AddressBinder: AddressBinderContract = artifacts.require("AddressBinder");
  const PChainStakeMirrorMultiSigVoting: PChainStakeMirrorMultiSigVotingContract = artifacts.require("PChainStakeMirrorMultiSigVoting");
  const PChainStakeMirrorVerifier: PChainStakeMirrorVerifierContract = artifacts.require("PChainStakeMirrorVerifier");
  const PChainStakeMirror: PChainStakeMirrorContract = artifacts.require("PChainStakeMirror");
  const CombinedNat: CombinedNatContract = artifacts.require("CombinedNat");
  const GovernanceVotePower: GovernanceVotePowerContract = artifacts.require("GovernanceVotePower");


  // AddressBinder contract
  const addressBinder = await AddressBinder.new();
  spewNewContractInfo(contracts, null, AddressBinder.contractName, `AddressBinder.sol`, addressBinder.address, quiet);

  const ftsoManager = await FtsoManager.at(contracts.getContractAddress(Contracts.FTSO_MANAGER));
  const {0: firstEpochStartTs, 1: priceEpochDurationSeconds, 2: revealEpochDurationSeconds} = await ftsoManager.getPriceEpochConfiguration();

  // PChainStakeMirrorMultiSigVoting contract
  const pChainStakeMirrorMultiSigVoting = await PChainStakeMirrorMultiSigVoting.new(
    deployerAccount.address,
    firstEpochStartTs,
    priceEpochDurationSeconds,
    parameters.pChainStakeMirrorVotingThreshold,
    parameters.pChainStakeMirrorVoters
  );
  spewNewContractInfo(contracts, null, PChainStakeMirrorMultiSigVoting.contractName, `PChainStakeMirrorMultiSigVoting.sol`, pChainStakeMirrorMultiSigVoting.address, quiet);

  // PChainStakeMirrorVerifier contract
  const pChainStakeMirrorVerifier = await PChainStakeMirrorVerifier.new(
    pChainStakeMirrorMultiSigVoting.address,
    parameters.pChainStakeMirrorMinDurationDays * 60 * 60 * 24,
    parameters.pChainStakeMirrorMaxDurationDays * 60 * 60 * 24,
    BN(parameters.pChainStakeMirrorMinAmountNAT).mul(BN(10).pow(BN(9))),
    BN(parameters.pChainStakeMirrorMaxAmountNAT).mul(BN(10).pow(BN(9)))
  );
  spewNewContractInfo(contracts, null, PChainStakeMirrorVerifier.contractName, `PChainStakeMirrorVerifier.sol`, pChainStakeMirrorVerifier.address, quiet);

  // PChainStakeMirror contract
  const pChainStakeMirror = await PChainStakeMirror.new(
    deployerAccount.address,
    contracts.getContractAddress(Contracts.FLARE_DAEMON),
    deployerAccount.address, // temp addressUpdater
    parameters.maxStakeEndsPerBlock
  );
  spewNewContractInfo(contracts, null, PChainStakeMirror.contractName, `PChainStakeMirror.sol`, pChainStakeMirror.address, quiet);

  // CombinedNat contract
  const combinedNat = await CombinedNat.new(
    contracts.getContractAddress(Contracts.WNAT),
    pChainStakeMirror.address
  );
  spewNewContractInfo(contracts, null, CombinedNat.contractName, `CombinedNat.sol`, combinedNat.address, quiet);

  // GovernanceVotePower contract
  const governanceVotePower = await GovernanceVotePower.new(
    contracts.getContractAddress(Contracts.WNAT),
    pChainStakeMirror.address
  );
  spewNewContractInfo(contracts, null, GovernanceVotePower.contractName, `GovernanceVotePower.sol`, governanceVotePower.address, quiet);

  // set other contract addresses
  await pChainStakeMirror.updateContractAddresses(
    encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.ADDRESS_BINDER, Contracts.GOVERNANCE_VOTE_POWER, Contracts.CLEANUP_BLOCK_NUMBER_MANAGER, Contracts.P_CHAIN_STAKE_MIRROR_VERIFIER]),
    [contracts.getContractAddress(Contracts.ADDRESS_UPDATER), addressBinder.address, governanceVotePower.address, contracts.getContractAddress(Contracts.CLEANUP_BLOCK_NUMBER_MANAGER), pChainStakeMirrorVerifier.address])

  // switch to production mode
  await pChainStakeMirrorMultiSigVoting.switchToProductionMode();
  await pChainStakeMirror.switchToProductionMode();


  if (!quiet) {
    console.error("Contracts in JSON:");
    console.log(contracts.serialize());
    console.error("Deploy complete.");
  }
}
