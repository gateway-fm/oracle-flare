import { VPContractInstance, VPTokenMockInstance } from "../../../../typechain-truffle";
import { assertNumberEqual, compareArrays, compareNumberArrays, toBN } from "../../../utils/test-helpers";
import { setDefaultVPContract } from "../../../utils/token-test-helpers";

// Unit tests for VPToken: checkpointable, delegatable, and ERC20 sanity tests
import { constants, expectRevert, time } from '@openzeppelin/test-helpers';
const getTestFile = require('../../../utils/constants').getTestFile;

const VPToken = artifacts.require("VPTokenMock");
const VPContract = artifacts.require("VPContract");


contract(`VPToken.sol; ${getTestFile(__filename)}; VPToken with replaced VPContract tests`, async accounts => {

    // contains a fresh contract for each test
    let vpToken: VPTokenMockInstance;
    let initBlk1: number, initBlk2: number, initBlk3: number;

    describe("Replace both read and write vpContracts at the same time", async () => {
        // Do clean unit tests by spinning up a fresh contract for each test
        beforeEach(async () => {
            vpToken = await VPToken.new(accounts[0], "A token", "ATOK");
            await setDefaultVPContract(vpToken, accounts[0]);

            // make some changes to vote power and delegation
            await vpToken.mint(accounts[1], 200);
            initBlk1 = await web3.eth.getBlockNumber();
            await vpToken.transfer(accounts[2], 100, { from: accounts[1] });
            initBlk2 = await web3.eth.getBlockNumber();
            await vpToken.delegate(accounts[2], 3000, { from: accounts[1] });
            await vpToken.delegate(accounts[3], 2000, { from: accounts[1] });
            await vpToken.delegateExplicit(accounts[3], 50, { from: accounts[2] });
            initBlk3 = await web3.eth.getBlockNumber();
            // current vote powers: [1]: 50, [2]: 80, [3]: 70
            // without delegation: [1]: 100, [2]: 100, [3]: 0

            // replace VPContract
            const vpContractRepl = await VPContract.new(vpToken.address, true);
            await vpToken.setWriteVpContract(vpContractRepl.address, { from: accounts[0] });
            await vpToken.setReadVpContract(vpContractRepl.address, { from: accounts[0] });
        });

        it("Should remember vote powers from balance, but not delegations", async () => {
            // Assemble
            // Act
            // Assert
            assertNumberEqual(await vpToken.totalVotePower(), 200);
            assertNumberEqual(await vpToken.votePowerOf(accounts[1]), 100);
            assertNumberEqual(await vpToken.votePowerOf(accounts[2]), 100);
            assertNumberEqual(await vpToken.votePowerOf(accounts[3]), 0);
            assertNumberEqual(await vpToken.votePowerOfAt(accounts[1], initBlk1), 200);
            assertNumberEqual(await vpToken.votePowerOfAt(accounts[2], initBlk1), 0);
            assertNumberEqual(await vpToken.votePowerFromTo(accounts[1], accounts[2]), 0);
            assertNumberEqual(await vpToken.votePowerFromTo(accounts[2], accounts[3]), 0);
            assertNumberEqual(await vpToken.votePowerFromToAt(accounts[1], accounts[2], initBlk3), 0);
            assertNumberEqual(await vpToken.votePowerFromToAt(accounts[2], accounts[3], initBlk3), 0);
        });

        it("Undelegated vote powers should show no delegations", async () => {
            // Assemble
            // Act
            // Assert
            assertNumberEqual(await vpToken.undelegatedVotePowerOf(accounts[1]), 100);
            assertNumberEqual(await vpToken.undelegatedVotePowerOf(accounts[2]), 100);
            assertNumberEqual(await vpToken.undelegatedVotePowerOf(accounts[3]), 0);
            assertNumberEqual(await vpToken.undelegatedVotePowerOfAt(accounts[1], initBlk1), 200);
            assertNumberEqual(await vpToken.undelegatedVotePowerOfAt(accounts[2], initBlk1), 0);
        });

        it("Cached vote power should work, too", async () => {
            // Assemble
            // Act
            await vpToken.totalVotePowerAtCached(initBlk2);
            await vpToken.votePowerOfAtCached(accounts[1], initBlk2);
            await vpToken.votePowerOfAtCached(accounts[3], initBlk2);
            // Assert
            assertNumberEqual(await vpToken.totalVotePowerAtCached.call(initBlk2), 200);
            assertNumberEqual(await vpToken.votePowerOfAtCached.call(accounts[1], initBlk2), 100);
            assertNumberEqual(await vpToken.votePowerOfAtCached.call(accounts[3], initBlk2), 0);
        });

        it("Batch vote power should work, too", async () => {
            // Assemble
            // Act
            const result = await vpToken.batchVotePowerOfAt([accounts[1], accounts[2], accounts[3]], initBlk2);
            // Assert
            compareNumberArrays(result, [100, 100, 0]);
        });

        it("Should delegate after replacement", async () => {
            // Assemble
            // Act
            await vpToken.delegate(accounts[2], 4000, { from: accounts[1] });
            await vpToken.delegate(accounts[3], 1000, { from: accounts[1] });
            // Assert
            assertNumberEqual(await vpToken.votePowerOf(accounts[1]), 50);
            assertNumberEqual(await vpToken.votePowerOf(accounts[2]), 140);
            assertNumberEqual(await vpToken.votePowerOf(accounts[3]), 10);
        });

        it("Errors for zero delegation should not come from _initializeVotePower", async () => {
            // Assert
            await expectRevert(vpToken.delegate(constants.ZERO_ADDRESS, 4000, { from: accounts[1] }),
                "Cannot delegate to zero");
        });
        
        it("Batch vote power should work after delegate", async () => {
            // Assemble
            // Act
            await vpToken.delegate(accounts[2], 4000, { from: accounts[1] });
            await vpToken.delegate(accounts[3], 4000, { from: accounts[1] });
            const blk1 = await web3.eth.getBlockNumber();
            await time.advanceBlock();
            const result = await vpToken.batchVotePowerOfAt([accounts[1], accounts[2], accounts[3]], blk1);
            // Assert
            compareNumberArrays(result, [20, 140, 40]);
        });

        it("Should delegate explicit after replacement", async () => {
            // Assemble
            // Act
            await vpToken.delegateExplicit(accounts[2], 40, { from: accounts[1] });
            await vpToken.delegateExplicit(accounts[3], 10, { from: accounts[1] });
            await vpToken.delegateExplicit(accounts[4], 10, { from: accounts[1] });
            // Assert
            assertNumberEqual(await vpToken.votePowerOf(accounts[1]), 40);
            assertNumberEqual(await vpToken.votePowerOf(accounts[2]), 140);
            assertNumberEqual(await vpToken.votePowerOf(accounts[3]), 10);
            assertNumberEqual(await vpToken.votePowerOf(accounts[4]), 10);
        });

        it("Should undelegateAll after replacement", async () => {
            // Assemble
            await vpToken.delegate(accounts[2], 4000, { from: accounts[1] });
            await vpToken.delegate(accounts[3], 1000, { from: accounts[1] });
            // Act
            await vpToken.undelegateAll({ from: accounts[1] });
            // Assert
            assertNumberEqual(await vpToken.votePowerOf(accounts[1]), 100);
            assertNumberEqual(await vpToken.votePowerOf(accounts[2]), 100);
            assertNumberEqual(await vpToken.votePowerOf(accounts[3]), 0);
        });

        it("Should undelegateAllExplicit after replacement", async () => {
            // Assemble
            await vpToken.delegateExplicit(accounts[2], 40, { from: accounts[1] });
            await vpToken.delegateExplicit(accounts[3], 10, { from: accounts[1] });
            await vpToken.delegateExplicit(accounts[4], 10, { from: accounts[1] });
            // Act
            await vpToken.undelegateAllExplicit([accounts[2], accounts[3], accounts[4], accounts[5]], { from: accounts[1] });
            // Assert
            assertNumberEqual(await vpToken.votePowerOf(accounts[1]), 100);
            assertNumberEqual(await vpToken.votePowerOf(accounts[2]), 100);
            assertNumberEqual(await vpToken.votePowerOf(accounts[3]), 0);
            assertNumberEqual(await vpToken.votePowerOf(accounts[4]), 0);
        });

        it("Should revoke delegation from before replacement (does nothing)", async () => {
            // Assemble
            // Act
            await vpToken.revokeDelegationAt(accounts[2], initBlk3, { from: accounts[1] });
            await vpToken.revokeDelegationAt(accounts[3], initBlk3, { from: accounts[2] });
            // Assert
            assertNumberEqual(await vpToken.votePowerOfAt(accounts[1], initBlk3), 100);
            assertNumberEqual(await vpToken.votePowerOfAt(accounts[2], initBlk3), 100);
            assertNumberEqual(await vpToken.votePowerOfAt(accounts[3], initBlk3), 0);
        });

        it("Should revoke delegation after replacement", async () => {
            // Assemble
            await vpToken.delegate(accounts[2], 4000, { from: accounts[1] });
            await vpToken.delegate(accounts[3], 1000, { from: accounts[1] });
            const blk = await web3.eth.getBlockNumber();
            // Act
            await vpToken.revokeDelegationAt(accounts[2], blk, { from: accounts[1] });
            // Assert
            assertNumberEqual(await vpToken.votePowerOfAt(accounts[1], blk), 50);
            assertNumberEqual(await vpToken.votePowerOfAt(accounts[2], blk), 100);
            assertNumberEqual(await vpToken.votePowerOfAt(accounts[3], blk), 10);
        });
    });
    
    describe("Replace only writeVpContract", async () => {
        beforeEach(async () => {
            vpToken = await VPToken.new(accounts[0], "A token", "ATOK");
            await setDefaultVPContract(vpToken, accounts[0]);

            // make some changes to vote power and delegation
            await vpToken.mint(accounts[1], 200);
            initBlk1 = await web3.eth.getBlockNumber();
            await vpToken.transfer(accounts[2], 100, { from: accounts[1] });
            initBlk2 = await web3.eth.getBlockNumber();
            await vpToken.delegate(accounts[2], 3000, { from: accounts[1] });
            await vpToken.delegate(accounts[3], 2000, { from: accounts[1] });
            await vpToken.delegateExplicit(accounts[3], 50, { from: accounts[2] });
            initBlk3 = await web3.eth.getBlockNumber();
            // current vote powers: [1]: 50, [2]: 80, [3]: 70
            // initBlk1 vote powers: [1]: 200, [2]: 0, [3]: 0
            // initBlk2 vote powers: [1]: 100, [2]: 100, [3]: 0
            // initBlk3 vote powers: [1]: 50, [2]: 80, [3]: 70
            // without delegation: [1]: 100, [2]: 100, [3]: 0

            // replace VPContract
            const vpContractRepl = await VPContract.new(vpToken.address, true);
            await vpToken.setWriteVpContract(vpContractRepl.address, { from: accounts[0] });
        });

        it("Should read old vote powers and delegations", async () => {
            // Assemble
            // Act
            // Assert
            assertNumberEqual(await vpToken.totalVotePower(), 200);
            assertNumberEqual(await vpToken.votePowerOf(accounts[1]), 50);
            assertNumberEqual(await vpToken.votePowerOf(accounts[2]), 80);
            assertNumberEqual(await vpToken.votePowerOf(accounts[3]), 70);
            assertNumberEqual(await vpToken.votePowerOfAt(accounts[1], initBlk1), 200);
            assertNumberEqual(await vpToken.votePowerOfAt(accounts[2], initBlk1), 0);
            assertNumberEqual(await vpToken.votePowerOfAt(accounts[1], initBlk2), 100);
            assertNumberEqual(await vpToken.votePowerOfAt(accounts[2], initBlk2), 100);
            assertNumberEqual(await vpToken.votePowerFromTo(accounts[1], accounts[2]), 30);
            assertNumberEqual(await vpToken.votePowerFromTo(accounts[2], accounts[3]), 50);
            assertNumberEqual(await vpToken.votePowerFromToAt(accounts[1], accounts[2], initBlk3), 30);
            assertNumberEqual(await vpToken.votePowerFromToAt(accounts[2], accounts[3], initBlk3), 50);
        });

        it("Undelegated vote powers should show old state", async () => {
            // Assemble
            // Act
            // Assert
            assertNumberEqual(await vpToken.undelegatedVotePowerOf(accounts[1]), 50);
            assertNumberEqual(await vpToken.undelegatedVotePowerOf(accounts[2]), 50);
            assertNumberEqual(await vpToken.undelegatedVotePowerOf(accounts[3]), 0);
            assertNumberEqual(await vpToken.undelegatedVotePowerOfAt(accounts[1], initBlk1), 200);
            assertNumberEqual(await vpToken.undelegatedVotePowerOfAt(accounts[2], initBlk1), 0);
        });

        it("Cached vote power should return old state, too", async () => {
            // Assemble
            // Act
            await vpToken.totalVotePowerAtCached(initBlk2);
            await vpToken.votePowerOfAtCached(accounts[1], initBlk3);
            await vpToken.votePowerOfAtCached(accounts[3], initBlk3);
            // Assert
            assertNumberEqual(await vpToken.totalVotePowerAtCached.call(initBlk3), 200);
            assertNumberEqual(await vpToken.votePowerOfAtCached.call(accounts[1], initBlk3), 50);
            assertNumberEqual(await vpToken.votePowerOfAtCached.call(accounts[2], initBlk3), 80);
            assertNumberEqual(await vpToken.votePowerOfAtCached.call(accounts[3], initBlk3), 70);
        });

        it("Delegations after replacement have no effect on reading", async () => {
            // Assemble
            // Act
            await vpToken.delegate(accounts[2], 4000, { from: accounts[1] });
            await vpToken.delegate(accounts[3], 1000, { from: accounts[1] });
            // Assert
            assertNumberEqual(await vpToken.votePowerOf(accounts[1]), 50);
            assertNumberEqual(await vpToken.votePowerOf(accounts[2]), 80);
            assertNumberEqual(await vpToken.votePowerOf(accounts[3]), 70);
        });

        it("Explicit delegations after replacement have no effect on reading", async () => {
            // Assemble
            // Act
            await vpToken.delegateExplicit(accounts[2], 40, { from: accounts[1] });
            await vpToken.delegateExplicit(accounts[3], 10, { from: accounts[1] });
            await vpToken.delegateExplicit(accounts[4], 10, { from: accounts[1] });
            // Assert
            assertNumberEqual(await vpToken.votePowerOf(accounts[1]), 50);
            assertNumberEqual(await vpToken.votePowerOf(accounts[2]), 80);
            assertNumberEqual(await vpToken.votePowerOf(accounts[3]), 70);
            assertNumberEqual(await vpToken.votePowerOf(accounts[4]), 0);
        });

        it("UndelegateAll after replacement has no effect on reading", async () => {
            // Assemble
            await vpToken.delegate(accounts[2], 4000, { from: accounts[1] });
            await vpToken.delegate(accounts[3], 1000, { from: accounts[1] });
            // Act
            await vpToken.undelegateAll({ from: accounts[1] });
            // Assert
            assertNumberEqual(await vpToken.votePowerOf(accounts[1]), 50);
            assertNumberEqual(await vpToken.votePowerOf(accounts[2]), 80);
            assertNumberEqual(await vpToken.votePowerOf(accounts[3]), 70);
        });

        it("UndelegateAllExplicit after replacement has no effect on reading", async () => {
            // Assemble
            await vpToken.delegateExplicit(accounts[2], 40, { from: accounts[1] });
            await vpToken.delegateExplicit(accounts[3], 10, { from: accounts[1] });
            await vpToken.delegateExplicit(accounts[4], 10, { from: accounts[1] });
            // Act
            await vpToken.undelegateAllExplicit([accounts[2], accounts[3], accounts[4], accounts[5]], { from: accounts[1] });
            // Assert
            assertNumberEqual(await vpToken.votePowerOf(accounts[1]), 50);
            assertNumberEqual(await vpToken.votePowerOf(accounts[2]), 80);
            assertNumberEqual(await vpToken.votePowerOf(accounts[3]), 70);
            assertNumberEqual(await vpToken.votePowerOf(accounts[4]), 0);
        });

        it("Revoke delegation also works on reading", async () => {
            // Assemble
            // Act
            await vpToken.revokeDelegationAt(accounts[2], initBlk3, { from: accounts[1] });
            await vpToken.revokeDelegationAt(accounts[3], initBlk3, { from: accounts[2] });
            // Assert
            assertNumberEqual(await vpToken.votePowerOfAt(accounts[1], initBlk3), 50);
            assertNumberEqual(await vpToken.votePowerOfAt(accounts[2], initBlk3), 50);
            assertNumberEqual(await vpToken.votePowerOfAt(accounts[3], initBlk3), 20);
        });
    });

    describe("Replace first writeVpContract and then readVpContract", async () => {
        let vpContractRepl: VPContractInstance;
        
        // Do clean unit tests by spinning up a fresh contract for each test
        beforeEach(async () => {
            vpToken = await VPToken.new(accounts[0], "A token", "ATOK");
            await setDefaultVPContract(vpToken, accounts[0]);

            // make some changes to vote power and delegation
            await vpToken.mint(accounts[1], 200);
            initBlk1 = await web3.eth.getBlockNumber();
            await vpToken.transfer(accounts[2], 100, { from: accounts[1] });
            initBlk2 = await web3.eth.getBlockNumber();
            await vpToken.delegate(accounts[2], 3000, { from: accounts[1] });
            await vpToken.delegate(accounts[3], 2000, { from: accounts[1] });
            await vpToken.delegateExplicit(accounts[3], 50, { from: accounts[2] });
            initBlk3 = await web3.eth.getBlockNumber();
            // current vote powers: [1]: 50, [2]: 80, [3]: 70
            // without delegation: [1]: 100, [2]: 100, [3]: 0

            // replace VPContract
            vpContractRepl = await VPContract.new(vpToken.address, true);
            await vpToken.setWriteVpContract(vpContractRepl.address, { from: accounts[0] });
        });

        it("Should remember vote powers from balance, but not delegations", async () => {
            // Assemble
            // Act
            await vpToken.setReadVpContract(vpContractRepl.address, { from: accounts[0] });
            // Assert
            assertNumberEqual(await vpToken.totalVotePower(), 200);
            assertNumberEqual(await vpToken.votePowerOf(accounts[1]), 100);
            assertNumberEqual(await vpToken.votePowerOf(accounts[2]), 100);
            assertNumberEqual(await vpToken.votePowerOf(accounts[3]), 0);
            assertNumberEqual(await vpToken.votePowerOfAt(accounts[1], initBlk1), 200);
            assertNumberEqual(await vpToken.votePowerOfAt(accounts[2], initBlk1), 0);
            assertNumberEqual(await vpToken.votePowerFromTo(accounts[1], accounts[2]), 0);
            assertNumberEqual(await vpToken.votePowerFromTo(accounts[2], accounts[3]), 0);
            assertNumberEqual(await vpToken.votePowerFromToAt(accounts[1], accounts[2], initBlk3), 0);
            assertNumberEqual(await vpToken.votePowerFromToAt(accounts[2], accounts[3], initBlk3), 0);
        });

        it("Undelegated vote powers should show no delegations", async () => {
            // Assemble
            // Act
            await vpToken.setReadVpContract(vpContractRepl.address, { from: accounts[0] });
            // Assert
            assertNumberEqual(await vpToken.undelegatedVotePowerOf(accounts[1]), 100);
            assertNumberEqual(await vpToken.undelegatedVotePowerOf(accounts[2]), 100);
            assertNumberEqual(await vpToken.undelegatedVotePowerOf(accounts[3]), 0);
            assertNumberEqual(await vpToken.undelegatedVotePowerOfAt(accounts[1], initBlk1), 200);
            assertNumberEqual(await vpToken.undelegatedVotePowerOfAt(accounts[2], initBlk1), 0);
        });

        it("Cached vote power methods should have no effect on new cache until switch", async () => {
            // Assemble
            await vpToken.totalVotePowerAtCached(initBlk2);
            await vpToken.votePowerOfAtCached(accounts[1], initBlk2);
            await vpToken.votePowerOfAtCached(accounts[3], initBlk2);
            // Act
            await vpToken.setReadVpContract(vpContractRepl.address, { from: accounts[0] });
            // Assert
            assertNumberEqual(await vpToken.totalVotePowerAtCached.call(initBlk2), 200);
            assertNumberEqual(await vpToken.votePowerOfAtCached.call(accounts[1], initBlk2), 100);
            assertNumberEqual(await vpToken.votePowerOfAtCached.call(accounts[3], initBlk2), 0);
        });

        it("Should delegate after replacement", async () => {
            // Assemble
            await vpToken.delegate(accounts[2], 4000, { from: accounts[1] });
            await vpToken.delegate(accounts[3], 1000, { from: accounts[1] });
            // Act
            await vpToken.setReadVpContract(vpContractRepl.address, { from: accounts[0] });
            // Assert
            assertNumberEqual(await vpToken.votePowerOf(accounts[1]), 50);
            assertNumberEqual(await vpToken.votePowerOf(accounts[2]), 140);
            assertNumberEqual(await vpToken.votePowerOf(accounts[3]), 10);
        });

        it("Should delegate explicit after replacement", async () => {
            // Assemble
            await vpToken.delegateExplicit(accounts[2], 40, { from: accounts[1] });
            await vpToken.delegateExplicit(accounts[3], 10, { from: accounts[1] });
            await vpToken.delegateExplicit(accounts[4], 10, { from: accounts[1] });
            // Act
            await vpToken.setReadVpContract(vpContractRepl.address, { from: accounts[0] });
            // Assert
            assertNumberEqual(await vpToken.votePowerOf(accounts[1]), 40);
            assertNumberEqual(await vpToken.votePowerOf(accounts[2]), 140);
            assertNumberEqual(await vpToken.votePowerOf(accounts[3]), 10);
            assertNumberEqual(await vpToken.votePowerOf(accounts[4]), 10);
        });

        it("Should undelegateAll after replacement", async () => {
            // Assemble
            await vpToken.delegate(accounts[2], 4000, { from: accounts[1] });
            await vpToken.delegate(accounts[3], 1000, { from: accounts[1] });
            await vpToken.undelegateAll({ from: accounts[1] });
            // Act
            await vpToken.setReadVpContract(vpContractRepl.address, { from: accounts[0] });
            // Assert
            assertNumberEqual(await vpToken.votePowerOf(accounts[1]), 100);
            assertNumberEqual(await vpToken.votePowerOf(accounts[2]), 100);
            assertNumberEqual(await vpToken.votePowerOf(accounts[3]), 0);
        });

        it("Should undelegateAllExplicit after replacement", async () => {
            // Assemble
            await vpToken.delegateExplicit(accounts[2], 40, { from: accounts[1] });
            await vpToken.delegateExplicit(accounts[3], 10, { from: accounts[1] });
            await vpToken.delegateExplicit(accounts[4], 10, { from: accounts[1] });
            await vpToken.undelegateAllExplicit([accounts[2], accounts[3], accounts[4], accounts[5]], { from: accounts[1] });
            // Act
            await vpToken.setReadVpContract(vpContractRepl.address, { from: accounts[0] });
            // Assert
            assertNumberEqual(await vpToken.votePowerOf(accounts[1]), 100);
            assertNumberEqual(await vpToken.votePowerOf(accounts[2]), 100);
            assertNumberEqual(await vpToken.votePowerOf(accounts[3]), 0);
            assertNumberEqual(await vpToken.votePowerOf(accounts[4]), 0);
        });

        it("Should revoke delegation from before replacement (does nothing)", async () => {
            // Assemble
            await vpToken.revokeDelegationAt(accounts[2], initBlk3, { from: accounts[1] });
            await vpToken.revokeDelegationAt(accounts[3], initBlk3, { from: accounts[2] });
            // Act
            await vpToken.setReadVpContract(vpContractRepl.address, { from: accounts[0] });
            // Assert
            assertNumberEqual(await vpToken.votePowerOfAt(accounts[1], initBlk3), 100);
            assertNumberEqual(await vpToken.votePowerOfAt(accounts[2], initBlk3), 100);
            assertNumberEqual(await vpToken.votePowerOfAt(accounts[3], initBlk3), 0);
        });

        it("Revoke delegation before or after read switch works", async () => {
            // Assemble
            await vpToken.delegate(accounts[2], 4000, { from: accounts[1] });
            await vpToken.delegate(accounts[3], 1000, { from: accounts[1] });
            const blk = await web3.eth.getBlockNumber();
            // Act
            await vpToken.revokeDelegationAt(accounts[2], blk, { from: accounts[1] });
            await vpToken.setReadVpContract(vpContractRepl.address, { from: accounts[0] });
            await vpToken.revokeDelegationAt(accounts[3], blk, { from: accounts[1] });
            // Assert
            assertNumberEqual(await vpToken.votePowerOfAt(accounts[1], blk), 50);
            assertNumberEqual(await vpToken.votePowerOfAt(accounts[2], blk), 100);
            assertNumberEqual(await vpToken.votePowerOfAt(accounts[3], blk), 0);
        });
    });
});
