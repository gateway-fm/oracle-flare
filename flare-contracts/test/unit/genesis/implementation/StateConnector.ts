import {
  StateConnectorInstance
} from "../../../../typechain-truffle";

import { expectRevert, expectEvent, time, constants } from '@openzeppelin/test-helpers';
import { encodeContractNames, toBN } from "../../../utils/test-helpers";
import { TestableFlareDaemonInstance } from "../../../../typechain-truffle/TestableFlareDaemon";
import { Contracts } from "../../../../deployment/scripts/Contracts";
import { expectEthersEvent, expectEthersEventNotEmitted } from "../../../utils/EventDecoder";
import { InflationMock__factory, TestableFlareDaemon__factory } from "../../../../typechain";
import { ethers, network } from "hardhat";
const getTestFile = require('../../../utils/constants').getTestFile;
const GOVERNANCE_GENESIS_ADDRESS = require('../../../utils/constants').GOVERNANCE_GENESIS_ADDRESS;

const StateConenctor = artifacts.require("StateConnector");

const BN = web3.utils.toBN;

contract(`StateConnector.sol; ${getTestFile(__filename)}; StateConnector unit tests`, async accounts => {
  let stateConnector: StateConnectorInstance;
  let offset: BN;
  let window: BN;

  beforeEach(async () => {
    stateConnector = await StateConenctor.new();
    offset = await stateConnector.BUFFER_TIMESTAMP_OFFSET();
    window = await stateConnector.BUFFER_WINDOW();
  });

  it("Should request attestations", async() => {
    let data = web3.utils.keccak256("data1");
    let request = await stateConnector.requestAttestations(data);
    const now = await time.latest();
    expectEvent(request, "AttestationRequest", { sender: accounts[0], timestamp: now, data: data});
  });

  it("Should test some functions", async() => {
    let t: BN;
    const now = await time.latest();
    if (now > offset) {
      t = now;
    }
    else {
      t = offset;
    }

    await time.increaseTo(t.addn(91 * 1));
    let root1 = web3.utils.soliditySha3("root") as string;
    let random1 = web3.utils.soliditySha3(toBN(9)) as string;
    let root0 = web3.utils.soliditySha3("root0") as string;
    let random0 = web3.utils.soliditySha3(toBN(99)) as string;
    let root2 = web3.utils.soliditySha3("root2") as string;
    let random2 = web3.utils.soliditySha3(toBN(22)) as string;
    let root3 = web3.utils.soliditySha3("root3") as string;
    let random3 = web3.utils.soliditySha3(toBN(33)) as string;
    const block =  await web3.eth.getBlockNumber();
    const blockTs  = (await web3.eth.getBlock(block)).timestamp as number;
    let buffer = Math.floor((blockTs - offset.toNumber()) / window.toNumber());

    let abi0 = web3.eth.abi.encodeParameters(['bytes32', 'bytes32', 'address'],
    [root1, random1, accounts[0]]);
    let commit0 = web3.utils.soliditySha3(abi0) as string;

    let abi1 = web3.eth.abi.encodeParameters(['bytes32', 'bytes32', 'address'],
    [root2, random2, accounts[0]]);
    let commit1 = web3.utils.soliditySha3(abi1) as string;

    let abi2 = web3.eth.abi.encodeParameters(['bytes32', 'bytes32', 'address'],
    [root3, random3, accounts[0]]);
    let commit2 = web3.utils.soliditySha3(abi2) as string;

    // should revert because buffer number is wrong
    let submit =  stateConnector.submitAttestation(buffer + 1000, commit0, root0, random0);
    await expectRevert(submit, "wrong bufferNumber");

    await stateConnector.submitAttestation(buffer, commit0, root0, random0);

    // second buffer window
    await time.increaseTo(t.addn(91 * 2));
    const block1 =  await web3.eth.getBlockNumber();
    const blockTs1  = (await web3.eth.getBlock(block1)).timestamp as number;
    let buffer1 = Math.floor((blockTs1 - offset.toNumber()) / window.toNumber());

    await stateConnector.submitAttestation(buffer1, commit1, root1, random1);

    // secthirdond buffer window
    await time.increaseTo(t.addn(91 * 3));
    const block2 =  await web3.eth.getBlockNumber();
    const blockTs2  = (await web3.eth.getBlock(block2)).timestamp as number;
    let buffer2 = Math.floor((blockTs2 - offset.toNumber()) / window.toNumber());
  
    await stateConnector.submitAttestation(buffer2, commit2, root2, random2);

    // get attestation
    await stateConnector.getAttestation(buffer2);

    // finalize
    let revert1 = stateConnector.finaliseRound(buffer + 1000, root1);
    let revert2 = stateConnector.finaliseRound(1, root1);
    let revert3 = stateConnector.finaliseRound(0, root1);
    await expectRevert.unspecified(revert1);
    await expectRevert.unspecified(revert2);
    await expectRevert.unspecified(revert3);
    await time.increaseTo(t.addn(91 * 4));
    const block3 =  await web3.eth.getBlockNumber();
    const blockTs3  = (await web3.eth.getBlock(block3)).timestamp as number;
    let buffer3 = Math.floor((blockTs3 - offset.toNumber()) / window.toNumber());
    await stateConnector.finaliseRound(buffer3, root1);

    // lastFinalizedRoundId and merkleRoot; should revert because totalBuffers can be updated only from go code
    let last = stateConnector.lastFinalizedRoundId();
    await expectRevert.unspecified(last);

    let merkleRoot = stateConnector.merkleRoot(1);
    await expectRevert.unspecified(merkleRoot);
  });

  it("Should revert if commit hash does not match", async() => {
    let t: BN;
    const now = await time.latest();
    if (now > offset) {
      t = now;
    }
    else {
      t = offset;
    }
    await time.increaseTo(t.addn(91 * 1));
    let root1 = web3.utils.soliditySha3("root") as string;
    let random1 = web3.utils.soliditySha3(toBN(9)) as string;
    let root0 = web3.utils.soliditySha3("root0") as string;
    let random0 = web3.utils.soliditySha3(toBN(99)) as string;
    let root2 = web3.utils.soliditySha3("root2") as string;
    let random2 = web3.utils.soliditySha3(toBN(22)) as string;
    let root3 = web3.utils.soliditySha3("root3") as string;
    let random3 = web3.utils.soliditySha3(toBN(33)) as string;
    const block =  await web3.eth.getBlockNumber();
    const blockTs  = (await web3.eth.getBlock(block)).timestamp as number;
    let buffer = Math.floor((blockTs - offset.toNumber()) / window.toNumber());

    let abi0 = web3.eth.abi.encodeParameters(['bytes32', 'bytes32', 'address'],
    [root0, random1, accounts[0]]);
    let commit0 = web3.utils.soliditySha3(abi0) as string;

    let abi1 = web3.eth.abi.encodeParameters(['bytes32', 'bytes32', 'address'],
    [root2, random2, accounts[0]]);
    let commit1 = web3.utils.soliditySha3(abi1) as string;

    let abi2 = web3.eth.abi.encodeParameters(['bytes32', 'bytes32', 'address'],
    [root3, random3, accounts[0]]);
    let commit2 = web3.utils.soliditySha3(abi2) as string;

    // should revert because buffer number is wrong
    let submit =  stateConnector.submitAttestation(buffer + 1000, commit0, root0, random0);
    await expectRevert(submit, "wrong bufferNumber");

    await stateConnector.submitAttestation(buffer, commit0, root0, random0);

    // second buffer window
    await time.increaseTo(t.addn(91 * 2));
    const block1 =  await web3.eth.getBlockNumber();
    const blockTs1  = (await web3.eth.getBlock(block1)).timestamp as number;
    let buffer1 = Math.floor((blockTs1 - offset.toNumber()) / window.toNumber());

    await stateConnector.submitAttestation(buffer1, commit1, root1, random1);

    // third buffer window
    await time.increaseTo(t.addn(91 * 3));
    const block2 =  await web3.eth.getBlockNumber();
    const blockTs2  = (await web3.eth.getBlock(block2)).timestamp as number;
    let buffer2 = Math.floor((blockTs2 - offset.toNumber()) / window.toNumber());
  
    await stateConnector.submitAttestation(buffer2, commit2, root2, random2);

    // get attestation
    let getAtt1 = stateConnector.getAttestation(buffer2);
    let getAtt2 = stateConnector.getAttestation(0);
    await expectRevert.unspecified(getAtt1);
    await expectRevert.unspecified(getAtt2);
  });

});
