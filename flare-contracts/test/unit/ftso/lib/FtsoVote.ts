import { expect } from "chai";
import { artifacts, contract } from "hardhat";
import { FtsoVoteMockContract, FtsoVoteMockInstance } from "../../../../typechain-truffle";

const getTestFile = require('../../../utils/constants').getTestFile;
const FtsoVote = artifacts.require("FtsoVoteMock") as FtsoVoteMockContract;

contract(`FtsoVote.sol; ${getTestFile(__filename)};  Ftso vote unit tests`, async accounts => {
    // contains a fresh contract for each test
    let ftsoVote: FtsoVoteMockInstance;

    // Do clean unit tests by spinning up a fresh contract for each test
    beforeEach(async () => {
        ftsoVote = await FtsoVote.new();
    });

    it(`Should set vote price correctly`, async () => {
        let vote = await ftsoVote.createInstance(accounts[0], 1, 2, 3, 4, 20);
        expect(vote.price).to.equals('20');
    });

    it(`Should set vote weight native token correctly`, async () => {
        let vote = await ftsoVote.createInstance(accounts[0], 1, 2, 3, 4, 20);
        expect(vote.weightNat).to.equals('333333333333');
    });

    it(`Should set vote weight asset correctly`, async () => {
        let vote = await ftsoVote.createInstance(accounts[0], 1, 2, 3, 4, 20);
        expect(vote.weightAsset).to.equals('500000000000');
    });
});
