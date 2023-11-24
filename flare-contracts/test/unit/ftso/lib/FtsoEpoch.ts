import { expect } from "chai";
import { contract } from "hardhat";
import { FtsoEpochMockContract, FtsoEpochMockInstance, MockContractContract, MockContractInstance, VPTokenContract } from "../../../../typechain-truffle";
import { moveFromCurrentToNextEpochStart } from "../../../utils/FTSO-test-utils";
import { increaseTimeTo, toBN } from "../../../utils/test-helpers";

const getTestFile = require('../../../utils/constants').getTestFile;
const FtsoEpoch = artifacts.require("FtsoEpochMock") as FtsoEpochMockContract;
const VpToken = artifacts.require("VPToken") as VPTokenContract;
const MockVpToken = artifacts.require("MockContract") as MockContractContract;
import {expectRevert} from '@openzeppelin/test-helpers';


contract(`FtsoEpoch.sol; ${getTestFile(__filename)};  Ftso epoch unit tests`, async accounts => {
    // contains a fresh contract for each test
    let ftsoEpoch: FtsoEpochMockInstance
    let mockVpToken: MockContractInstance;
    let mockVpToken2: MockContractInstance;
    let mockVpToken3: MockContractInstance;

    // Do clean unit tests by spinning up a fresh contract for each test
    beforeEach(async () => {
        ftsoEpoch = await FtsoEpoch.new();
        mockVpToken = await MockVpToken.new();
        mockVpToken2 = await MockVpToken.new();
        mockVpToken3 = await MockVpToken.new();

        await ftsoEpoch.setAssetNorm(mockVpToken.address, 3);
        await ftsoEpoch.setAssetNorm(mockVpToken2.address, 3);
        await ftsoEpoch.setAssetNorm(mockVpToken3.address, 3);

        // uint256 _maxVotePowerNatThresholdFraction,
        // uint256 _maxVotePowerAssetThresholdFraction,
        // uint256 _lowAssetUSDThreshold,
        // uint256 _highAssetUSDThreshold,
        // uint256 _highAssetTurnoutThresholdBIPS,
        // uint256 _lowNatTurnoutThresholdBIPS,
        // uint256 _elasticBandRewardBIPS,
        // address[] memory _trustedAddresses
        await ftsoEpoch.configureEpochs(1, 2, 1000, 10000, 50, 1500, 0, 0, []);
    });

    it(`Should create new epoch`, async () => {
        await ftsoEpoch.initializeInstanceForReveal(1, 50, 40, [mockVpToken.address], [60000], [2]);
        const epoch = await ftsoEpoch.getEpochInstance(1);
        expect(epoch.circulatingSupplyNat).to.equals('50');
        expect(epoch.votePowerNat).to.equals('40');
        expect(epoch.votePowerAsset).to.equals('120');
        expect(epoch.maxVotePowerNat).to.equals('40');
        expect(epoch.maxVotePowerAsset).to.equals('60');
        expect(epoch.highAssetTurnoutThresholdBIPS).to.equals('50');
        expect(epoch.lowNatTurnoutThresholdBIPS).to.equals('1500');
    });

    it(`Should add vote to epoch`, async () => {
        await ftsoEpoch.initializeInstanceForReveal(1, 50, 40, [mockVpToken.address], [60000], [2]);
        // _epochId, _voteId, _votePowerNat, _votePowerAsset, _random
        await ftsoEpoch.addVote(1, accounts[1], 25, 20, 120, {from: accounts[1]});
        const epoch = await ftsoEpoch.getEpochInstance(1);
        expect(epoch.voteCount).to.equals('1');
        expect(epoch.accumulatedVotePowerNat).to.equals('25');
        // expect(epoch.accumulatedVotePowerAsset).to.equals('20');
    });

    it(`Should set voter vote id correctly`, async () => {
        await ftsoEpoch.initializeInstanceForReveal(1, 50, 40, [mockVpToken.address], [60000], [2]);
        // _epochId, _voteId, _votePowerNat, _votePowerAsset, _random
        await ftsoEpoch.addVote(1, accounts[1], 25, 20, 120, {from: accounts[1]});
        await ftsoEpoch.addVote(1, accounts[2], 25, 20, 120, { from: accounts[2] });
        expect((await ftsoEpoch.getVoterVoteId(1, {from: accounts[1]})).toNumber()).to.equals(1);
        expect((await ftsoEpoch.getVoterVoteId(1, {from: accounts[2]})).toNumber()).to.equals(2);
        expect((await ftsoEpoch.getVoterVoteId(2, {from: accounts[1]})).toNumber()).to.equals(0);
    });

    it(`Should sum vote power of voters correctly`, async () => {
        await ftsoEpoch.initializeInstanceForReveal(1, 50, 40, [mockVpToken.address], [60000], [2]);
        // _epochId, _voteId, _votePowerNat, _votePowerAsset, _random
        await ftsoEpoch.addVote(1, accounts[1], 5, 20, 180, {from: accounts[1]});
        await ftsoEpoch.addVote(1, accounts[2], 15, 10, 170, {from: accounts[2]});
        await ftsoEpoch.addVote(1, accounts[3], 10, 0, 160, {from: accounts[3]});
        const epoch = await ftsoEpoch.getEpochInstance(1);
        expect(epoch.voteCount).to.equals('3');
        expect(epoch.accumulatedVotePowerNat).to.equals('30');
        // expect(epoch.accumulatedVotePowerAsset).to.equals('30');
    });

    it(`Should not change the epoch instance if vote is added to a new epoch instance`, async () => {
        await ftsoEpoch.initializeInstanceForReveal(1, 50, 40, [mockVpToken.address], [60000], [2]);
        // _epochId, _voteId, _votePowerNat, _votePowerAsset, _random
        await ftsoEpoch.addVote(1, accounts[1], 25, 20, 120, {from: accounts[1]});
        await ftsoEpoch.initializeInstanceForReveal(2, 40, 30, [mockVpToken.address], [60000], [2]);
        // _epochId, _voteId, _votePowerNat, _votePowerAsset, _random
        await ftsoEpoch.addVote(2, accounts[1], 28, 18, 130, {from: accounts[1]});

        const epoch = await ftsoEpoch.getEpochInstance(1);
        expect(epoch.voteCount).to.equals('1');
        expect(epoch.accumulatedVotePowerNat).to.equals('25');
        // expect(epoch.accumulatedVotePowerAsset).to.equals('20');
    });

    it(`Should change state of a new epoch only`, async () => {
        await ftsoEpoch.initializeInstanceForReveal(1, 50, 40, [mockVpToken.address], [60000], [3]);
        await ftsoEpoch.configureEpochs(2, 1, 1000, 10000, 40, 1400, 0, 0, []);
        await ftsoEpoch.initializeInstanceForReveal(2, 70, 60, [mockVpToken.address], [50000], [2]);

        const epoch = await ftsoEpoch.getEpochInstance(1);
        expect(epoch.circulatingSupplyNat).to.equals('50');
        expect(epoch.votePowerNat).to.equals('40');
        expect(epoch.votePowerAsset).to.equals('180');
        expect(epoch.maxVotePowerNat).to.equals('40');
        expect(epoch.maxVotePowerAsset).to.equals('90');
        expect(epoch.highAssetTurnoutThresholdBIPS).to.equals('50');
        expect(epoch.lowNatTurnoutThresholdBIPS).to.equals('1500');

        const epoch2 = await ftsoEpoch.getEpochInstance(2);
        expect(epoch2.circulatingSupplyNat).to.equals('70');
        expect(epoch2.votePowerNat).to.equals('60');
        expect(epoch2.votePowerAsset).to.equals('100');
        expect(epoch2.maxVotePowerNat).to.equals('30');
        expect(epoch2.maxVotePowerAsset).to.equals('100');
        expect(epoch2.highAssetTurnoutThresholdBIPS).to.equals('40');
        expect(epoch2.lowNatTurnoutThresholdBIPS).to.equals('1400');
    });

    it(`Should calculate asset base weight ratio correctly`, async () => {
        let assetBaseWeightRatio;
        assetBaseWeightRatio = await ftsoEpoch.getAssetBaseWeightRatio(999);
        expect(assetBaseWeightRatio.toNumber()).to.equals(0);
        
        assetBaseWeightRatio = await ftsoEpoch.getAssetBaseWeightRatio(10000);
        expect(assetBaseWeightRatio.toNumber()).to.equals(5000);

        assetBaseWeightRatio = await ftsoEpoch.getAssetBaseWeightRatio(10001);
        expect(assetBaseWeightRatio.toNumber()).to.equals(5000);

        assetBaseWeightRatio = await ftsoEpoch.getAssetBaseWeightRatio(1000);
        expect(assetBaseWeightRatio.toNumber()).to.equals(500);

        assetBaseWeightRatio = await ftsoEpoch.getAssetBaseWeightRatio(1500);
        expect(assetBaseWeightRatio.toNumber()).to.equals(750);

        assetBaseWeightRatio = await ftsoEpoch.getAssetBaseWeightRatio(5500);
        expect(assetBaseWeightRatio.toNumber()).to.equals(2750);

        assetBaseWeightRatio = await ftsoEpoch.getAssetBaseWeightRatio(9500);
        expect(assetBaseWeightRatio.toNumber()).to.equals(4750);
    });

    it(`Should calculate weight ratio correctly`, async () => {
        let weightRatio;
        //_assetVotePowerUSD == 0
        await ftsoEpoch.initializeInstanceForReveal(1, 50, 40, [mockVpToken.address], [0], [3]);
        weightRatio = await ftsoEpoch.getWeightRatio(1, 0, 0);
        expect(weightRatio.toNumber()).to.equals(0);
        
        //_assetVotePowerUSD < _state.lowAssetUSDThreshold
        await ftsoEpoch.initializeInstanceForReveal(2, 50, 40, [mockVpToken.address], [60000], [3]);
        weightRatio = await ftsoEpoch.getWeightRatio(2, 0, 0);
        expect(weightRatio.toNumber()).to.equals(0);

        //turnout >= _state.highAssetTurnoutThresholdBIPS
        await ftsoEpoch.initializeInstanceForReveal(3, 50, 40, [mockVpToken.address], [500000], [3]);
        await ftsoEpoch.addVote(3, accounts[0], 5, 600, 88);
        weightRatio = await ftsoEpoch.getWeightRatio(3, 125000000000, 400000000000);
        expect(weightRatio.toNumber()).to.equals(750);

        //turnout < _state.highAssetTurnoutThresholdBIPS
        await ftsoEpoch.initializeInstanceForReveal(4, 50, 40, [mockVpToken.address], [500000], [3]);
        await ftsoEpoch.addVote(4, accounts[0], 5, 6, 89);
        weightRatio = await ftsoEpoch.getWeightRatio(4, 125000000000, 4000000000);
        expect(weightRatio.toNumber()).to.equals(600);

        //_assetVotePowerUSD >= _state.highAssetUSDThreshold)
        await ftsoEpoch.initializeInstanceForReveal(5, 50, 40, [mockVpToken.address], [50000000], [3]);
        await ftsoEpoch.addVote(5, accounts[0], 5, 90000, 86);
        weightRatio = await ftsoEpoch.getWeightRatio(5, 125000000000, 600000000000);
        expect(weightRatio.toNumber()).to.equals(5000);
    });

    it("Should set assets correctly", async () => {
        await ftsoEpoch.setAssets(1, [mockVpToken.address, mockVpToken2.address, mockVpToken3.address], [2e6, 6e8, 3e7], [3, 5, 7]);
        const epoch = await ftsoEpoch.getEpochInstance(1);
        expect(epoch.assets[0]).to.equals(mockVpToken.address);
        expect(epoch.assets[1]).to.equals(mockVpToken2.address);
        expect(epoch.assets[2]).to.equals(mockVpToken3.address);

        expect(epoch.assetWeightedPrices[0]).to.equals('55');
        expect(epoch.assetWeightedPrices[1]).to.equals('46641');
        expect(epoch.assetWeightedPrices[2]).to.equals('4570');

        expect(epoch.votePowerAsset).to.equals('2812181');
    });

    it("Should set assets correctly - zero prices", async () => {
        await ftsoEpoch.setAssets(1, [mockVpToken.address, mockVpToken2.address, mockVpToken3.address], [2e6, 6e8, 3e7], [0, 0, 0]);
        const epoch = await ftsoEpoch.getEpochInstance(1);
        expect(epoch.assets[0]).to.equals(mockVpToken.address);
        expect(epoch.assets[1]).to.equals(mockVpToken2.address);
        expect(epoch.assets[2]).to.equals(mockVpToken3.address);

        expect(epoch.assetWeightedPrices[0]).to.equals('0');
        expect(epoch.assetWeightedPrices[1]).to.equals('0');
        expect(epoch.assetWeightedPrices[2]).to.equals('0');

        expect(epoch.votePowerAsset).to.equals('0');
    });

    it("Should compute weights correctly", async () => {
        let highAssetTurnoutThresholdBIPS = 9000;
        await ftsoEpoch.configureEpochs(1, 2, 1000, 10000, highAssetTurnoutThresholdBIPS, 1500, 0, 0, []);
        await ftsoEpoch.initializeInstanceForReveal(1, 500, 400, [mockVpToken.address], [700000], [11]);
        await ftsoEpoch.addVote(1, accounts[0], 50, 400000, 85);
        await ftsoEpoch.addVote(1, accounts[0], 70, 200000, 86);
        let weightNat1 = Math.floor(50/400*1e12);//125.000.000.000
        let weightNat2 = Math.floor(70/400*1e12);//175.000.000.000
        let weightNatSum = weightNat1 + weightNat2;
        let assetVotePower = Math.floor(700000*11/1e3); // 7700
        let baseWeightRatio = Math.floor(4500*(assetVotePower-1000)/(10000-1000)) + 500;//3850;
        let assetVotePower1 = Math.floor(400000*11/1e3);
        let assetVotePower2 = Math.floor(200000*11/1e3);
        let weightAsset1 = Math.floor(assetVotePower1/assetVotePower*1e12);//571.428.571.428
        let weightAsset2 = Math.floor(assetVotePower2/assetVotePower*1e12);//285.714.285.714
        let weightAssetSum = weightAsset1 + weightAsset2;//857.142.857.142
        const weights = await ftsoEpoch.computeWeights(1,[weightNat1,weightNat2], [weightAsset1,weightAsset2]);
        let turnout = Math.floor(weightAssetSum/100000000);
        let weightRatio = Math.floor(baseWeightRatio*turnout/highAssetTurnoutThresholdBIPS);

        let weightNatShare = 10000-weightRatio;
        let weightAssetShare = weightRatio;

        let weight1 = Math.floor(weightNatShare*weightNat1/weightNatSum*100000000)+
            Math.floor(weightAssetShare*weightAsset1/weightAssetSum*100000000);
        let weight2 = Math.floor(weightNatShare*weightNat2/weightNatSum*100000000)+
            Math.floor(weightAssetShare*weightAsset2/weightAssetSum*100000000);

        expect(weights[0].toNumber()).to.equals(weight1);
        expect(weights[1].toNumber()).to.equals(weight2);

        const epoch = await ftsoEpoch.getEpochInstance(1);
        expect(epoch.baseWeightRatio).to.equals(baseWeightRatio.toString());

        expect((await ftsoEpoch.getWeightRatio(1, weightNatSum, weightAssetSum)).toNumber()).to.equals(weightRatio);
    });

    it("Should compute weights correctly - zero asset vote power sum", async () => {
        await ftsoEpoch.initializeInstanceForReveal(1, 500, 400, [mockVpToken.address], [700000], [11]);
        await ftsoEpoch.addVote(1, accounts[0], 50, 0, 85);
        await ftsoEpoch.addVote(1, accounts[0], 70, 0, 86);
        let weightNat1 = Math.floor(50/400*1e12);
        let weightNat2 = Math.floor(70/400*1e12);
        let weightNatSum = weightNat1 + weightNat2;
        const weights = await ftsoEpoch.computeWeights(1,[weightNat1,weightNat2], [0,0]);

        expect(weights[0].toNumber()).to.equals(Math.floor(weightNat1/weightNatSum*1e12));
        expect(weights[1].toNumber()).to.equals(Math.floor(weightNat2/weightNatSum*1e12));

        const epoch = await ftsoEpoch.getEpochInstance(1);
        expect(epoch.baseWeightRatio).to.equals('3850');
        expect((await ftsoEpoch.getWeightRatio(1, weightNatSum, 0)).toNumber()).to.equals(0);
    });

    it("Should compute weights correctly - zero nat vote power sum", async () => {
        await ftsoEpoch.initializeInstanceForReveal(1, 500, 400, [mockVpToken.address], [700000], [11]);
        await ftsoEpoch.addVote(1, accounts[0], 0, 400000, 85);
        await ftsoEpoch.addVote(1, accounts[0], 0, 200000, 86);

        let weightAsset1 = Math.floor(400000/700000*1e12*11/1e3);
        let weightAsset2 = Math.floor(200000/700000*1e12*11/1e3);
        let weightAssetSum = weightAsset1 + weightAsset2;
        const weights = await ftsoEpoch.computeWeights(1,[0,0], [weightAsset1,weightAsset2]);

        expect(weights[0].toNumber()).to.equals(Math.floor(weightAsset1/weightAssetSum*1e12));
        expect(weights[1].toNumber()).to.equals(Math.floor(weightAsset2/weightAssetSum*1e12));

        const epoch = await ftsoEpoch.getEpochInstance(1);
        expect(epoch.baseWeightRatio).to.equals('3850');
        expect((await ftsoEpoch.getWeightRatio(1, 0, weightAssetSum)).toNumber()).to.equals(10000);
    });

    it("Should get trusted addresses votes correctly", async () => {
        await ftsoEpoch.configureEpochs(1, 2, 1000, 10000, 50, 1500, 0, 0, [accounts[1]]);
        await ftsoEpoch.initializeInstanceForReveal(1, 500, 400, [mockVpToken.address], [700000], [11]);
        await ftsoEpoch.addVote(1, accounts[0], 50, 400000, 85);
        await ftsoEpoch.addVote(1, accounts[1], 70, 200000, 86);

        let epoch = await ftsoEpoch.getEpochInstance(1);
        expect(epoch.trustedVotes.length).to.equals(1);
        expect(epoch.trustedVotes[0]).to.equals('86');
    });
});
