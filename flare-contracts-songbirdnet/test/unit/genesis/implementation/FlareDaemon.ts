import { 
  EndlessLoopMockInstance,
  FlareDaemonInstance, 
  InflationMockInstance, 
  MockContractInstance } from "../../../../typechain-truffle";

import {expectRevert, expectEvent, time, constants} from '@openzeppelin/test-helpers';
import { toBN } from "../../../utils/test-helpers";
import { TestableFlareDaemonInstance } from "../../../../typechain-truffle/TestableFlareDaemon";
const getTestFile = require('../../../utils/constants').getTestFile;
const GOVERNANCE_GENESIS_ADDRESS = require('../../../utils/constants').GOVERNANCE_GENESIS_ADDRESS;

const TestableFlareDaemon = artifacts.require("TestableFlareDaemon");
const MockContract = artifacts.require("MockContract");
const SuicidalMock = artifacts.require("SuicidalMock");
const InflationMock = artifacts.require("InflationMock");
const EndlessLoopMock = artifacts.require("EndlessLoopMock");
const RealFlareDaemon = artifacts.require("FlareDaemon");

const BN = web3.utils.toBN;

const ONLY_GOVERNANCE_MSG = "only governance";
const TOO_MANY_CONTRACTS_MSG = "too many";
const INFLATION_ZERO_MSG = "inflation zero";
const REGISTRATIONUPDATED_EVENT = "RegistrationUpdated";
const MINTINGREQUESTRECEIVED_EVENT = "MintingRequestReceived";
const MINTINGREQUESTTRIGGERED_EVENT = "MintingRequestTriggered";
const MINTINGRECEIVED_EVENT = "MintingReceived";
const MINTINGWITHDRAWN_EVENT = "MintingWithdrawn";
const SELFDESTRUCTRECEIVED_EVENT = "SelfDestructReceived";
const CONTRACTHELDOFF_EVENT = "ContractHeldOff";
const CONTRACTDAEMONIZED_EVENT = "ContractDaemonized";
const CONTRACTDAEMONIZEERRORED_EVENT = "ContractDaemonizeErrored";
const INFLATIONSET_EVENT = "InflationSet";
const ERR_DUPLICATE_ADDRESS = "dup address";
const ERR_OUT_OF_GAS = "out of gas";


const MAX_MINTING_FREQUENCY_SEC = 23 * 60 * 60; // Limit from FlareDaemon

contract(`FlareDaemon.sol; ${getTestFile(__filename)}; FlareDaemon unit tests`, async accounts => {
  // contains a fresh contract for each test
  let flareDaemon: TestableFlareDaemonInstance;
  let mockInflation: InflationMockInstance;
  let mockContractToDaemonize: MockContractInstance;
  let endlessLoop: EndlessLoopMockInstance;
  const daemonize = web3.utils.sha3("daemonize()")!.slice(0,10); // first 4 bytes is function selector

  beforeEach(async() => {
    flareDaemon = await TestableFlareDaemon.new();
    await flareDaemon.initialiseFixedAddress();
    mockContractToDaemonize = await MockContract.new();
    mockInflation = await InflationMock.new();
    endlessLoop = await EndlessLoopMock.new(false, false);
  });

  describe("register", async() => {
    it("Should register a contract to daemonize", async() => {
      // Assemble
      const registrations = [{daemonizedContract: mockContractToDaemonize.address, gasLimit: 0}];
      // Act
      const tx = await flareDaemon.registerToDaemonize(registrations, {from: GOVERNANCE_GENESIS_ADDRESS});
      // Assert
      const {0: daemonizedContracts} = await flareDaemon.getDaemonizedContractsData();
      assert.equal(daemonizedContracts[0], mockContractToDaemonize.address);
      expectEvent(tx, REGISTRATIONUPDATED_EVENT, {theContract: mockContractToDaemonize.address, add: true});
    });

    it("Should test deamonized contracts getter", async() => {
      // Assemble
      const registrations = [{daemonizedContract: mockContractToDaemonize.address, gasLimit: 1111}];
      
      // Act
      const tx = await flareDaemon.registerToDaemonize(registrations, {from: GOVERNANCE_GENESIS_ADDRESS});
      // Assert
      const {0: daemonizedContracts, 1: gasLimits, 2: holdoffRemaining} = await flareDaemon.getDaemonizedContractsData();
      assert.equal(daemonizedContracts[0], mockContractToDaemonize.address);
      assert.equal(gasLimits[0].toString(), "1111");
      assert.equal(holdoffRemaining[0].toString(), "0");
    });

    it("Should reject contract registration if not from governance", async() => {
      // Assemble
      const registrations = [{daemonizedContract: mockContractToDaemonize.address, gasLimit: 0}];
      // Act
      const registerPromise = flareDaemon.registerToDaemonize(registrations, {from: accounts[2]});
      // Assert
      await expectRevert(registerPromise, ONLY_GOVERNANCE_MSG);
    });

    it("Should not register a dup contract", async() => {
      // Assemble
      const registrations = [
        {daemonizedContract: mockContractToDaemonize.address, gasLimit: 0},
        {daemonizedContract: mockContractToDaemonize.address, gasLimit: 0}
      ];
      // Act
      const promise = flareDaemon.registerToDaemonize(registrations, {from: GOVERNANCE_GENESIS_ADDRESS});
      // Assert
      await expectRevert(promise, ERR_DUPLICATE_ADDRESS);
    });

    it("Should not register more contracts than allowed", async() => {
      // Assemble
      const MAX = 10;
      const registrations = [];
      for (let i = 0; i <= MAX; i++ ) {
        const registration = {daemonizedContract: (await MockContract.new()).address, gasLimit: 0};
        registrations.push(registration);
      }
      // Act
      const registerPromise = flareDaemon.registerToDaemonize(registrations, {from: GOVERNANCE_GENESIS_ADDRESS});
      // Assert
      await expectRevert(registerPromise, TOO_MANY_CONTRACTS_MSG);
    });
  });

  describe("unregister", async() => {
      it("Should unregister a daemonized contract", async() => {
        // Assemble
        const registrations = [{daemonizedContract: mockContractToDaemonize.address, gasLimit: 0}];
        await flareDaemon.registerToDaemonize(registrations, {from: GOVERNANCE_GENESIS_ADDRESS});
        // Act
        const tx = await flareDaemon.unregisterAll({from: GOVERNANCE_GENESIS_ADDRESS});
        // Assert
        expectEvent(tx, REGISTRATIONUPDATED_EVENT, {theContract: mockContractToDaemonize.address, add: false});
      
        const {0: daemonizedContracts} = await flareDaemon.getDaemonizedContractsData();
        assert.equal(daemonizedContracts.length, 0);
      });

      it("Should reject contract unregistration if not from governed", async() => {
        // Assemble
        // Act
        const unregisterPromise = flareDaemon.unregisterAll({from: accounts[2]});
        // Assert
        await expectRevert(unregisterPromise, ONLY_GOVERNANCE_MSG);
      });

      it("Should register all", async() => {
        // Assemble
        const MAX = 10;
        const registrations = [];
        for (let i = 0; i < MAX; i++ ) {
          const registration = {daemonizedContract: (await MockContract.new()).address, gasLimit: 0};
          registrations.push(registration);
        }
        await flareDaemon.registerToDaemonize(registrations, {from: GOVERNANCE_GENESIS_ADDRESS});
        const {0: daemonizedContracts} = await flareDaemon.getDaemonizedContractsData();

        assert.equal(daemonizedContracts.length, 10);
        // Act
        await flareDaemon.unregisterAll({from: GOVERNANCE_GENESIS_ADDRESS});
        // Assert
        const {0: daemonizedContracts2} = await flareDaemon.getDaemonizedContractsData();
        assert.equal(daemonizedContracts2.length, 0);
      });  
  });

  describe("daemonize", async() => {
    it("Should daemonize a contract", async() => {
      // Assemble
      // Shim up mock
      await mockContractToDaemonize.givenMethodReturnBool(daemonize, true);
      // Register mock
      const registrations = [{daemonizedContract: mockContractToDaemonize.address, gasLimit: 0}];
      await flareDaemon.registerToDaemonize(registrations, {from: GOVERNANCE_GENESIS_ADDRESS});
      await flareDaemon.setInflation(mockInflation.address, {from: GOVERNANCE_GENESIS_ADDRESS});
      // Act
      await flareDaemon.trigger();
      // Assert
      const invocationCount = await mockContractToDaemonize.invocationCountForMethod.call(daemonize);
      assert.equal(invocationCount.toNumber(), 1);
    });

    it("Should advance last triggered block", async() => {
      // Assemble
      const oldLastTriggeredBlock = await flareDaemon.systemLastTriggeredAt();
      await flareDaemon.setInflation(mockInflation.address, {from: GOVERNANCE_GENESIS_ADDRESS});
      // Act
      await flareDaemon.trigger();
      // Assert
      const currentBlock = await web3.eth.getBlockNumber();            
      const lastTriggeredBlock = await flareDaemon.systemLastTriggeredAt();
      assert(lastTriggeredBlock.toNumber() > oldLastTriggeredBlock.toNumber());
      assert.equal(lastTriggeredBlock.toNumber(), currentBlock);
    });

    it.skip("Should revert if trigger called more than once from same block", async() => {
        // TODO: Test reject if trigger called more than once for same block; HH advances the block for every call.
        // Not sure how to do this in an automated manner.
        // 2.1.0 Version of Hardhat supports interval mining
        // https://github.com/nomiclabs/hardhat/releases/tag/hardhat-core-v2.1.0
    });

    it("Should return amount to mint when triggered with a pending mint request", async() => {
      // Assemble
      await flareDaemon.setInflation(accounts[0], {from: GOVERNANCE_GENESIS_ADDRESS});
      await flareDaemon.requestMinting(BN(100), { from: accounts[0] });
      // Act
      const toMint = await flareDaemon.trigger.call();
      // Assert
      assert.equal(toMint.toNumber(), 100);
    });

    it("Should emit event when triggered with a pending mint request", async() => {
      // Assemble
      await flareDaemon.setInflation(accounts[0], {from: GOVERNANCE_GENESIS_ADDRESS});
      // Act
      const txReq = await flareDaemon.requestMinting(BN(100), { from: accounts[0] });
      const txTrigger = await flareDaemon.trigger();
      // Assert
      expectEvent(txReq, MINTINGREQUESTRECEIVED_EVENT, {amountWei: BN(100)});
      expectEvent(txTrigger, MINTINGREQUESTTRIGGERED_EVENT, { amountWei: BN(100) });
    });

    it("Should log error if inflation not set", async() => {
      // Assemble
      // Act
      const tx = await flareDaemon.trigger();
      // Assert
      const { 2: errorStringArr} = await flareDaemon.showLastDaemonizedError();
      assert.equal(errorStringArr[0], INFLATION_ZERO_MSG);
    });

    it("Should advance daemonize error counter if daemonized contract reverts", async() => {
      // Assemble
      await mockContractToDaemonize.givenMethodRevertWithMessage(daemonize, "I am broken");
      await flareDaemon.setInflation(mockInflation.address, {from: GOVERNANCE_GENESIS_ADDRESS});
      const registrations = [{daemonizedContract: mockContractToDaemonize.address, gasLimit: 0}];
      await flareDaemon.registerToDaemonize(registrations, {from: GOVERNANCE_GENESIS_ADDRESS});

      // Act
      await flareDaemon.trigger();

      // Assert
      const {0: numDaemonizedErrors} = await flareDaemon.errorData();
      assert.equal(numDaemonizedErrors.toNumber(), 1);

      // Act
      await flareDaemon.trigger();

      // Assert
      const {0: numDaemonizedErrors2} = await flareDaemon.errorData();
      assert.equal(numDaemonizedErrors2.toNumber(), 2);
    });

    it("Should create new entry for new error type, correct contract address, not create new entry for repeating error type", async() => {
      // Assemble
      await mockContractToDaemonize.givenMethodRevertWithMessage(daemonize, "I am broken");
      await flareDaemon.setInflation(mockInflation.address, {from: GOVERNANCE_GENESIS_ADDRESS});
      const registrations = [{daemonizedContract: mockContractToDaemonize.address, gasLimit: 0}];
      await flareDaemon.registerToDaemonize(registrations, {from: GOVERNANCE_GENESIS_ADDRESS});

      // Act
      await flareDaemon.trigger();

      // Assert
      const { 3: erroringContractArr } = await flareDaemon.showDaemonizedErrors(0, 10);
      assert.equal(erroringContractArr.length, 1);
      assert.equal(mockContractToDaemonize.address, erroringContractArr[0]);

      // Act2
      await flareDaemon.trigger();

      // Assert2 - see same lenght for error types
      const { 3: erroringContractArr2 } = await flareDaemon.showDaemonizedErrors(0, 10);
      assert.equal(erroringContractArr2.length, 1);
    });

    it("Should create new entry for new error type, correct string and correct error numbers", async() => {
      // Assemble
      await mockContractToDaemonize.givenMethodRevertWithMessage(daemonize, "I am broken");
      await flareDaemon.setInflation(mockInflation.address, {from: GOVERNANCE_GENESIS_ADDRESS});
      const registrations = [{daemonizedContract: mockContractToDaemonize.address, gasLimit: 0}];
      await flareDaemon.registerToDaemonize(registrations, {from: GOVERNANCE_GENESIS_ADDRESS});

      // Act
      let tx = await flareDaemon.trigger();
      const { 
        0: lastErrorBlockArr,
        1: numErrorsArr,
        2: errorStringArr
        } = await flareDaemon.showDaemonizedErrors(0, 10);

      // Assert
      assert.equal(lastErrorBlockArr[0].toNumber(), tx.logs[0].blockNumber);
      assert.equal(numErrorsArr[0].toNumber(), 1);
      assert.equal(errorStringArr[0], "I am broken");

      // Act
      tx = await flareDaemon.trigger();
      const { 
        0: lastErrorBlockArr2,
        1: numErrorsArr2,
        2: errorStringArr2
      } = await flareDaemon.showDaemonizedErrors(0, 10);

      // Assert
      assert.equal(lastErrorBlockArr2[0].toNumber(), tx.logs[0].blockNumber);
      assert.equal(numErrorsArr2[0].toNumber(), 2);
      assert.equal(errorStringArr2[0], "I am broken");
    });

    it("Should show last daemonized error data", async() => {
      // Assemble
      await mockContractToDaemonize.givenMethodRevertWithMessage(daemonize, "I am broken");
      await flareDaemon.setInflation(mockInflation.address, {from: GOVERNANCE_GENESIS_ADDRESS});
      const registrations = [{daemonizedContract: mockContractToDaemonize.address, gasLimit: 0}];
      await flareDaemon.registerToDaemonize(registrations, {from: GOVERNANCE_GENESIS_ADDRESS});

      // Act
      let tx = await flareDaemon.trigger();
      const { 
        0: lastErrorBlockArr,
        1: numErrorsArr,
        2: errorStringArr,
        3: errorContractArr,
        4: totalDaemonizedErrors
        } = await flareDaemon.showLastDaemonizedError();

      // Assert
      assert.equal(lastErrorBlockArr[0].toNumber(), tx.logs[0].blockNumber);
      assert.equal(numErrorsArr[0].toNumber(), 1);
      assert.equal(errorStringArr[0], "I am broken");
      assert.equal(errorContractArr[0], mockContractToDaemonize.address);
      assert.equal(totalDaemonizedErrors.toNumber(), 1);

      // Act
      tx = await flareDaemon.trigger();
      const { 
        0: lastErrorBlockArr2,
        1: numErrorsArr2,
        2: errorStringArr2,
        3: errorContractArr2,
        4: totalDaemonizedErrors2
      } = await flareDaemon.showLastDaemonizedError();

      // Assert
      assert.equal(lastErrorBlockArr2[0].toNumber(), tx.logs[0].blockNumber);
      assert.equal(numErrorsArr2[0].toNumber(), 2);
      assert.equal(errorStringArr2[0], "I am broken");
      assert.equal(errorContractArr2[0], mockContractToDaemonize.address);
      assert.equal(totalDaemonizedErrors2.toNumber(), 2);
    });

    it("Should shorten error to 64 chars to make gas usage predictable", async () => {
      // Assemble
      await mockContractToDaemonize.givenMethodRevertWithMessage(daemonize, "This is a very long error message that should be shortened to fit into 64 character limit");
      await flareDaemon.setInflation(mockInflation.address, { from: GOVERNANCE_GENESIS_ADDRESS });
      const registrations = [{ daemonizedContract: mockContractToDaemonize.address, gasLimit: 0 }];
      await flareDaemon.registerToDaemonize(registrations, { from: GOVERNANCE_GENESIS_ADDRESS });

      // Act
      let tx = await flareDaemon.trigger();
      const { 2: errorStringArr } = await flareDaemon.showLastDaemonizedError();

      // Assert
      assert.equal(errorStringArr[0], "This is a very long error message that should be shortened to fi");
    });

    it("Should show last daemonized error data for two strings", async() => {
      // Assemble
      const mockDaemonizedContract = await MockContract.new();
      const mockDaemonizedContract2 = await MockContract.new();
      await mockDaemonizedContract.givenMethodRevertWithMessage(daemonize, "I am broken");
      await mockDaemonizedContract2.givenMethodRevertWithMessage(daemonize, "Me tooooo");
      await flareDaemon.setInflation(mockInflation.address, {from: GOVERNANCE_GENESIS_ADDRESS});
      const registrations = [
        {daemonizedContract: mockDaemonizedContract.address, gasLimit: 0},
        {daemonizedContract: mockDaemonizedContract2.address, gasLimit: 0}
      ];
      await flareDaemon.registerToDaemonize(registrations, {from: GOVERNANCE_GENESIS_ADDRESS});

      // Act
      let tx = await flareDaemon.trigger();
      const { 
        0: lastErrorBlockArr,
        1: numErrorsArr,
        2: errorStringArr,
        3: errorContractArr,
        4: totalDaemonizedErrors
        } = await flareDaemon.showDaemonizedErrors(0, 2);

      // Assert
      assert.equal(lastErrorBlockArr[0].toNumber(), tx.logs[0].blockNumber);
      assert.equal(numErrorsArr[0].toNumber(), 1);
      assert.equal(errorStringArr[0], "I am broken");
      assert.equal(errorStringArr[1], "Me tooooo");
      assert.equal(errorContractArr[0], mockDaemonizedContract.address);
      assert.equal(errorContractArr[1], mockDaemonizedContract2.address);
      assert.equal(totalDaemonizedErrors.toNumber(), 2);
    });
  });

  describe("governance", async() => {
    it("Should transfer governance", async() => {
      // Assemble
      await flareDaemon.proposeGovernance(accounts[1], {from: GOVERNANCE_GENESIS_ADDRESS});
      await flareDaemon.claimGovernance({from: accounts[1]});
      // Act
      let newGovernance = await flareDaemon.governance();
      // Assert
      assert.equal(newGovernance, accounts[1]);
    })

    it("Real FlareDaemon should revert if trigger isn't called by the system", async () => {
      // Assemble
      const realFlareDaemon = await RealFlareDaemon.new();
      await realFlareDaemon.initialiseFixedAddress();
      // Act
      // Assert
      await expectRevert(realFlareDaemon.trigger(), "a");
    })
  });

  describe("minting", async() => {
    it("Should set inflation", async() => {
      // Assemble
      // Act
      const receipt = await flareDaemon.setInflation(mockInflation.address, {from: GOVERNANCE_GENESIS_ADDRESS});
      // Assert
      assert.equal(await flareDaemon.inflation(), mockInflation.address);
      expectEvent(receipt, INFLATIONSET_EVENT, {
        theNewContract: mockInflation.address,
        theOldContract: constants.ZERO_ADDRESS}
      );
    });

    it("Should not set inflation if not from governance", async() => {
      // Assemble
      // Act
      // const promise = flareDaemon.setInflation(mockInflation.address, {from: accounts[0]});
      // // Assert
      // await expectRevert(promise, "only governance");
      await expectRevert(
        flareDaemon.setInflation(mockInflation.address, {from: accounts[0]}),
        "only governance"
      )
    });

    it("Should request and transfer minted amount to inflation", async() => {
      // Assemble
      await flareDaemon.setInflation(mockInflation.address, {from: GOVERNANCE_GENESIS_ADDRESS});
      await mockInflation.setFlareDaemon(flareDaemon.address);
      await mockInflation.setDoNotReceiveNoMoreThan(1000);
      await mockInflation.requestMinting(BN(100));
      // Pretend we are teeing validator with amount to mint
      await flareDaemon.trigger();
      // Our fakey validator will be suiciding the right amount of native token into flareDaemon
      const suicidalMock = await SuicidalMock.new(flareDaemon.address);
      // Give suicidal some native token
      await web3.eth.sendTransaction({from: accounts[0], to: suicidalMock.address, value: 100});
      // Suicidal validator mints
      await suicidalMock.die();
      // Act
      let receipt = await flareDaemon.trigger();
      // Assert
      expectEvent(receipt, MINTINGRECEIVED_EVENT, {amountWei: "100"});
      expectEvent(receipt, MINTINGWITHDRAWN_EVENT, {amountWei: "100"});
      const inflationBalance = BN(await web3.eth.getBalance(mockInflation.address));
      assert.equal(inflationBalance.toNumber(), 100);
    })

    it("Should post received native token to self-destruct bucket if minting not expected", async() => {
      // Assemble
      await flareDaemon.setInflation(mockInflation.address, {from: GOVERNANCE_GENESIS_ADDRESS});
      await mockInflation.setFlareDaemon(flareDaemon.address);
      // Request more that we are going to receive
      await mockInflation.requestMinting(110);
      // Our subversive attacker will be suiciding some native token into flareDaemon
      const suicidalMock = await SuicidalMock.new(flareDaemon.address);
      // Give suicidal some native token
      await web3.eth.sendTransaction({from: accounts[0], to: suicidalMock.address, value: 100});
      // Attacker dies
      await suicidalMock.die();
      // Act
      let receipt = await flareDaemon.trigger();
      // Assert
      expectEvent(receipt, SELFDESTRUCTRECEIVED_EVENT, {amountWei: "100"});
      const receivedSelfDestructProceeds = await flareDaemon.totalSelfDestructReceivedWei();
      assert(receivedSelfDestructProceeds.eq(BN(100)));
      const daemonBalance = BN(await web3.eth.getBalance(flareDaemon.address));
      assert(daemonBalance.eq(BN(100)));
    });

    it("Should receive scheduled minting and any received self-destructed balance", async() => {
      // Assemble
      await flareDaemon.setInflation(mockInflation.address, {from: GOVERNANCE_GENESIS_ADDRESS});
      await mockInflation.setFlareDaemon(flareDaemon.address);
      await mockInflation.setDoNotReceiveNoMoreThan(1000);
      await mockInflation.requestMinting(BN(100));
      // Pretend we are teeing validator with amount to mint
      await flareDaemon.trigger();
      // Our fakey validator will be suiciding the right amount of native token into flareDaemon
      const suicidalMock = await SuicidalMock.new(flareDaemon.address);
      // Give suicidal some native token
      await web3.eth.sendTransaction({from: accounts[0], to: suicidalMock.address, value: 110});
      // Suicidal validator mints and we pretend that another attacker attacks in same block
      await suicidalMock.die();
      // Act
      await flareDaemon.trigger();
      // Assert
      // Target got expected balance
      const inflationBalance = BN(await web3.eth.getBalance(mockInflation.address));
      assert(inflationBalance.eq(BN(100)), "rewarding target did not get expected balance");
      // Daemon recorded self-destruct balance
      const receivedSelfDestructProceeds = await flareDaemon.totalSelfDestructReceivedWei();
      assert(receivedSelfDestructProceeds.eq(BN(10)), "expected self destruct balance incorrect");
      // Daemon still has remaining balance
      const daemonBalance = BN(await web3.eth.getBalance(flareDaemon.address));
      assert(daemonBalance.eq(BN(10)), "daemon does not contain expected balance");
    });

    // Working version
    it("Should self destruct when minting more than available", async () => {
      // Assemble
      await flareDaemon.setInflation(mockInflation.address, {from: GOVERNANCE_GENESIS_ADDRESS});
      await mockInflation.setFlareDaemon(flareDaemon.address);
      await mockInflation.requestMinting(BN(100));

      await flareDaemon.trigger();
      // Our fakey validator will be suiciding with less than expected to mint
      const suicidalMock = await SuicidalMock.new(flareDaemon.address);
      // Give suicidal some native token
      await web3.eth.sendTransaction({from: accounts[0], to: suicidalMock.address, value: 90});
      // Suicidal validator mints and we pretend that another attacker attacks in same block
      await suicidalMock.die();
      // Act
      await flareDaemon.trigger();
      // Assert
      // Nothing was minted
      const inflationBalance = BN(await web3.eth.getBalance(mockInflation.address));
      assert(inflationBalance.eq(BN(0)), "rewarding target did not get expected balance");
      // Daemon recorded self-destruct balance
      const receivedSelfDestructProceeds = await flareDaemon.totalSelfDestructReceivedWei();
      assert(receivedSelfDestructProceeds.eq(BN(90)), "expected self destruct balance incorrect");
      // Daemon still has remaining balance
      const daemonBalance = BN(await web3.eth.getBalance(flareDaemon.address));
      assert(daemonBalance.eq(BN(90)), "daemon does not contain expected balance");
      
    });

    it("Should log error if transfer of requested minting fails", async() => {
      // Assemble
      await flareDaemon.setInflation(mockInflation.address, {from: GOVERNANCE_GENESIS_ADDRESS});
      await mockInflation.setFlareDaemon(flareDaemon.address);
      await mockInflation.setDoNotReceiveNoMoreThan(BN(90));
      await mockInflation.requestMinting(BN(100));
      // Pretend we are teeing validator with amount to mint
      await flareDaemon.trigger();
      // Our fakey validator will be suiciding the right amount of native token into flareDaemon
      const suicidalMock = await SuicidalMock.new(flareDaemon.address);
      // Give suicidal some native token
      await web3.eth.sendTransaction({from: accounts[0], to: suicidalMock.address, value: 100});
      // Suicidal validator mints
      await suicidalMock.die();
      // Act
      await flareDaemon.trigger();
      // Assert
      const { 2: errorStringArr} = await flareDaemon.showLastDaemonizedError();
      assert.equal(errorStringArr[0], "too much");
    });

    it("Should log error if transfer of requested minting fails when additional self-destruct received", async() => {
      // Assemble
      await flareDaemon.setInflation(mockInflation.address, {from: GOVERNANCE_GENESIS_ADDRESS});
      await mockInflation.setFlareDaemon(flareDaemon.address);
      await mockInflation.setDoNotReceiveNoMoreThan(90);
      await mockInflation.requestMinting(BN(100));
      // Pretend we are teeing validator with amount to mint
      await flareDaemon.trigger();
      // Our fakey validator will be suiciding the right amount of native token into flareDaemon
      const suicidalMock = await SuicidalMock.new(flareDaemon.address);
      // Give suicidal some native token
      await web3.eth.sendTransaction({from: accounts[0], to: suicidalMock.address, value: 110});
      // Suicidal validator mints and we pretend that another attacker attacks in same block
      await suicidalMock.die();
      // Act
      await flareDaemon.trigger();
      // Assert
      const { 2: errorStringArr} = await flareDaemon.showLastDaemonizedError();
      assert.equal(errorStringArr[0], "too much");
    });

    it("Should not allow mint request before timelock expires", async() => {
      // Assemble
      await flareDaemon.setInflation(mockInflation.address, {from: GOVERNANCE_GENESIS_ADDRESS});
      await mockInflation.setFlareDaemon(flareDaemon.address);
      await mockInflation.requestMinting(BN(100));
      // Act
      const requestPromise = mockInflation.requestMinting(BN(100));
      // Assert
      await expectRevert.unspecified(requestPromise); // unspecified because it is raised within mock call
    });

    it("Should allow mint request exactly after timelock expires", async() => {
      // This test currently waits 23h on a real network so run it with caution
      // Assemble
      await flareDaemon.setInflation(mockInflation.address, {from: GOVERNANCE_GENESIS_ADDRESS});
      await mockInflation.setFlareDaemon(flareDaemon.address);
      // Advance block to ensure that daemon has current time
      await time.advanceBlock();
      await mockInflation.requestMinting(BN(100));

      // Do time shift
      // Advance just enough
      await time.increase(MAX_MINTING_FREQUENCY_SEC);

      // request minting as promise
      const requestPromise = mockInflation.requestMinting(BN(100));
      // Assert
      // Forced promise should not fail
      await requestPromise;
    });

    it("Should have cap on excessive minting", async() => {
      // Assemble
      await flareDaemon.setInflation(mockInflation.address, {from: GOVERNANCE_GENESIS_ADDRESS});
      await mockInflation.setFlareDaemon(flareDaemon.address);
      // Act
      const requestPromise = mockInflation.requestMinting(web3.utils.toWei(BN(100000000)));
      // Assert
      await expectRevert.unspecified(requestPromise); // unspecified because it is raised within mock call
    });

    it("Should make sure setMaxMintRequest changes are time locked", async() => {
      // Assemble
      await flareDaemon.setInflation(mockInflation.address, {from: GOVERNANCE_GENESIS_ADDRESS});
      await mockInflation.setFlareDaemon(flareDaemon.address);

      // first request should succeed.
      // correct amount success
      await flareDaemon.setMaxMintingRequest(BN(1000), { from: GOVERNANCE_GENESIS_ADDRESS });

      await expectRevert(flareDaemon.setMaxMintingRequest(BN(1000), 
        { from: GOVERNANCE_GENESIS_ADDRESS }),
        "time gap too short");
    });

    it("Should make sure setMaxMintRequest changes are not too large", async() => {
      // Assemble
      await flareDaemon.setInflation(mockInflation.address, {from: GOVERNANCE_GENESIS_ADDRESS});
      await mockInflation.setFlareDaemon(flareDaemon.address);

      // the request should fail as we can only increase the maximum by 10%
      await expectRevert(flareDaemon.setMaxMintingRequest(web3.utils.toWei(BN(60000000)),
        { from: GOVERNANCE_GENESIS_ADDRESS }),
        "max mint too high");
    });

    it("Should make sure setMaxMintRequest changes just below allowed maximum go through", async() => {
      // Assemble
      await flareDaemon.setInflation(mockInflation.address, {from: GOVERNANCE_GENESIS_ADDRESS});
      await mockInflation.setFlareDaemon(flareDaemon.address);

      await flareDaemon.setMaxMintingRequest(web3.utils.toWei(BN(55000000)), { from: GOVERNANCE_GENESIS_ADDRESS });
    });

    it("Should make sure setMaxMintRequest changes are not too large", async() => {
      // Assemble
      await flareDaemon.setInflation(mockInflation.address, {from: GOVERNANCE_GENESIS_ADDRESS});
      await mockInflation.setFlareDaemon(flareDaemon.address);

      // the request should fail as we can only increase the maximum by 10%
      await expectRevert(flareDaemon.setMaxMintingRequest(web3.utils.toWei(BN(55000001)),
        { from: GOVERNANCE_GENESIS_ADDRESS }),
        "max mint too high");
    });

    it("Should make sure setMaxMintRequest cannot be set to zero", async() => {
      // Assemble
      await flareDaemon.setInflation(mockInflation.address, {from: GOVERNANCE_GENESIS_ADDRESS});
      await mockInflation.setFlareDaemon(flareDaemon.address);

      // the request should fail as we cannot set the maximum to 0
      await expectRevert(flareDaemon.setMaxMintingRequest(BN(0),
        { from: GOVERNANCE_GENESIS_ADDRESS }),
        "max mint is zero");
    });
  });

  describe("gas limit", async() => {
    it("Should set gas limit", async() => {
      // Assemble
      const registrations = [{daemonizedContract: endlessLoop.address, gasLimit: 1000000}];
      // Act
      await flareDaemon.registerToDaemonize(registrations, {from: GOVERNANCE_GENESIS_ADDRESS});
      // Assert
      const {0: daemonizedContracts, 1: gasLimits} = await flareDaemon.getDaemonizedContractsData();
      assert.equal(daemonizedContracts[0], endlessLoop.address);
      assert.equal(gasLimits[0].toString(), "1000000");
    });

    it("Should not exceed gas limit of runaway contract", async() => {
      const registrations = [{daemonizedContract: endlessLoop.address, gasLimit: 1000000}];
      await flareDaemon.registerToDaemonize(registrations, {from: GOVERNANCE_GENESIS_ADDRESS});
      await flareDaemon.setInflation(mockInflation.address, {from: GOVERNANCE_GENESIS_ADDRESS});
      // Act
      await flareDaemon.trigger();
      // Assert
      const { 
        2: errorStringArr,
        3: erroringContractArr } = await flareDaemon.showDaemonizedErrors(0, 10);
      assert.equal(endlessLoop.address, erroringContractArr[0]);
      assert.equal(errorStringArr[0], ERR_OUT_OF_GAS);
    });

    it("Should execute 2nd contract when 1st contract exceeds gas limit", async() => {
      // Assemble
      await mockContractToDaemonize.givenMethodReturnBool(daemonize, true);
      const registrations = [
        {daemonizedContract: endlessLoop.address, gasLimit: 1000000},
        {daemonizedContract: mockContractToDaemonize.address, gasLimit: 0}
      ];
      await flareDaemon.registerToDaemonize(registrations, {from: GOVERNANCE_GENESIS_ADDRESS});
      await flareDaemon.setInflation(mockInflation.address, {from: GOVERNANCE_GENESIS_ADDRESS});
      // Act
      await flareDaemon.trigger();
      // Assert
      const invocationCount = await mockContractToDaemonize.invocationCountForMethod.call(daemonize);
      assert.equal(invocationCount.toNumber(), 1);
    });

    it("Should skip 2nd contract when 1st burns too much gas without limit", async () => {
      // Assemble
      await mockContractToDaemonize.givenMethodReturnBool(daemonize, true);
      const registrations = [
        { daemonizedContract: endlessLoop.address, gasLimit: 0 },
        { daemonizedContract: mockContractToDaemonize.address, gasLimit: 0 }
      ];
      await flareDaemon.registerToDaemonize(registrations, { from: GOVERNANCE_GENESIS_ADDRESS });
      await flareDaemon.setInflation(mockInflation.address, { from: GOVERNANCE_GENESIS_ADDRESS });
      // Act
      const receipt = await flareDaemon.trigger({ gas: 1_000_000 });
      // Assert
      const invocationCount = await mockContractToDaemonize.invocationCountForMethod.call(daemonize);
      assert.equal(invocationCount.toNumber(), 0);
      expectEvent(receipt, "ContractsSkippedOutOfGas", { numberOfSkippedConstracts: toBN(1) });
    });
  });

  describe("holdoff", async() => {
    it("Should set block holdoff on contract when gas limit exceeded", async() => {
      const registrations = [
        {daemonizedContract: endlessLoop.address, gasLimit: 1000000}
      ];
      await flareDaemon.registerToDaemonize(registrations, {from: GOVERNANCE_GENESIS_ADDRESS});
      await flareDaemon.setInflation(mockInflation.address, {from: GOVERNANCE_GENESIS_ADDRESS});
      // Act
      await flareDaemon.trigger();
      // Assert
      const {0: daemonizedContracts, 1: gasLimits, 2: holdoffRemaining} = await flareDaemon.getDaemonizedContractsData();
      assert.equal(daemonizedContracts[0], endlessLoop.address);
      assert.equal(gasLimits[0].toString(), "1000000");

      const holdoff = await flareDaemon.blockHoldoff();
      assert.equal(holdoffRemaining[0].toString(), holdoff.toString());
    });

    it("Should execute 2nd contract twice when 1st contract heldoff", async() => {
      // Assemble
      await mockContractToDaemonize.givenMethodReturnBool(daemonize, true);
      const registrations = [
        {daemonizedContract: endlessLoop.address, gasLimit: 1000000},
        {daemonizedContract: mockContractToDaemonize.address, gasLimit: 0}
      ];
      await flareDaemon.registerToDaemonize(registrations, {from: GOVERNANCE_GENESIS_ADDRESS});
      await flareDaemon.setInflation(mockInflation.address, {from: GOVERNANCE_GENESIS_ADDRESS});
      await flareDaemon.setBlockHoldoff(10, {from: GOVERNANCE_GENESIS_ADDRESS});
      // Act
      await flareDaemon.trigger();
      const receipt = await flareDaemon.trigger();
      // Assert
      const invocationCount = await mockContractToDaemonize.invocationCountForMethod.call(daemonize);
      assert.equal(invocationCount.toNumber(), 2);
      expectEvent(receipt, CONTRACTHELDOFF_EVENT);
    });

    it("Should execute endless loop contract again after being heldoff", async() => {
      // Assemble
      await mockContractToDaemonize.givenMethodReturnBool(daemonize, true);
      const registrations = [
        {daemonizedContract: endlessLoop.address, gasLimit: 1000000},
        {daemonizedContract: mockContractToDaemonize.address, gasLimit: 0}
      ];
      await flareDaemon.registerToDaemonize(registrations, {from: GOVERNANCE_GENESIS_ADDRESS});
      await flareDaemon.setInflation(mockInflation.address, {from: GOVERNANCE_GENESIS_ADDRESS});
      await flareDaemon.setBlockHoldoff(1, {from: GOVERNANCE_GENESIS_ADDRESS});
      // Act
      await flareDaemon.trigger();
      await flareDaemon.trigger();  // Holdoff
      const receipt = await flareDaemon.trigger();
      // Assert
      expectEvent(receipt, CONTRACTDAEMONIZEERRORED_EVENT, {theContract: endlessLoop.address});
      expectEvent(receipt, CONTRACTDAEMONIZED_EVENT, {theContract: mockContractToDaemonize.address});
    });

    it("Should fallback instead of holdoff if possible", async () => {
      // Assemble
      const fallbackEndlessLoop = await EndlessLoopMock.new(true, false); // endless loop with fallback mode support
      await mockContractToDaemonize.givenMethodReturnBool(daemonize, true);
      const registrations = [
        { daemonizedContract: fallbackEndlessLoop.address, gasLimit: 1000000 },
        { daemonizedContract: mockContractToDaemonize.address, gasLimit: 0 }
      ];
      await flareDaemon.registerToDaemonize(registrations, { from: GOVERNANCE_GENESIS_ADDRESS });
      await flareDaemon.setInflation(mockInflation.address, { from: GOVERNANCE_GENESIS_ADDRESS });
      await flareDaemon.setBlockHoldoff(5, { from: GOVERNANCE_GENESIS_ADDRESS });
      // Act
      const receipt1 = await flareDaemon.trigger(); // endlessLoop fails and goes to fallback
      const receipt2 = await flareDaemon.trigger(); // both succeed (endlessLoop in fallback mode)
      // Assert
      expectEvent(receipt1, CONTRACTDAEMONIZEERRORED_EVENT, { theContract: fallbackEndlessLoop.address });
      expectEvent(receipt1, CONTRACTDAEMONIZED_EVENT, { theContract: mockContractToDaemonize.address });
      await expectEvent.inTransaction(receipt1.tx, fallbackEndlessLoop, "FallbackMode", {});
      expectEvent(receipt2, CONTRACTDAEMONIZED_EVENT, { theContract: fallbackEndlessLoop.address });
      expectEvent(receipt2, CONTRACTDAEMONIZED_EVENT, { theContract: mockContractToDaemonize.address });
    });

    it("If fallback also fails (due to gas), it should holdoff afterwards", async () => {
      // Assemble
      const fallbackEndlessLoop = await EndlessLoopMock.new(true, true); // endless loop with wrong fallback mode, that also loops
      await mockContractToDaemonize.givenMethodReturnBool(daemonize, true);
      const registrations = [
        { daemonizedContract: fallbackEndlessLoop.address, gasLimit: 1000000 },
        { daemonizedContract: mockContractToDaemonize.address, gasLimit: 0 }
      ];
      await flareDaemon.registerToDaemonize(registrations, { from: GOVERNANCE_GENESIS_ADDRESS });
      await flareDaemon.setInflation(mockInflation.address, { from: GOVERNANCE_GENESIS_ADDRESS });
      await flareDaemon.setBlockHoldoff(5, { from: GOVERNANCE_GENESIS_ADDRESS });
      // Act
      const receipt1 = await flareDaemon.trigger(); // endlessLoop fails and goes to fallback
      const receipt2 = await flareDaemon.trigger(); // both succeed (endlessLoop in fallback mode)
      // Assert
      expectEvent(receipt1, CONTRACTDAEMONIZEERRORED_EVENT, { theContract: fallbackEndlessLoop.address });
      expectEvent(receipt1, CONTRACTDAEMONIZED_EVENT, { theContract: mockContractToDaemonize.address });
      await expectEvent.inTransaction(receipt1.tx, fallbackEndlessLoop, "FallbackMode", {});
      expectEvent(receipt2, CONTRACTDAEMONIZEERRORED_EVENT, { theContract: fallbackEndlessLoop.address });
      expectEvent(receipt2, CONTRACTDAEMONIZED_EVENT, { theContract: mockContractToDaemonize.address });
      const { 2: holdoffRemaining } = await flareDaemon.getDaemonizedContractsData();
      assert.equal(holdoffRemaining[0].toNumber(), 5);
    });

    it("Should set holdoff", async() => {
      // Assemble
      // Act
      const receipt = await flareDaemon.setBlockHoldoff(5, {from: GOVERNANCE_GENESIS_ADDRESS});
      // Assert
      const holdoff = await flareDaemon.blockHoldoff();
      assert.equal(holdoff.toString(), "5");
    });

    it("Should not set holdoff if not from governance", async() => {
      // Assemble
      // Act
      const receipt = flareDaemon.setBlockHoldoff(5);
      // Assert
      await expectRevert(receipt, ONLY_GOVERNANCE_MSG);
    });
  });
});
