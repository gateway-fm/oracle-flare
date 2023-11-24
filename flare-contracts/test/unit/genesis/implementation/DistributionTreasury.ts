import { constants, expectRevert, time } from '@openzeppelin/test-helpers';
import { DistributionTreasuryInstance, SuicidalMockInstance } from "../../../../typechain-truffle";
import { toBN } from '../../../utils/test-helpers';

const getTestFile = require('../../../utils/constants').getTestFile;

const DistributionTreasury = artifacts.require("DistributionTreasury");
const SuicidalMock = artifacts.require("SuicidalMock");
const DistributionToDelegatorsMock = artifacts.require("DistributionToDelegatorsMock");

const ONLY_GOVERNANCE_MSG = "only governance";
const ERR_ONLY_GOVERNANCE_OR_DISTRIBUTION = "only governance or distribution";
const ERR_DISTRIBUTION_ONLY = "distribution only";
const ERR_TOO_OFTEN = "too often";
const ERR_TOO_MUCH = "too much";
const ERR_SEND_FUNDS_FAILED = "send funds failed";
const ERR_ADDRESS_ZERO = "address zero";

contract(`DistributionTreasury.sol; ${getTestFile(__filename)}; DistributionTreasury unit tests`, async accounts => {
    let treasury: DistributionTreasuryInstance;
    let mockSuicidal: SuicidalMockInstance;
    const governance = accounts[10];

    beforeEach(async() => {
        treasury = await DistributionTreasury.new(governance);
        mockSuicidal = await SuicidalMock.new(treasury.address);
    });

    describe("methods", async() => {

        it("Should only receive funds from governance or distribution", async () => {
            // Assemble
            expect((await web3.eth.getBalance(treasury.address)).toString()).to.equals("0");
            await treasury.setDistributionContract(accounts[100], { from: governance });
            // Act
            await web3.eth.sendTransaction({ from: governance, to: treasury.address, value: toBN(1000) });
            await web3.eth.sendTransaction({ from: accounts[100], to: treasury.address, value: toBN(500) });
            const tx = web3.eth.sendTransaction({ from: accounts[0], to: treasury.address, value: toBN(1500) });
            // Assert
            expect((await web3.eth.getBalance(treasury.address)).toString()).to.equals("1500");
            await expectRevert(tx, ERR_ONLY_GOVERNANCE_OR_DISTRIBUTION);
          });

        it("Should fail calling setDistributionContract from non-governance", async() => {
            let tx = treasury.setDistributionContract(accounts[100]);
            await expectRevert(tx, ONLY_GOVERNANCE_MSG);
        });

        it("Should update distribution contract", async() => {
            await treasury.setDistributionContract(accounts[100], { from: governance });
            expect(await treasury.distribution()).to.equals(accounts[100]);
            await treasury.setDistributionContract( accounts[101], { from: governance });
            expect(await treasury.distribution()).to.equals(accounts[101]);
        });

        it("Should fail calling setDistributionContract with zero address", async() => {
            let tx = treasury.setDistributionContract(constants.ZERO_ADDRESS, { from: governance });
            await expectRevert(tx, ERR_ADDRESS_ZERO);
        });

        it("Should fail calling pullFunds from non-distribution address", async() => {
            let tx = treasury.pullFunds(100);
            await expectRevert(tx, ERR_DISTRIBUTION_ONLY);
        });

        it("Should test cases for pullFunds function - distribution to delegators", async() => {
            // sneak wei into DistributionTreasury
            await web3.eth.sendTransaction({ from: accounts[0], to: mockSuicidal.address, value: 10**6 });
            await mockSuicidal.die();

            let distribution = accounts[100];
            let maxpull = 10**6;
            await treasury.setDistributionContract(distribution, { from: governance });

            // pull too much funds
            const MAX_PULL_AMOUNT_WEI = await treasury.MAX_PULL_AMOUNT_WEI();
            let tx1 = treasury.pullFunds(MAX_PULL_AMOUNT_WEI.addn(1), { from: distribution });
            await expectRevert(tx1, ERR_TOO_MUCH);

            // pull half the funds
            await treasury.pullFunds(Math.floor(maxpull / 2), { from: distribution });
            let lastPull = await treasury.lastPullTs();
            let now = await time.latest()
            expect(lastPull.toNumber()).to.equal(now.toNumber());

            // pull half the funds and fail
            let tx2 = treasury.pullFunds(Math.floor(maxpull / 2), { from: distribution });
            await expectRevert(tx2, ERR_TOO_OFTEN);

            // pull the other half after MAX_PULL_FREQUENCY_SEC
            await time.increaseTo(now.addn(29 * 60 * 60 * 24));
            await treasury.pullFunds(Math.floor(maxpull / 2), { from: distribution });
            let lastPull2 = await treasury.lastPullTs();
            let now2 = await time.latest()
            expect(lastPull2.toNumber()).to.equal(now2.toNumber());
        });

        it("Should update lastPull timestamp even if pulling 0 funds", async() => {
            // sneak wei into DistributionTreasury
            await web3.eth.sendTransaction({ from: accounts[0], to: mockSuicidal.address, value: 10**6 });
            await mockSuicidal.die();

            let distribution = accounts[101];
            await treasury.setDistributionContract(distribution, { from: governance });

            // pull 0 funds
            await treasury.pullFunds(0, { from: distribution });
            let lastPull = await treasury.lastPullTs();
            let now = await time.latest()
            expect(lastPull.toNumber()).to.equal(now.toNumber());
        });

        it("Should revert at pullFunds if receive method is not implemented", async() => {
            // sneak wei into DistributionTreasury
            await web3.eth.sendTransaction({ from: accounts[0], to: mockSuicidal.address, value: 10**6 });
            await mockSuicidal.die();

            let distribution = await DistributionToDelegatorsMock.new(treasury.address);
            let maxpull = 10**6;
            await treasury.setDistributionContract(distribution.address, { from: governance });

            await expectRevert(distribution.pullFunds(maxpull), ERR_SEND_FUNDS_FAILED);
        });
    });
});
