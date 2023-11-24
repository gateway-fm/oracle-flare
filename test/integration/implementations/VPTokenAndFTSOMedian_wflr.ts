import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { ethers } from "hardhat";
import { MockFtso, VPTokenMock, WNat } from "../../../typechain";
import { checkTestCase, finalizePriceEpochWithResult, getWeightRatio, moveFromCurrentToNextEpochStart, moveToFinalizeStart, moveToRevealStart, prettyPrintEpochResult, prettyPrintVoteInfo, resultsFromTestData, revealPrice, submitPrice, TestCase, TestExample, testFTSOMedian2, toEpochResult, updateWithRewardedVotesInfo } from "../../utils/FTSO-test-utils";
import { newContract } from "../../utils/test-helpers";
import { TestExampleLogger } from "../../utils/TestExampleLogger";
import { setDefaultVPContract_ethers } from "../../utils/token-test-helpers";

import { constants, expectRevert } from '@openzeppelin/test-helpers';
import { defaultPriceEpochCyclicBufferSize } from "../../utils/constants";

async function deployContracts(signer: SignerWithAddress, epochStartTimestamp: number, epochPeriod: number, revealPeriod: number): Promise<{ natToken: WNat; assetToken: VPTokenMock; ftso: MockFtso; }> {

    let natToken: WNat = await newContract<WNat>("WNat", signer, signer.address, "Wrapped NAT", "WNAT");
    await setDefaultVPContract_ethers(natToken, signer);
    let assetToken: VPTokenMock = await newContract<VPTokenMock>("VPTokenMock", signer, signer.address, "xAsset", "XASSET");
    await setDefaultVPContract_ethers(assetToken, signer);

    let ftso: MockFtso = await newContract<MockFtso>("MockFtso", signer,
        "XASSET", 5, constants.ZERO_ADDRESS, natToken.address, signer.address, // symbol, address priceSubmitter, address _wNat, address _ftsoManager
        epochStartTimestamp, // uint256 _startTimestamp
        epochPeriod, revealPeriod, //uint256 _epochPeriod, uint256 _revealPeriod
        1, //uint256 _initialPrice
        1e10,
        defaultPriceEpochCyclicBufferSize,
        true
    );
    await ftso.connect(signer).setAsset(assetToken.address);

    return {natToken, assetToken, ftso};
}

describe("VPToken and FTSO contract - integration tests - wnat", () => {
    /**
     * Purpose
     * An FTSO can fetch real vote power and compute price correctly from 10 submitters. 
     * Scenario
     * 10 data providers (with directly minted native token tokens)
     * Run one price epoch
     * Expected Result:
     * Price computed correctly from freshly minted native token across data providers.
     */
    it(`10 submitters with native token tokens`, async function () {
        const epochStartTimestamp: number = 1;
        const signers: SignerWithAddress[] = await ethers.getSigners();

        const epochPeriod = 14;
        const revealPeriod = 14;

        let {natToken, assetToken, ftso} = await deployContracts(signers[0], epochStartTimestamp, epochPeriod, revealPeriod);

        const nats: number[] = [20e5, 10e5, 15e5, 5e5, 25e5, 3e5, 8e5, 9e5, 6e5, 12e5];
        const prices: number[] = [5, 11, 13, 9, 6, 7, 15, 8, 10, 6];

        for (let i = 0; i < nats.length; i++) {
            await natToken.connect(signers[i]).deposit({value: nats[i]});
        }

        let blockNumber = await ethers.provider.getBlockNumber();
        await ftso.setVotePowerBlock(blockNumber);

        let testExample: TestExample = {prices: prices, weightsNat: nats, weightsAsset: [0,0,0,0,0,0,0,0,0,0]};

        const testCase: TestCase = await testFTSOMedian2(epochStartTimestamp, epochPeriod, revealPeriod, signers, ftso, testExample);

        // Test results
        checkTestCase(testCase);
    });

    /**
     * Purpose
     * An FTSO can fetch real vote power and compute price correctly from 5 submitters. 
     * Scenario
     * 5 data providers (with delegated WNAT tokens from 10 signers)
     * Run one price epoch
     */
    it(`5 submitters with delegated WNAT tokens only`, async function () {
        const epochStartTimestamp: number = 1;
        const signers: SignerWithAddress[] = await ethers.getSigners();

        const epochPeriod = 14;
        const revealPeriod = 14;

        let {natToken, assetToken, ftso} = await deployContracts(signers[0], epochStartTimestamp, epochPeriod, revealPeriod);

        const natWeights: number[] = [0, 0, 0, 0, 0, 20e5, 10e5, 15e5, 5e5, 25e5, 3e5, 8e5, 9e5, 6e5, 12e5];
        const prices: number[] = [5, 11, 13, 9, 6];

        const nats: number[] = [0, 0, 0, 0, 0];
        for (let i = 0; i < natWeights.length; i++) {
            await natToken.connect(signers[i]).deposit({value: natWeights[i]});
            nats[i % 5] += natWeights[i];
            if (i >= 5) {
                await natToken.connect(signers[i]).delegate(signers[i % 5].address, 10000);
            }
        }

        let blockNumber = await ethers.provider.getBlockNumber();
        await ftso.setVotePowerBlock(blockNumber);

        let testExample: TestExample = {prices: prices, weightsNat: nats, weightsAsset: [0,0,0,0,0]};

        const testCase: TestCase = await testFTSOMedian2(epochStartTimestamp, epochPeriod, revealPeriod, signers, ftso, testExample);

        // Test results
        checkTestCase(testCase);
    });

    /**
     * Purpose
     * An FTSO can fetch real vote power and compute price correctly from 5 submitters. 
     * Scenario
     * 5 data providers (with own and delegated WNAT tokens from 10 signers)
     * Run one price epoch
     */
    it(`5 submitters with own and delegated WNAT tokens`, async function () {
        const epochStartTimestamp: number = 1;
        const signers: SignerWithAddress[] = await ethers.getSigners();

        const epochPeriod = 14;
        const revealPeriod = 14;

        let {natToken, assetToken, ftso} = await deployContracts(signers[0], epochStartTimestamp, epochPeriod, revealPeriod);

        const natWeights: number[] = [5e5, 15e5, 6e5, 9e5, 7e5, 20e5, 10e5, 15e5, 5e5, 25e5, 3e5, 8e5, 9e5, 6e5, 12e5];
        const prices: number[] = [5, 11, 13, 9, 6];

        const nats: number[] = [0, 0, 0, 0, 0];
        for (let i = 0; i < natWeights.length; i++) {
            await natToken.connect(signers[i]).deposit({value: natWeights[i]});
            nats[i % 5] += natWeights[i];
            if (i >= 5) {
                await natToken.connect(signers[i]).delegateExplicit(signers[i % 5].address, natWeights[i]);
            }
        }

        let blockNumber = await ethers.provider.getBlockNumber();
        await ftso.setVotePowerBlock(blockNumber);

        let testExample: TestExample = {prices: prices, weightsNat: nats, weightsAsset: [0,0,0,0,0]};

        const testCase: TestCase = await testFTSOMedian2(epochStartTimestamp, epochPeriod, revealPeriod, signers, ftso, testExample);

        // Test results
        checkTestCase(testCase);
    });

    /**
     * Purpose
     * An FTSO can fetch real vote power and compute price correctly from 10 submitters, but only 5 reveals. 
     * Scenario
     * 10 data providers (with wnat tokens)
     * Run one price epoch
     */
    it(`10 submitters - only 5 reveals `, async function () {
        const epochStartTimestamp: number = 1;
        const signers: SignerWithAddress[] = await ethers.getSigners();

        const epochPeriod = 14;
        const revealPeriod = 14;

        let {natToken, assetToken, ftso} = await deployContracts(signers[0], epochStartTimestamp, epochPeriod, revealPeriod);

        const natWeights: number[] = [20e5, 10e5, 15e5, 5e5, 25e5, 3e5, 8e5, 9e5, 6e5, 12e5];
        const prices: number[] = [5, 11, 13, 9, 6, 1, 2, 3, 4, 5];

        for (let i = 0; i < natWeights.length; i++) {
            await natToken.connect(signers[i]).deposit({value: natWeights[i]});
        }

        let blockNumber = await ethers.provider.getBlockNumber();
        await ftso.setVotePowerBlock(blockNumber);

        let testExample: TestExample = {prices: prices.slice(0, 5), weightsNat: natWeights.slice(0, 5), weightsAsset: [0,0,0,0,0]};


        let logger = new TestExampleLogger(testExample);
        let len = testExample.prices.length;
        
        logger.log(`SUBMIT PRICE 10`)
        let epoch = await moveFromCurrentToNextEpochStart(epochStartTimestamp, epochPeriod);
        await submitPrice(epoch, signers, ftso, prices);

        await ftso.initializeCurrentEpochStateForReveal(1000, false);

        logger.log(`REVEAL PRICE 5`)
        await moveToRevealStart(epochStartTimestamp, epochPeriod, epoch);
        await revealPrice(signers, ftso, prices.slice(0, 5), epoch);
        
        // Finalize
        await moveToFinalizeStart(epochStartTimestamp, epochPeriod, revealPeriod, epoch);
        let epochFinalizeResponse = await finalizePriceEpochWithResult(signers[0], ftso, epoch);
        logger.log(`epoch finalization, ${ len }`);

        // Print epoch submission prices
        let resVoteInfo = await ftso.getEpochVotes(epoch);
        testExample.weightRatio = await getWeightRatio(ftso, epoch, resVoteInfo);
        prettyPrintVoteInfo(epoch, resVoteInfo, testExample.weightRatio!, logger);
        
        // Print results                
        let res = await ftso.getFullEpochReport(epoch);
        prettyPrintEpochResult(epoch, res, resVoteInfo, testExample.weightRatio!, logger);
        let voterRes = toEpochResult(res, resVoteInfo);
        let testCase = {
            example: testExample,
            targetResult: resultsFromTestData(testExample, signers.slice(0, len).map(signer => signer.address), 113e5, 0),
            testResult: updateWithRewardedVotesInfo(voterRes, epochFinalizeResponse)
        } as TestCase;
    
        // Test results
        checkTestCase(testCase);
    });

    /**
     * Purpose
     * An FTSO can fetch real vote power and compute price correctly from 10 submitters. 
     * Scenario
     * 10 data providers (with wnat tokens - equal all the time)
     * Run two price epoch
     */
    it(`10 submitters - 2 rounds of submit and reveal with equal weights`, async function () {
        const epochStartTimestamp: number = 1;
        const signers: SignerWithAddress[] = await ethers.getSigners();

        const epochPeriod = 50;
        const revealPeriod = 25;

        let {natToken, assetToken, ftso} = await deployContracts(signers[0], epochStartTimestamp, epochPeriod, revealPeriod);

        const natWeights: number[] = [20e5, 10e5, 15e5, 5e5, 25e5, 3e5, 8e5, 9e5, 6e5, 12e5];
        const prices: number[] = [5, 11, 13, 9, 6, 1, 2, 3, 4, 5];
        const prices2: number[] = [6, 10, 8, 5, 9, 5, 4, 3, 6, 5];

        for (let i = 0; i < natWeights.length; i++) {
            await natToken.connect(signers[i]).deposit({value: natWeights[i]});
        }

        let blockNumber = await ethers.provider.getBlockNumber();
        await ftso.setVotePowerBlock(blockNumber);

        let testExample: TestExample = {prices: prices, weightsNat: natWeights, weightsAsset: [0,0,0,0,0,0,0,0,0,0]};
        let testExample2: TestExample = {prices: prices2, weightsNat: natWeights, weightsAsset: [0,0,0,0,0,0,0,0,0,0]};

        let logger = new TestExampleLogger(testExample);
        let len = testExample.prices.length;
        
        logger.log(`SUBMIT PRICE 1 - 10`)
        let epoch = await moveFromCurrentToNextEpochStart(epochStartTimestamp, epochPeriod);
        await submitPrice(epoch, signers, ftso, testExample.prices);

        await ftso.initializeCurrentEpochStateForReveal(1000, false);

        logger.log(`REVEAL PRICE 1 - 10`)
        await moveToRevealStart(epochStartTimestamp, epochPeriod, epoch);
        await revealPrice(signers, ftso, testExample.prices, epoch);
        
        logger.log(`SUBMIT PRICE 2 - 10`)
        await submitPrice(epoch + 1, signers, ftso, testExample2.prices);
        
        // Finalize
        await moveToFinalizeStart(epochStartTimestamp, epochPeriod, revealPeriod, epoch);
        let epochFinalizeResponse = await finalizePriceEpochWithResult(signers[0], ftso, epoch);
        logger.log(`epoch finalization 1, ${ len }`);

        // Print epoch submission prices
        let resVoteInfo = await ftso.getEpochVotes(epoch);
        testExample.weightRatio = await getWeightRatio(ftso, epoch, resVoteInfo);
        prettyPrintVoteInfo(epoch, resVoteInfo, testExample.weightRatio!, logger);
        
        // Print results                
        let res = await ftso.getFullEpochReport(epoch);
        prettyPrintEpochResult(epoch, res, resVoteInfo, testExample.weightRatio!, logger);
        let voterRes = toEpochResult(res, resVoteInfo);
        let testCase = {
            example: testExample,
            targetResult: resultsFromTestData(testExample, signers.slice(0, len).map(signer => signer.address)),
            testResult: updateWithRewardedVotesInfo(voterRes, epochFinalizeResponse)
        } as TestCase;
    
        // Test results
        checkTestCase(testCase);

        await ftso.initializeCurrentEpochStateForReveal(1000, false);

        logger.log(`REVEAL PRICE 2 - 10`)
        await moveToRevealStart(epochStartTimestamp, epochPeriod, epoch+1);
        await revealPrice(signers, ftso, testExample2.prices, epoch+1);
        
        // Finalize 2
        await moveToFinalizeStart(epochStartTimestamp, epochPeriod, revealPeriod, epoch+1);
        let epochFinalizeResponse2 = await finalizePriceEpochWithResult(signers[0], ftso, epoch+1);
        logger.log(`epoch finalization, ${ len }`);

        // Print epoch submission prices
        let resVoteInfo2 = await ftso.getEpochVotes(epoch+1) as any;
        testExample2.weightRatio = await getWeightRatio(ftso, epoch+1, resVoteInfo2);
        prettyPrintVoteInfo(epoch+1, resVoteInfo2, testExample2.weightRatio!, logger);
        
        // Print results 2
        let res2 = await ftso.getFullEpochReport(epoch+1);
        prettyPrintEpochResult(epoch+1, res2, resVoteInfo2, testExample2.weightRatio!, logger);
        let voterRes2 = toEpochResult(res2, resVoteInfo2);
        let testCase2 = {
            example: testExample2,
            targetResult: resultsFromTestData(testExample2, signers.slice(0, len).map(signer => signer.address)),
            testResult: updateWithRewardedVotesInfo(voterRes2, epochFinalizeResponse2)
        } as TestCase;
    
        // Test results 2
        checkTestCase(testCase2);
    });

    /**
     * Purpose
     * An FTSO can fetch real vote power and compute price correctly from 10 submitters. 
     * Scenario
     * 10 data providers (with wnat tokens - different vote power)
     * Run two price epoch
     */
    it(`10 submitters - 2 rounds of submit and reveal with different weights - update votePowerBlock`, async function () {
        const epochStartTimestamp: number = 1;
        const signers: SignerWithAddress[] = await ethers.getSigners();

        const epochPeriod = 70;
        const revealPeriod = 35;

        let {natToken, assetToken, ftso} = await deployContracts(signers[0], epochStartTimestamp, epochPeriod, revealPeriod);

        const natWeights: number[] = [20e5, 10e5, 15e5, 5e5, 25e5, 3e5, 8e5, 9e5, 6e5, 12e5];
        const prices: number[] = [5, 11, 13, 9, 6, 1, 2, 3, 4, 5];
        
        for (let i = 0; i < natWeights.length; i++) {
            await natToken.connect(signers[i]).deposit({value: natWeights[i]});
        }
        
        let blockNumber = await ethers.provider.getBlockNumber();
        await ftso.setVotePowerBlock(blockNumber);

        let testExample: TestExample = {prices: prices, weightsNat: natWeights, weightsAsset: [0,0,0,0,0,0,0,0,0,0]};
        
        let logger = new TestExampleLogger(testExample);
        let len = testExample.prices.length;
        
        logger.log(`SUBMIT PRICE 1 - 10`)
        let epoch = await moveFromCurrentToNextEpochStart(epochStartTimestamp, epochPeriod);
        await submitPrice(epoch, signers, ftso, testExample.prices);
        
        await ftso.initializeCurrentEpochStateForReveal(1000, false);

        logger.log(`REVEAL PRICE 1 - 10`)
        await moveToRevealStart(epochStartTimestamp, epochPeriod, epoch);
        await revealPrice(signers, ftso, testExample.prices, epoch);

        const natWeights2: number[] = [50e5, 5e5, 18e5, 12e5, 25e5, 3e5, 8e5, 12e5, 5e5, 16e5];
        for (let i = 0; i < natWeights2.length; i++) {
            if (natWeights[i] > natWeights2[i]) {
                await natToken.connect(signers[i]).withdraw(natWeights[i]-natWeights2[i]);
            } else if (natWeights[i] < natWeights2[i]) {
                await natToken.connect(signers[i]).deposit({value: natWeights2[i] - natWeights[i]});
            }
        }
        
        let blockNumber2 = await ethers.provider.getBlockNumber();
        await ftso.setVotePowerBlock(blockNumber2);
        
        const prices2: number[] = [6, 10, 8, 5, 9, 5, 4, 3, 6, 5];
        let testExample2: TestExample = {prices: prices2, weightsNat: natWeights2, weightsAsset: [0,0,0,0,0,0,0,0,0,0]};
        
        logger.log(`SUBMIT PRICE 2 - 10`)
        await submitPrice(epoch + 1, signers, ftso, testExample2.prices);
        
        // Finalize
        await moveToFinalizeStart(epochStartTimestamp, epochPeriod, revealPeriod, epoch);
        let epochFinalizeResponse = await finalizePriceEpochWithResult(signers[0], ftso, epoch);
        logger.log(`epoch finalization 1, ${ len }`);

        // Print epoch submission prices
        let resVoteInfo = await ftso.getEpochVotes(epoch);
        testExample.weightRatio = await getWeightRatio(ftso, epoch, resVoteInfo);
        prettyPrintVoteInfo(epoch, resVoteInfo, testExample.weightRatio!, logger);
        
        // Print results                
        let res = await ftso.getFullEpochReport(epoch);
        prettyPrintEpochResult(epoch, res, resVoteInfo, testExample.weightRatio!, logger);
        let voterRes = toEpochResult(res, resVoteInfo);
        let testCase = {
            example: testExample,
            targetResult: resultsFromTestData(testExample, signers.slice(0, len).map(signer => signer.address)),
            testResult: updateWithRewardedVotesInfo(voterRes, epochFinalizeResponse)
        } as TestCase;
    
        // Test results
        checkTestCase(testCase);

        await ftso.initializeCurrentEpochStateForReveal(1000, false);

        logger.log(`REVEAL PRICE 2 - 10`)
        await moveToRevealStart(epochStartTimestamp, epochPeriod, epoch+1);
        await revealPrice(signers, ftso, testExample2.prices, epoch+1);
        
        // Finalize 2
        await moveToFinalizeStart(epochStartTimestamp, epochPeriod, revealPeriod, epoch+1);
        let epochFinalizeResponse2 = await finalizePriceEpochWithResult(signers[0], ftso, epoch+1);
        logger.log(`epoch finalization 2, ${ len }`);

        // Print epoch submission prices
        let resVoteInfo2 = await ftso.getEpochVotes(epoch+1) as any;
        testExample2.weightRatio = await getWeightRatio(ftso, epoch+1, resVoteInfo2);
        prettyPrintVoteInfo(epoch+1, resVoteInfo2, testExample2.weightRatio!, logger);
        
        // Print results 2
        let res2 = await ftso.getFullEpochReport(epoch+1);
        prettyPrintEpochResult(epoch+1, res2, resVoteInfo2, testExample2.weightRatio!, logger);
        let voterRes2 = toEpochResult(res2, resVoteInfo2);
        let testCase2 = {
            example: testExample2,
            targetResult: resultsFromTestData(testExample2, signers.slice(0, len).map(signer => signer.address)),
            testResult: updateWithRewardedVotesInfo(voterRes2, epochFinalizeResponse2)
        } as TestCase;
    
        // Test results 2
        checkTestCase(testCase2);
    });
});
