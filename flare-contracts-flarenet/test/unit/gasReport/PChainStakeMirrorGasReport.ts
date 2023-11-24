import { time } from '@openzeppelin/test-helpers';
import { Contracts } from "../../../deployment/scripts/Contracts";
import privateKeys from "../../../test-1020-accounts.json";
import { AddressBinderInstance, GovernanceVotePowerInstance, MockContractInstance, PChainStakeMirrorInstance, WNatInstance } from "../../../typechain-truffle";
import * as util from "../../utils/key-to-address";
import { encodeContractNames, getAddressWithZeroBalance, toBN } from "../../utils/test-helpers";
import { toChecksumAddress } from 'ethereumjs-util';

const getTestFile = require('../../utils/constants').getTestFile;

const WNat = artifacts.require("WNat");
const GovernanceVotePower = artifacts.require("GovernanceVotePower");
const PChainStakeMirror = artifacts.require("PChainStakeMirror");
const AddressBinder = artifacts.require("AddressBinder");
const PChainStakeMirrorVerifier = artifacts.require("PChainStakeMirrorVerifier");
const MockContract = artifacts.require("MockContract");


let wNat: WNatInstance;
let governanceVotePower: GovernanceVotePowerInstance;
let pChainStakeMirror: PChainStakeMirrorInstance;
let addressBinder: AddressBinderInstance;
let pChainStakeMirrorVerifier: MockContractInstance;
let FLARE_DAEMON: string;
let ADDRESS_UPDATER: string;
let CLEANUP_BLOCK_NUMBER_MANAGER: string;

contract(`PChainStakeMirror.sol; ${getTestFile(__filename)}; gas consumption tests`, async accounts => {
  const GOVERNANCE_ADDRESS = accounts[5];
  FLARE_DAEMON = accounts[1];
  ADDRESS_UPDATER = accounts[2];
  CLEANUP_BLOCK_NUMBER_MANAGER = accounts[3];

  async function pChainStakeMirrorGasBenchmarking(
    noOfStakers: number,
    noOfNodes: number,
    noOfStakesExpire: number,
    expireStakesOfTheSameNode: boolean,
    stakesContinue: boolean,
    delegateGovernanceVP: boolean
  ) {
    assert(noOfStakesExpire <= noOfNodes);

    const stakerAddresses: string[][] = [];
    for (let i = 10; i < 10 + noOfStakers; i++) {
      let prvKey = privateKeys[i].privateKey.slice(2);
      let prvkeyBuffer = Buffer.from(prvKey, 'hex');
      let [x, y] = util.privateKeyToPublicKeyPair(prvkeyBuffer);
      let pubKey = "0x" + util.encodePublicKey(x, y, false).toString('hex');
      let pAddr = "0x" + util.publicKeyToAvalancheAddress(x, y).toString('hex');
      let cAddr = toChecksumAddress("0x" + util.publicKeyToEthereumAddress(x, y).toString('hex'));
      await addressBinder.registerAddresses(pubKey, pAddr, cAddr);
      stakerAddresses.push([cAddr, pAddr]);
      await wNat.deposit({value: toBN(100), from: cAddr});
      if (delegateGovernanceVP) {
        const delegateToAddress = await getAddressWithZeroBalance();
        await wNat.depositTo(delegateToAddress, {value: toBN(100), from: accounts[0]});
        await governanceVotePower.delegate(delegateToAddress, {from: cAddr});
      }
    }

    const startTs = await time.latest();
    const endTs = startTs.addn(noOfStakers * (stakesContinue ? noOfNodes + noOfStakesExpire : noOfNodes) + 10);

    const endTs2 = startTs.addn(5 * noOfStakers * noOfNodes);
    for (let i = 0; i < noOfStakers; i++) {
      for (let j = stakesContinue ? 0 : noOfStakesExpire; j < noOfNodes; j++) {
        await mirrorStake(
          web3.utils.keccak256(i + "-" + j + "-2"),
          expireStakesOfTheSameNode ? web3.utils.keccak256("" + j).slice(0, 42) : web3.utils.keccak256(i + "-" + j).slice(0, 42),
          startTs,
          endTs2,
          stakerAddresses[i][1]);
      }
    }

    for (let i = 0; i < noOfStakers; i++) {
      for (let j = 0; j < noOfStakesExpire; j++) {
        await mirrorStake(
          web3.utils.keccak256(i + "-" + j),
          expireStakesOfTheSameNode ? web3.utils.keccak256("" + j).slice(0, 42) : web3.utils.keccak256(i + "-" + j).slice(0, 42),
          startTs,
          endTs,
          stakerAddresses[i][1]);
      }
    }

    let gasOld = 0;
    let gas = 0;
    while (true) {
      gasOld = gas;
      let tx = await pChainStakeMirror.daemonize({from: FLARE_DAEMON});
      gas = tx.receipt.gasUsed;
      if (endTs.lt(await pChainStakeMirror.nextTimestampToTrigger())) {
        console.log(`normal transaction, gas usage: ${gasOld}`);
        console.log(`finalize stakes, gas usage: ${gas}`);
        tx = await pChainStakeMirror.daemonize({from: FLARE_DAEMON});
        console.log(`normal transaction, gas usage: ${tx.receipt.gasUsed}`);
        tx = await pChainStakeMirror.daemonize({from: FLARE_DAEMON});
        console.log(`normal transaction, gas usage: ${tx.receipt.gasUsed}`);
        break;
      }
    }
  }

  async function mirrorStake(txId: string, nodeId: string, startTime: BN, endTime: BN, inputAddress: string) {
    const data = {
      txId: txId,
      stakingType: 0,
      inputAddress: inputAddress,
      nodeId: nodeId,
      startTime: startTime.toNumber(),
      endTime: endTime.toNumber(),
      weight: 1000
    };
    await pChainStakeMirror.mirrorStake(data, []);
  }

  beforeEach(async () => {
    const pChainStakeMirrorVerifierInterface = await PChainStakeMirrorVerifier.new(accounts[0], 1, 1000, 5, 5000);
    let prvKey = privateKeys[0].privateKey.slice(2);
    let prvkeyBuffer = Buffer.from(prvKey, 'hex');
    let [x, y] = util.privateKeyToPublicKeyPair(prvkeyBuffer);
    let pAddr = "0x" + util.publicKeyToAvalancheAddress(x, y).toString('hex');
    let data = {
      txId: web3.utils.keccak256("..."),
      stakingType: 0,
      inputAddress: pAddr,
      nodeId: "0x0123456789012345678901234567890123456789",
      startTime: 0,
      endTime: 1,
      weight: 1000
    };
    const mirrorStake = pChainStakeMirrorVerifierInterface.contract.methods.verifyStake(data, []).encodeABI();

    pChainStakeMirror = await PChainStakeMirror.new(
      GOVERNANCE_ADDRESS,
      FLARE_DAEMON,
      ADDRESS_UPDATER,
      1000
    );

    wNat = await WNat.new(accounts[0], "Wrapped NAT", "WNAT");
    governanceVotePower = await GovernanceVotePower.new(wNat.address, pChainStakeMirror.address);
    await wNat.setGovernanceVotePower(governanceVotePower.address);

    addressBinder = await AddressBinder.new();

    pChainStakeMirrorVerifier = await MockContract.new();
    await pChainStakeMirrorVerifier.givenMethodReturnBool(mirrorStake, true);

    await pChainStakeMirror.updateContractAddresses(
      encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.ADDRESS_BINDER, Contracts.GOVERNANCE_VOTE_POWER, Contracts.CLEANUP_BLOCK_NUMBER_MANAGER, Contracts.P_CHAIN_STAKE_MIRROR_VERIFIER]),
      [ADDRESS_UPDATER, addressBinder.address, governanceVotePower.address, CLEANUP_BLOCK_NUMBER_MANAGER, pChainStakeMirrorVerifier.address], { from: ADDRESS_UPDATER });

    await pChainStakeMirror.activate({from: GOVERNANCE_ADDRESS});
  });

  it.skip("PChainStakeMirror daemonize calls for 50 stakers (stake ends at the same timestamp), each staking to 3 nodes, only one expires (different for each), all stakes remain, governance vote power delegated", async () => {
    await pChainStakeMirrorGasBenchmarking(50, 3, 1, false, true, true);
  });

  it.skip("PChainStakeMirror daemonize calls for 50 stakers (stake ends at the same timestamp), each staking to 3 nodes, only one expires (same for all), all stakes remain, governance vote power delegated", async () => {
    await pChainStakeMirrorGasBenchmarking(50, 3, 1, true, true, true);
  });

  it.skip("PChainStakeMirror daemonize calls for 50 stakers (stake ends at the same timestamp), each staking to 3 nodes, only one expires (same for all), other stakes remain, governance vote power delegated", async () => {
    await pChainStakeMirrorGasBenchmarking(50, 3, 1, true, false, true);
  });

  it.skip("PChainStakeMirror daemonize calls for 50 stakers (stake ends at the same timestamp), each staking to 3 nodes, only one expires (same for all), other stakes remain, governance vote power not delegated", async () => {
    await pChainStakeMirrorGasBenchmarking(50, 3, 1, true, false, false);
  });

  it.skip("PChainStakeMirror daemonize calls for 100 stakers (stake ends at the same timestamp), each staking to 3 nodes, only one expires (same for all), other stakes remain, governance vote power not delegated", async () => {
    await pChainStakeMirrorGasBenchmarking(100, 3, 1, true, false, false);
  });

  it.skip("PChainStakeMirror daemonize calls for 200 stakers (stake ends at the same timestamp), each staking to 3 nodes, only one expires (same for all), other stakes remain, governance vote power not delegated", async () => {
    await pChainStakeMirrorGasBenchmarking(200, 3, 1, true, false, false);
  });

  it.skip("PChainStakeMirror daemonize calls for 500 stakers (stake ends at the same timestamp), each staking to 3 nodes, only one expires (same for all), other stakes remain, governance vote power not delegated", async () => {
    await pChainStakeMirrorGasBenchmarking(500, 3, 1, true, false, false);
  });

  it.skip("WC - PChainStakeMirror daemonize calls for 250 stakers (stake ends at the same timestamp), each staking to 2 nodes, only one expires (different for each), all stakes remain, governance vote power delegated", async () => {
    await pChainStakeMirrorGasBenchmarking(250, 2, 1, false, true, true);
  });

  it("WC - PChainStakeMirror daemonize calls for 250 stakers (stake ends at the same timestamp), each staking to 3 nodes, only one expires (different for each), all stakes remain, governance vote power delegated", async () => {
    await pChainStakeMirrorGasBenchmarking(250, 3, 1, false, true, true);
  });

  it.skip("WC - PChainStakeMirror daemonize calls for 250 stakers (stake ends at the same timestamp), each staking to 4 nodes, only one expires (different for each), all stakes remain, governance vote power delegated", async () => {
    await pChainStakeMirrorGasBenchmarking(250, 4, 1, false, true, true);
  });

  it.skip("WC - PChainStakeMirror daemonize calls for 250 stakers (stake ends at the same timestamp), each staking to 5 nodes, only one expires (different for each), all stakes remain, governance vote power delegated", async () => {
    await pChainStakeMirrorGasBenchmarking(250, 5, 1, false, true, true);
  });

  it.skip("EC - PChainStakeMirror daemonize calls for 250 stakers (stake ends at the same timestamp), each staking to 2 nodes, only one expires (same for all), other stakes remain, governance vote power not delegated", async () => {
    await pChainStakeMirrorGasBenchmarking(250, 2, 1, true, false, false);
  });

  it("EC - PChainStakeMirror daemonize calls for 250 stakers (stake ends at the same timestamp), each staking to 3 nodes, only one expires (same for all), other stakes remain, governance vote power not delegated", async () => {
    await pChainStakeMirrorGasBenchmarking(250, 3, 1, true, false, false);
  });

  it.skip("EC - PChainStakeMirror daemonize calls for 250 stakers (stake ends at the same timestamp), each staking to 4 nodes, only one expires (same for all), other stakes remain, governance vote power not delegated", async () => {
    await pChainStakeMirrorGasBenchmarking(250, 4, 1, true, false, false);
  });

  it.skip("EC - PChainStakeMirror daemonize calls for 250 stakers (stake ends at the same timestamp), each staking to 5 nodes, only one expires (same for all), other stakes remain, governance vote power not delegated", async () => {
    await pChainStakeMirrorGasBenchmarking(250, 5, 1, true, false, false);
  });

});
