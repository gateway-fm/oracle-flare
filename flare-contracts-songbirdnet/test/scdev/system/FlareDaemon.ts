import { FlareDaemonInstance, MockContractInstance, ReadGasLeftInstance, InfiniteLoopMockInstance, InfiniteLoopMock1Instance } from "../../../typechain-truffle";
import { expectRevert } from "@openzeppelin/test-helpers";
import { FLARE_DAEMON_ADDRESS } from "../../utils/constants";

const FlareDaemon = artifacts.require("FlareDaemon");
const MockContract = artifacts.require("MockContract");
const ReadGasLeft = artifacts.require("ReadGasLeft");
const InfiniteLoopMock = artifacts.require("InfiniteLoopMock");
const InfiniteLoopMock1 = artifacts.require("InfiniteLoopMock1");
const GasConsumer6 = artifacts.require("GasConsumer6");

const BN = web3.utils.toBN;
const getTestFile = require('../../utils/constants').getTestFile;
const GOVERNANCE_GENESIS_ADDRESS = require('../../utils/constants').GOVERNANCE_GENESIS_ADDRESS;
import { advanceBlock } from '../../utils/test-helpers';

/**
 * This test assumes a local chain is running with Flare allocated in accounts
 * listed in `./hardhat.config.ts`
 * It does not assume that contracts are deployed, other than the FlareDaemon, which should
 * already be loaded in the genesis block.
 */
contract(`FlareDaemon.sol; ${getTestFile(__filename)}; FlareDaemon system tests`, async accounts => {
  // Static address of the daemon on a local network
  let flareDaemon: FlareDaemonInstance;
  // contains a fresh contract for each test
  let contractToDaemonize: MockContractInstance;
  let inflationMock: MockContractInstance;
  let readGasLeft: ReadGasLeftInstance;
  let infiniteLoopMock: InfiniteLoopMockInstance;
  let infiniteLoopMock1: InfiniteLoopMock1Instance;


  before(async () => {
    // Defined in fba-avalanche/avalanchego/genesis/genesis_coston.go
    flareDaemon = await FlareDaemon.at(FLARE_DAEMON_ADDRESS);
    inflationMock = await MockContract.new();
    // Make sure daemon is initialized with a governance address...if may revert if already done.
    try {
      await flareDaemon.initialiseFixedAddress();
      let governanceAddress = await flareDaemon.governance();
      await flareDaemon.setInflation(inflationMock.address, { from: governanceAddress });
    } catch (e) {
      console.log("err");
      const governanceAddress = await flareDaemon.governance();
      if (GOVERNANCE_GENESIS_ADDRESS != governanceAddress) {
        throw e;
      }
      // keep going
    }
  });


  describe("daemonize", async () => {
    let daemonize: string;

    beforeEach(async () => {
      contractToDaemonize = await MockContract.new();
      daemonize = web3.utils.sha3("daemonize()")!.slice(0, 10); // first 4 bytes is function selector
      // Give our contract to keep a daemonize method so our poor validator's head does not explode...
      await contractToDaemonize.givenMethodReturnBool(daemonize, true);
      await flareDaemon.registerToDaemonize([{ daemonizedContract: contractToDaemonize.address, gasLimit: 0 }], { from: GOVERNANCE_GENESIS_ADDRESS });
    });

    it("Should daemonize a contract", async () => {
      // Assemble
      const startInvocationCount = await contractToDaemonize.invocationCountForMethod.call(daemonize);
      // Act
      // Wait for some blocks to mine...
      const blocks = 2;
      for (let i = 0; i < blocks; i++) {
        await new Promise(resolve => {
          setTimeout(resolve, 1000);
        });
        await advanceBlock();
      }
      // Assert
      const endInvocationCount = await contractToDaemonize.invocationCountForMethod.call(daemonize);
      assert(endInvocationCount.sub(startInvocationCount).eq(BN(blocks)));
    });

    it("Should validate limit from validator", async () => {
      readGasLeft = await ReadGasLeft.new();
      await flareDaemon.registerToDaemonize([{ daemonizedContract: readGasLeft.address, gasLimit: 0 }], { from: GOVERNANCE_GENESIS_ADDRESS });

      let gasConsumer = await GasConsumer6.new(1000);
      await gasConsumer.push(2);

      let left = await readGasLeft.gasLeft()
      console.log(left.toNumber());
      expect(left.toNumber()).to.be.above(60000000);
    });

    it("Should revert if user triggers function trigger", async() => {
      await expectRevert.unspecified(flareDaemon.trigger());
      await expectRevert.unspecified(flareDaemon.trigger({from: accounts[1]}));
    });

    it("Should run infinite loop once and revert", async () => {
      infiniteLoopMock = await InfiniteLoopMock.new();
      await flareDaemon.registerToDaemonize([{ daemonizedContract: infiniteLoopMock.address, gasLimit: 0 }], { from: GOVERNANCE_GENESIS_ADDRESS });

      let gasConsumer = await GasConsumer6.new(1000);
      // let block = await web3.eth.getBlockNumber();
      await gasConsumer.push(2);
      let block = (await infiniteLoopMock.savedBlock()).toNumber();
      let events = await flareDaemon.getPastEvents("ContractDaemonizeErrored", { fromBlock: block + 1, toBlock: block + 1 }); // run out of gas and revert
      for (let i = 0; i < 5; i++) {
        await gasConsumer.push(2);
      }
      assert(events.length === 1 && events[0].returnValues.theMessage == "unknown")
    });

    it("Should check if network is still responsive", async () => {
      infiniteLoopMock1 = await InfiniteLoopMock1.new();
      await flareDaemon.registerToDaemonize([{ daemonizedContract: infiniteLoopMock1.address, gasLimit: 0 }], { from: GOVERNANCE_GENESIS_ADDRESS });

      let gasConsumer = await GasConsumer6.new(1000);
     
      await infiniteLoopMock1.setGoInLoopParameter(false);
      let timeBefore = Date.now();
      for (let i = 0; i < 5; i++) {
        await gasConsumer.push(2);
      }
      let timeAfter = Date.now();
      let runTime = timeAfter - timeBefore;

      await infiniteLoopMock1.setGoInLoopParameter(true);
      let loopTimeBefore = Date.now();
      for (let i = 0; i < 5; i++) {
        await gasConsumer.push(2);
      }
      let loopTimeAfter = Date.now()
      let loopRunTime = loopTimeAfter - loopTimeBefore;

      console.log(runTime, loopRunTime);
      assert(loopRunTime > 1.5 * runTime && runTime < 20000);
    });

  });
});
