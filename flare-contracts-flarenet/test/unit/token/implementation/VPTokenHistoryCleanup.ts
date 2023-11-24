import { VPContractInstance, VPTokenMockInstance } from "../../../../typechain-truffle";
import { SimpleHistoryCleaner } from "../../../utils/SimpleHistoryCleaner";
import { assertNumberEqual, compareArrays, compareNumberArrays } from "../../../utils/test-helpers";
import { setDefaultVPContract } from "../../../utils/token-test-helpers";

// Unit tests for VPToken: checkpointable, delegatable, and ERC20 sanity tests
import { constants, expectRevert, time } from '@openzeppelin/test-helpers';
const getTestFile = require('../../../utils/constants').getTestFile;

const VPToken = artifacts.require("VPTokenMock");
const HistoryCleanerMock = artifacts.require("HistoryCleanerMock");
const VPContract = artifacts.require("VPContract");


contract(`VPTokenHistoryCleanup.sol; ${getTestFile(__filename)}; VPToken history cleanup unit tests`, async accounts => {
    // contains a fresh contract for each test
    let vpToken: VPTokenMockInstance;
    let vpContract: VPContractInstance;
    let cleaner: SimpleHistoryCleaner;

    describe("History cleanup methods unit test", async () => {
        // Do clean unit tests by spinning up a fresh contract for each test
        beforeEach(async () => {
            // vpToken
            vpToken = await VPToken.new(accounts[0], "A token", "ATOK");
            await setDefaultVPContract(vpToken, accounts[0]);
            await vpToken.setCleanupBlockNumberManager(accounts[8]);
            // vpContract
            vpContract = await VPContract.at(await vpToken.getReadVpContract());
        });

        it("calling history cleanup methods directly is forbidden", async () => {
            // Assemble
            await vpToken.mint(accounts[1], 100);
            await vpToken.mint(accounts[2], 100);
            await vpToken.delegate(accounts[3], 1000, { from: accounts[1] });
            await vpToken.delegateExplicit(accounts[3], 10, { from: accounts[2] });
            const blk1 = await web3.eth.getBlockNumber();
            await vpToken.revokeDelegationAt(accounts[3], blk1, { from: accounts[1] })
            const blk2 = await web3.eth.getBlockNumber();
            // Act
            await vpToken.setCleanupBlockNumber(blk2, { from: accounts[8] });
            // Assert
            await expectRevert(vpToken.totalSupplyHistoryCleanup(1), "Only cleaner contract");
            await expectRevert(vpToken.balanceHistoryCleanup(accounts[1], 1), "Only cleaner contract");
            await expectRevert(vpToken.totalSupplyCacheCleanup(blk1), "Only cleaner contract");
            await expectRevert(vpContract.votePowerHistoryCleanup(accounts[1], 1), "Only cleaner contract");
            await expectRevert(vpContract.percentageDelegationHistoryCleanup(accounts[1], 1), "Only cleaner contract");
            await expectRevert(vpContract.explicitDelegationHistoryCleanup(accounts[2], accounts[3], 1), "Only cleaner contract");
            await expectRevert(vpContract.votePowerCacheCleanup(accounts[1], blk1), "Only cleaner contract");
            await expectRevert(vpContract.revocationCleanup(accounts[1], accounts[3], blk1), "Only cleaner contract");
        });

        it("cleaning empty history is a no-op", async () => {
            // Assemble
            const blk1 = await web3.eth.getBlockNumber();
            await time.advanceBlock();
            const blk2 = await web3.eth.getBlockNumber();
            await vpToken.setCleanerContract(accounts[5], { from: accounts[0] });
            await vpToken.setCleanupBlockNumber(blk2, { from: accounts[8] });
            // Act
            await vpToken.totalSupplyHistoryCleanup(1, { from: accounts[5] });
            await vpToken.balanceHistoryCleanup(accounts[1], 1, { from: accounts[5] });
            await vpToken.totalSupplyCacheCleanup(blk1, { from: accounts[5] });
            await vpContract.votePowerHistoryCleanup(accounts[1], 1, { from: accounts[5] });
            await vpContract.percentageDelegationHistoryCleanup(accounts[1], 1, { from: accounts[5] });
            await vpContract.explicitDelegationHistoryCleanup(accounts[2], accounts[3], 1, { from: accounts[5] });
            await vpContract.votePowerCacheCleanup(accounts[1], blk1, { from: accounts[5] });
            await vpContract.revocationCleanup(accounts[1], accounts[3], blk1, { from: accounts[5] });
            // Assert
            assertNumberEqual(await vpToken.totalSupply(), 0);
            assertNumberEqual(await vpToken.totalSupplyAt(blk2), 0);
            assertNumberEqual(await vpToken.balanceOf(accounts[1]), 0);
            assertNumberEqual(await vpToken.balanceOf(accounts[2]), 0);
            assertNumberEqual(await vpToken.votePowerOf(accounts[1]), 0);
            assertNumberEqual(await vpToken.votePowerOf(accounts[2]), 0);
            assertNumberEqual(await vpToken.votePowerOf(accounts[3]), 0);
            assertNumberEqual(await vpToken.totalSupplyHistoryCleanup.call(1, { from: accounts[5] }), 0);
            assertNumberEqual(await vpToken.balanceHistoryCleanup.call(accounts[1], 1, { from: accounts[5] }), 0);
            assertNumberEqual(await vpToken.totalSupplyCacheCleanup.call(blk1, { from: accounts[5] }), 0);
            assertNumberEqual(await vpContract.votePowerHistoryCleanup.call(accounts[1], 1, { from: accounts[5] }), 0);
            assertNumberEqual(await vpContract.percentageDelegationHistoryCleanup.call(accounts[1], 1, { from: accounts[5] }), 0);
            assertNumberEqual(await vpContract.explicitDelegationHistoryCleanup.call(accounts[2], accounts[3], 1, { from: accounts[5] }), 0);
            assertNumberEqual(await vpContract.votePowerCacheCleanup.call(accounts[1], blk1, { from: accounts[5] }), 0);
            assertNumberEqual(await vpContract.revocationCleanup.call(accounts[1], accounts[3], blk1, { from: accounts[5] }), 0);
        });
        
        it("cleaning cache at or after cleanup block is forbidden", async () => {
            // Assemble
            await vpToken.mint(accounts[1], 100);
            await vpToken.delegate(accounts[2], 1000, { from: accounts[1] });
            const blk1 = await web3.eth.getBlockNumber();
            await time.advanceBlock();
            const blk2 = await web3.eth.getBlockNumber();
            await vpToken.setCleanerContract(accounts[5], { from: accounts[0] });
            await vpToken.setCleanupBlockNumber(blk1, { from: accounts[8] });
            // Act
            await vpToken.totalVotePowerAtCached(blk1);
            await vpToken.revokeDelegationAt(accounts[2], blk1, { from: accounts[1] });
            await vpToken.totalVotePowerAtCached(blk2);
            await vpToken.revokeDelegationAt(accounts[2], blk2, { from: accounts[1] });
            // Assert
            await expectRevert(vpToken.totalSupplyCacheCleanup(blk1, { from: accounts[5] }), 
                "No cleanup after cleanup block");
            await expectRevert(vpContract.votePowerCacheCleanup(accounts[1], blk1, { from: accounts[5] }), 
                "No cleanup after cleanup block");
            await expectRevert(vpContract.revocationCleanup(accounts[1], accounts[2], blk1, { from: accounts[5] }),
                "No cleanup after cleanup block");
            await expectRevert(vpToken.totalSupplyCacheCleanup(blk2, { from: accounts[5] }),
                "No cleanup after cleanup block");
            await expectRevert(vpContract.votePowerCacheCleanup(accounts[1], blk2, { from: accounts[5] }),
                "No cleanup after cleanup block");
            await expectRevert(vpContract.revocationCleanup(accounts[1], accounts[2], blk2, { from: accounts[5] }),
                "No cleanup after cleanup block");
        });

        it("cleaning history enough times cleans everything available", async () => {
            // Assemble
            await vpToken.mint(accounts[1], 100);
            await vpToken.mint(accounts[2], 100);
            await vpToken.delegate(accounts[3], 1000, { from: accounts[1] });
            await vpToken.delegateExplicit(accounts[3], 10, { from: accounts[2] });
            const blk1 = await web3.eth.getBlockNumber();
            await vpToken.undelegateAll({ from: accounts[1] });
            await vpToken.undelegateAllExplicit([accounts[3]], { from: accounts[2] });
            await vpToken.mint(accounts[1], 100);
            await vpToken.totalVotePowerAtCached(blk1);
            await vpToken.revokeDelegationAt(accounts[3], blk1, { from: accounts[1] })
            const blk2 = await web3.eth.getBlockNumber();
            await vpToken.setCleanerContract(accounts[5], { from: accounts[0] });
            await vpToken.setCleanupBlockNumber(blk2, { from: accounts[8] });
            // verify initial
            assertNumberEqual(await vpToken.totalSupplyHistoryCleanup.call(10, { from: accounts[5] }), 2);
            assertNumberEqual(await vpToken.balanceHistoryCleanup.call(accounts[1], 10, { from: accounts[5] }), 1);
            assertNumberEqual(await vpToken.totalSupplyCacheCleanup.call(blk1, { from: accounts[5] }), 1);
            assertNumberEqual(await vpContract.votePowerHistoryCleanup.call(accounts[1], 10, { from: accounts[5] }), 3);
            assertNumberEqual(await vpContract.percentageDelegationHistoryCleanup.call(accounts[1], 10, { from: accounts[5] }), 1);
            assertNumberEqual(await vpContract.explicitDelegationHistoryCleanup.call(accounts[2], accounts[3], 10, { from: accounts[5] }), 2);
            assertNumberEqual(await vpContract.votePowerCacheCleanup.call(accounts[1], blk1, { from: accounts[5] }), 0);
            assertNumberEqual(await vpContract.revocationCleanup.call(accounts[1], accounts[3], blk1, { from: accounts[5] }), 1);
            // Act
            for (let i = 0; i < 3; i++) {
                await vpToken.totalSupplyHistoryCleanup(1, { from: accounts[5] });
                await vpToken.balanceHistoryCleanup(accounts[1], 1, { from: accounts[5] });
                await vpToken.totalSupplyCacheCleanup(blk1, { from: accounts[5] });
                await vpContract.votePowerHistoryCleanup(accounts[1], 1, { from: accounts[5] });
                await vpContract.percentageDelegationHistoryCleanup(accounts[1], 1, { from: accounts[5] });
                await vpContract.explicitDelegationHistoryCleanup(accounts[2], accounts[3], 1, { from: accounts[5] });
                await vpContract.votePowerCacheCleanup(accounts[1], blk1, { from: accounts[5] });
                await vpContract.revocationCleanup(accounts[1], accounts[3], blk1, { from: accounts[5] });
            }
            // Assert
            assertNumberEqual(await vpToken.totalSupplyHistoryCleanup.call(1, { from: accounts[5] }), 0);
            assertNumberEqual(await vpToken.balanceHistoryCleanup.call(accounts[1], 1, { from: accounts[5] }), 0);
            assertNumberEqual(await vpToken.totalSupplyCacheCleanup.call(blk1, { from: accounts[5] }), 0);
            assertNumberEqual(await vpContract.votePowerHistoryCleanup.call(accounts[1], 1, { from: accounts[5] }), 0);
            assertNumberEqual(await vpContract.percentageDelegationHistoryCleanup.call(accounts[1], 1, { from: accounts[5] }), 0);
            assertNumberEqual(await vpContract.explicitDelegationHistoryCleanup.call(accounts[2], accounts[3], 1, { from: accounts[5] }), 0);
            assertNumberEqual(await vpContract.votePowerCacheCleanup.call(accounts[1], blk1, { from: accounts[5] }), 0);
            assertNumberEqual(await vpContract.revocationCleanup.call(accounts[1], accounts[3], blk1, { from: accounts[5] }), 0);
        });

        it("values at cleanup block are still available after cleanup", async () => {
            // Assemble
            await vpToken.mint(accounts[1], 100);
            await vpToken.mint(accounts[2], 100);
            await vpToken.delegate(accounts[3], 1000, { from: accounts[1] });
            await vpToken.delegate(accounts[4], 2000, { from: accounts[1] });
            await vpToken.delegateExplicit(accounts[3], 10, { from: accounts[2] });
            await vpToken.delegateExplicit(accounts[4], 20, { from: accounts[2] });
            await vpToken.mint(accounts[1], 50);
            await vpToken.mint(accounts[2], 50);
            await vpToken.delegate(accounts[3], 2000, { from: accounts[1] });
            await vpToken.delegateExplicit(accounts[3], 20, { from: accounts[2] });
            const blk2 = await web3.eth.getBlockNumber();
            await vpToken.setCleanerContract(accounts[5], { from: accounts[0] });
            await vpToken.setCleanupBlockNumber(blk2, { from: accounts[8] });
            // Assert
            // there should be opportunities to clean
            assertNumberEqual(await vpToken.totalSupplyHistoryCleanup.call(1, { from: accounts[5] }), 1);
            assertNumberEqual(await vpToken.balanceHistoryCleanup.call(accounts[1], 1, { from: accounts[5] }), 1);
            assertNumberEqual(await vpToken.balanceHistoryCleanup.call(accounts[2], 1, { from: accounts[5] }), 1);
            assertNumberEqual(await vpContract.votePowerHistoryCleanup.call(accounts[1], 1, { from: accounts[5] }), 1);
            assertNumberEqual(await vpContract.votePowerHistoryCleanup.call(accounts[2], 1, { from: accounts[5] }), 1);
            assertNumberEqual(await vpContract.percentageDelegationHistoryCleanup.call(accounts[1], 1, { from: accounts[5] }), 1);
            assertNumberEqual(await vpContract.explicitDelegationHistoryCleanup.call(accounts[2], accounts[3], 1, { from: accounts[5] }), 2);
            // Act
            for (let i = 0; i < 5; i++) {
                await vpToken.totalSupplyHistoryCleanup(1, { from: accounts[5] });
                await vpToken.balanceHistoryCleanup(accounts[1], 1, { from: accounts[5] });
                await vpToken.balanceHistoryCleanup(accounts[2], 1, { from: accounts[5] });
                await vpContract.votePowerHistoryCleanup(accounts[1], 1, { from: accounts[5] });
                await vpContract.votePowerHistoryCleanup(accounts[2], 1, { from: accounts[5] });
                await vpContract.percentageDelegationHistoryCleanup(accounts[1], 1, { from: accounts[5] });
                await vpContract.explicitDelegationHistoryCleanup(accounts[2], accounts[3], 1, { from: accounts[5] });
            }
            // Assert
            // everything should be cleaned before cleanup block
            assertNumberEqual(await vpToken.totalSupplyHistoryCleanup.call(1, { from: accounts[5] }), 0);
            assertNumberEqual(await vpToken.balanceHistoryCleanup.call(accounts[1], 1, { from: accounts[5] }), 0);
            assertNumberEqual(await vpToken.balanceHistoryCleanup.call(accounts[2], 1, { from: accounts[5] }), 0);
            assertNumberEqual(await vpContract.votePowerHistoryCleanup.call(accounts[1], 1, { from: accounts[5] }), 0);
            assertNumberEqual(await vpContract.votePowerHistoryCleanup.call(accounts[2], 1, { from: accounts[5] }), 0);
            assertNumberEqual(await vpContract.percentageDelegationHistoryCleanup.call(accounts[1], 1, { from: accounts[5] }), 0);
            assertNumberEqual(await vpContract.explicitDelegationHistoryCleanup.call(accounts[2], accounts[3], 1, { from: accounts[5] }), 0);
            // the state at blk2 should still be ok
            // wNat.delegatesOfAt
            assertNumberEqual(await vpToken.totalSupplyAt(blk2), 300);
            assertNumberEqual(await vpToken.totalVotePowerAt(blk2), 300);
            assertNumberEqual(await vpToken.balanceOfAt(accounts[1], blk2), 150);
            assertNumberEqual(await vpToken.balanceOfAt(accounts[2], blk2), 150);
            assertNumberEqual(await vpToken.votePowerOfAt(accounts[1], blk2), 90);
            assertNumberEqual(await vpToken.votePowerOfAt(accounts[2], blk2), 110);
            assertNumberEqual(await vpToken.votePowerOfAt(accounts[3], blk2), 50);
            assertNumberEqual(await vpToken.votePowerOfAt(accounts[4], blk2), 50);
            assertNumberEqual(await vpToken.undelegatedVotePowerOfAt(accounts[1], blk2), 90);
            assertNumberEqual(await vpToken.undelegatedVotePowerOfAt(accounts[2], blk2), 110);
            assertNumberEqual(await vpToken.undelegatedVotePowerOfAt(accounts[3], blk2), 0);
            assertNumberEqual(await vpToken.undelegatedVotePowerOfAt(accounts[4], blk2), 0);
            assertNumberEqual(await vpToken.votePowerFromToAt(accounts[1], accounts[3], blk2), 30);
            assertNumberEqual(await vpToken.votePowerFromToAt(accounts[1], accounts[4], blk2), 30);
            assertNumberEqual(await vpToken.votePowerFromToAt(accounts[2], accounts[3], blk2), 20);
            assertNumberEqual(await vpToken.votePowerFromToAt(accounts[2], accounts[4], blk2), 20);
            const { 0: delegates, 1: bips } = await vpToken.delegatesOfAt(accounts[1], blk2);
            compareArrays(delegates, [accounts[3], accounts[4]]);
            compareNumberArrays(bips, [2000, 2000]);
        });

        it("cleaning history twice when is allowed and is a no-op if everything was emptied the first time", async () => {
            // Assemble
            await vpToken.mint(accounts[1], 100);
            await vpToken.mint(accounts[2], 100);
            await vpToken.delegate(accounts[3], 1000, { from: accounts[1] });
            await vpToken.delegateExplicit(accounts[3], 10, { from: accounts[2] });
            const blk1 = await web3.eth.getBlockNumber();
            await vpToken.undelegateAll({ from: accounts[1] });
            await vpToken.undelegateAllExplicit([accounts[3]], { from: accounts[2] });
            await vpToken.mint(accounts[1], 100);
            await vpToken.totalVotePowerAtCached(blk1);
            await vpToken.revokeDelegationAt(accounts[3], blk1, { from: accounts[1] })
            const blk2 = await web3.eth.getBlockNumber();
            await vpToken.setCleanerContract(accounts[5], { from: accounts[0] });
            await vpToken.setCleanupBlockNumber(blk2, { from: accounts[8] });
            // verify initial
            assertNumberEqual(await vpToken.totalSupplyHistoryCleanup.call(10, { from: accounts[5] }), 2);
            assertNumberEqual(await vpToken.balanceHistoryCleanup.call(accounts[1], 10, { from: accounts[5] }), 1);
            assertNumberEqual(await vpToken.totalSupplyCacheCleanup.call(blk1, { from: accounts[5] }), 1);
            assertNumberEqual(await vpContract.votePowerHistoryCleanup.call(accounts[1], 10, { from: accounts[5] }), 3);
            assertNumberEqual(await vpContract.percentageDelegationHistoryCleanup.call(accounts[1], 10, { from: accounts[5] }), 1);
            assertNumberEqual(await vpContract.explicitDelegationHistoryCleanup.call(accounts[2], accounts[3], 10, { from: accounts[5] }), 2);
            assertNumberEqual(await vpContract.votePowerCacheCleanup.call(accounts[1], blk1, { from: accounts[5] }), 0);
            assertNumberEqual(await vpContract.revocationCleanup.call(accounts[1], accounts[3], blk1, { from: accounts[5] }), 1);
            // Act
            for (let i = 0; i < 2; i++) {
                await vpToken.totalSupplyHistoryCleanup(10, { from: accounts[5] });
                await vpToken.balanceHistoryCleanup(accounts[1], 10, { from: accounts[5] });
                await vpToken.totalSupplyCacheCleanup(blk1, { from: accounts[5] });
                await vpContract.votePowerHistoryCleanup(accounts[1], 10, { from: accounts[5] });
                await vpContract.percentageDelegationHistoryCleanup(accounts[1], 10, { from: accounts[5] });
                await vpContract.explicitDelegationHistoryCleanup(accounts[2], accounts[3], 10, { from: accounts[5] });
                await vpContract.votePowerCacheCleanup(accounts[1], blk1, { from: accounts[5] });
                await vpContract.revocationCleanup(accounts[1], accounts[3], blk1, { from: accounts[5] });
                // Assert
                assertNumberEqual(await vpToken.totalSupplyHistoryCleanup.call(1, { from: accounts[5] }), 0);
                assertNumberEqual(await vpToken.balanceHistoryCleanup.call(accounts[1], 1, { from: accounts[5] }), 0);
                assertNumberEqual(await vpToken.totalSupplyCacheCleanup.call(blk1, { from: accounts[5] }), 0);
                assertNumberEqual(await vpContract.votePowerHistoryCleanup.call(accounts[1], 1, { from: accounts[5] }), 0);
                assertNumberEqual(await vpContract.percentageDelegationHistoryCleanup.call(accounts[1], 1, { from: accounts[5] }), 0);
                assertNumberEqual(await vpContract.explicitDelegationHistoryCleanup.call(accounts[2], accounts[3], 1, { from: accounts[5] }), 0);
                assertNumberEqual(await vpContract.votePowerCacheCleanup.call(accounts[1], blk1, { from: accounts[5] }), 0);
                assertNumberEqual(await vpContract.revocationCleanup.call(accounts[1], accounts[3], blk1, { from: accounts[5] }), 0);
            }
        });
    });

    describe("Test history cleanup with event tracking", async () => {
        // Do clean unit tests by spinning up a fresh contract for each test
        beforeEach(async () => {
            // vpToken
            vpToken = await VPToken.new(accounts[0], "A token", "ATOK");
            await setDefaultVPContract(vpToken, accounts[0]);
            await vpToken.setCleanupBlockNumberManager(accounts[8]);
            // vpContract
            vpContract = await VPContract.at(await vpToken.getReadVpContract());
            // history cleaner
            const historyCleaner = await HistoryCleanerMock.new();
            await vpToken.setCleanerContract(historyCleaner.address, { from: accounts[0] });    // automatically set to vpContract too
            // cleaner
            cleaner = new SimpleHistoryCleaner({ vpToken, vpContract }, historyCleaner);
        });

        it("record checkpointable events", async () => {
            // Assemble
            // Act
            await cleaner.track(vpToken.mint(accounts[1], 100));
            const blk1 = await web3.eth.getBlockNumber();
            await cleaner.track(vpToken.transfer(accounts[2], 10, { from: accounts[1] }));
            await cleaner.track(vpToken.totalVotePowerAtCached(blk1));
            // Assert
            // console.log(JSON.stringify(Array.from(cleaner.records), null, 4));
            assert.equal(cleaner.records.size, 8);
        });

        it("perform cleanup after balance changes", async () => {
            // Assemble
            await cleaner.track(vpToken.mint(accounts[1], 100));
            await cleaner.track(vpToken.transfer(accounts[2], 10, { from: accounts[1] }));
            await cleaner.track(vpToken.transfer(accounts[2], 30, { from: accounts[1] }));
            await time.advanceBlock();
            const blk2 = await web3.eth.getBlockNumber();
            await vpToken.setCleanupBlockNumber(blk2, { from: accounts[8] });
            // Act
            // console.log(Array.from(cleaner.records).map(r => `${r.address} [${r.blockNumber}] ${r.comment}`));
            const beforeCleanup = await cleaner.check(20);
            await cleaner.cleanup(20);
            const afterCleanup = await cleaner.check(20);
            // Assert
            assert.equal(beforeCleanup.filter(n => n !== 0).length, 6); // 6 possible cleanups
            assert.equal(afterCleanup.filter(n => n !== 0).length, 0);  // no possible cleanups
        });

        it("perform cleanup after delegations", async () => {
            // cleaner.debug = true;
            // Assemble
            await cleaner.track(vpToken.mint(accounts[1], 200));
            await cleaner.track(vpToken.transfer(accounts[2], 100, { from: accounts[1] }));
            await cleaner.track(vpToken.delegate(accounts[3], 4000, { from: accounts[1] }));
            await cleaner.track(vpToken.delegateExplicit(accounts[3], 40, { from: accounts[2] }));
            await cleaner.track(vpToken.transfer(accounts[2], 20, { from: accounts[1] }));
            const blk1 = await web3.eth.getBlockNumber();
            //
            await cleaner.track(vpToken.undelegateAll({ from: accounts[1] }));
            await cleaner.track(vpToken.undelegateAllExplicit([accounts[3]], { from: accounts[2] }));
            await cleaner.track(vpToken.totalVotePowerAtCached(blk1));
            await cleaner.track(vpToken.votePowerOfAtCached(accounts[1], blk1));
            await cleaner.track(vpToken.revokeDelegationAt(accounts[3], blk1, { from: accounts[1] }));
            const blk2 = await web3.eth.getBlockNumber();
            await vpToken.setCleanupBlockNumber(blk2, { from: accounts[8] });
            // Act
            const beforeCleanup = await cleaner.check(50);
            // console.log(Array.from(cleaner.records).map((r, i) => `${i} ${r.address} [${r.blockNumber}] ${r.comment} => ${beforeCleanup[i]}`));
            await cleaner.cleanup(50);
            const afterCleanup = await cleaner.check(50);
            // console.log(beforeCleanup.length, afterCleanup.length);
            // Assert
            assert.equal(beforeCleanup.filter(n => n !== 0).length, 20); // 20 possible cleanups
            assert.equal(afterCleanup.filter(n => n !== 0).length, 0);  // no possible cleanups
        });
    });
});
