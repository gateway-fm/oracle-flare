import { constants, expectEvent, expectRevert, time } from '@openzeppelin/test-helpers';
import { FlashLenderMockInstance, FlashLoanMockInstance, MockFtsoInstance, VotingFlashLoanMockInstance, VPTokenInstance, WNatInstance } from "../../../typechain-truffle";
import { increaseTimeTo, submitPriceHash, toBN } from "../../utils/test-helpers";
import { setDefaultVPContract } from "../../utils/token-test-helpers";
const { getTestFile } = require('../../utils/constants');

const FlashLenderMock = artifacts.require("FlashLenderMock");
const FlashLoanMock = artifacts.require("FlashLoanMock");
const VotingFlashLoanMock = artifacts.require("VotingFlashLoanMock");
const Wnat = artifacts.require("WNat");
const Ftso = artifacts.require("MockFtso");
const MockSupply = artifacts.require("MockContract");
const Supply = artifacts.require("Supply");
const MockFtso = artifacts.require("MockFtso");

const NATIVE = toBN(1e18);

const LENDER_AMOUNT = toBN(20).mul(NATIVE);
const AMOUNT = toBN(1).mul(NATIVE);

async function startNewEpoch() {
    await time.advanceBlock();
    let timestamp = await time.latest();
    const epochId = Math.floor(timestamp.toNumber() / 120) + 1;
    await increaseTimeTo(epochId * 120, 'web3');
    return epochId;
}

contract(`FlashLoanMock.sol; ${getTestFile(__filename)}; FlashLoanMock unit tests`, async accounts => {
    let flashLenderMock: FlashLenderMockInstance;
    let flashLoanMock: FlashLoanMockInstance;
    let votingFlashLoanMock: VotingFlashLoanMockInstance;
    let wnat: WNatInstance;
    let vpToken: VPTokenInstance;
    let ftso: MockFtsoInstance;
    let epochId: number;
    
    describe("take a loan", async () => {
        beforeEach(async () => {
            flashLenderMock = await FlashLenderMock.new();
            flashLoanMock = await FlashLoanMock.new(flashLenderMock.address, constants.ZERO_ADDRESS, constants.ZERO_ADDRESS);
            await flashLenderMock.send(LENDER_AMOUNT);
        });

        it("Should take a flash loan", async () => {
            await flashLoanMock.testRequestLoan(AMOUNT);
        })
    });

    describe("vote with real native tokens", async () => {
        const accountAmount = toBN(3).mul(AMOUNT);

        beforeEach(async () => {
            wnat = await Wnat.new(accounts[0], "Wrapped NAT", "WNAT");
            await setDefaultVPContract(wnat, accounts[0]);
            ftso = await MockFtso.new(
                "ATOK",
                5,
                accounts[4],
                wnat.address,
                accounts[10],
                0, 120, 60,
                1,
                1e10,
                35,
                false
            );
            await ftso.configureEpochs( 1, 1, 1000, 10000, 500, 500, 0, 0, [], { from: accounts[10] });
            await ftso.activateFtso(0, 120, 60, { from: accounts[10] });
            // init lender
            flashLenderMock = await FlashLenderMock.new();
            await flashLenderMock.send(LENDER_AMOUNT);
            await time.advanceBlock();
            // give dummy user wnats to create vote threshold
            await flashLenderMock.donateTo(accounts[1], accountAmount);
            await wnat.deposit({ from: accounts[1], value: accountAmount });  // mint wnat for contract
        });

        it("Should be able to vote with donated native tokens", async () => {
            const amount = toBN(5).mul(AMOUNT);
            flashLoanMock = await FlashLoanMock.new(flashLenderMock.address, wnat.address, ftso.address);
            await flashLenderMock.donateTo(flashLoanMock.address, amount);
            await flashLoanMock.mintWnat(amount);
            // wnats are minted (and block is advanced), so we can take this a vote power block
            const vpBlock = await web3.eth.getBlockNumber();
            // cashing will happen in a new block and won't affect block power
            await flashLoanMock.cashWnat(amount);
            // set vote power block
            await ftso.setVotePowerBlock(vpBlock, { from: accounts[10] });
            // start an epoch
            epochId = await startNewEpoch();
            // vote
            expectEvent(await ftso.submitPriceHash(epochId, submitPriceHash(500, 123, accounts[1]), { from: accounts[1] }),
                "PriceHashSubmitted", { submitter: accounts[1], epochId: toBN(epochId) });
            await flashLoanMock.submitPriceHash(epochId, 380, 234);
            // reveal epoch
            await ftso.initializeCurrentEpochStateForReveal(accountAmount, false, { from: accounts[10] });
            await increaseTimeTo((epochId + 1) * 120, 'web3'); // reveal period start
            // reveals
            expectEvent(await ftso.revealPrice(epochId, 500, 123, { from: accounts[1] }), 
                "PriceRevealed", { voter: accounts[1], epochId: toBN(epochId), price: toBN(500) });
            await flashLoanMock.revealPrice(epochId, 380, 234);
            // finalize price
            await increaseTimeTo((epochId + 1) * 120 + 60, 'web3'); // reveal period end
            expectEvent(await ftso.finalizePriceEpoch(epochId, false, { from: accounts[10] }), 
                "PriceFinalized", { epochId: toBN(epochId), price: toBN(380), finalizationType: toBN(1) });
        });
        
        it("Should not be able to vote with flash loaned native tokens (vote power block equals loan block)", async () => {
            const amount = toBN(2).mul(AMOUNT);
            flashLoanMock = await FlashLoanMock.new(flashLenderMock.address, wnat.address, ftso.address);
            // request flash loan
            await flashLoanMock.testRequestLoan(amount);
            const loanBlock = await web3.eth.getBlockNumber();  // flash loan block
            // set vote power block
            await ftso.setVotePowerBlock(loanBlock, { from: accounts[10] });
            // test
            await tryVoting();
        });

        it("Should not be able to vote with flash loaned native tokens (vote power block just after loan)", async () => {
            const amount = toBN(5).mul(AMOUNT);
            flashLoanMock = await FlashLoanMock.new(flashLenderMock.address, wnat.address, ftso.address);
            // request flash loan
            await flashLoanMock.testRequestLoan(amount);
            const loanBlock = await web3.eth.getBlockNumber();  // flash loan block
            // set vote power block
            await time.advanceBlock();  // to make loanBlock in the past of setVotePowerBlock
            await ftso.setVotePowerBlock(loanBlock + 1, { from: accounts[10] });
            // test
            await tryVoting();
        });

        async function tryVoting() {
            epochId = await startNewEpoch();
            // vote
            expectEvent(await ftso.submitPriceHash(epochId, submitPriceHash(500, 123, accounts[1]), { from: accounts[1] }),
                "PriceHashSubmitted", { submitter: accounts[1], epochId: toBN(epochId) });
            await flashLoanMock.submitPriceHash(epochId, 380, 234);
            // reveal epoch
            await ftso.initializeCurrentEpochStateForReveal(accountAmount, false, { from: accounts[10] });
            await increaseTimeTo((epochId + 1) * 120, 'web3'); // reveal period start
            // reveals
            expectEvent(await ftso.revealPrice(epochId, 500, 123, { from: accounts[1] }),
                "PriceRevealed", { voter: accounts[1], epochId: toBN(epochId), price: toBN(500) });

            const {0: wnatPowerLoan, } = await ftso.getVotePowerOf.call(flashLoanMock.address);
            
            // Loan should hold 0 voting power, but still be able to vote (voter whitelist takes care of this now).
            assert.equal(wnatPowerLoan.toString(), "0");
                
            await flashLoanMock.revealPrice(epochId, 380, 234)
            // finalize price
            await increaseTimeTo((epochId + 1) * 120 + 60, 'web3'); // reveal period end
            // The normal account should outwight loan anyway
            expectEvent(await ftso.finalizePriceEpoch(epochId, false, { from: accounts[10] }),
                "PriceFinalized", { epochId: toBN(epochId), price: toBN(500), finalizationType: toBN(1) });
        }
        
        it("Is able to vote with flash loaned native tokens (reveal during loan), if votePowerBlock is in future (only manager can actually achive that)", async () => {
            const amount = toBN(5).mul(AMOUNT);
            votingFlashLoanMock = await VotingFlashLoanMock.new(flashLenderMock.address, wnat.address, ftso.address);
            // start epoch
            epochId = await startNewEpoch();
            // votes
            await votingFlashLoanMock.submitPriceHash(epochId, 380, 234);
            await votingFlashLoanMock.setVote(epochId, 380, 234);
            expectEvent(await ftso.submitPriceHash(epochId, submitPriceHash(500, 123, accounts[1]), { from: accounts[1] }),
                "PriceHashSubmitted", { submitter: accounts[1], epochId: toBN(epochId) });
            // reveal epoch
            // flash loan (and reveal) will happen in this block + x (x ~ 3), but we can set anything bigger as vote power block
            let lastBlock = await web3.eth.getBlockNumber();
            // would be able to vote with flash loan if votePowerBlock is in future, so it has to be prevented
            await expectRevert.unspecified(ftso.setVotePowerBlock(lastBlock + 1, { from: accounts[10] }));
            await expectRevert.unspecified(ftso.setVotePowerBlock(lastBlock + 100, { from: accounts[10] }));
            lastBlock = await web3.eth.getBlockNumber();
            await ftso.setVotePowerBlock(lastBlock, { from: accounts[10] });    // in the past - ok
            // start reveal
            await ftso.initializeCurrentEpochStateForReveal(accountAmount, false, { from: accounts[10] });
            await increaseTimeTo((epochId + 1) * 120, 'web3'); // reveal period start
            // take loan and vote

            await votingFlashLoanMock.testRequestLoan(amount);

            expectEvent(await ftso.revealPrice(epochId, 500, 123, { from: accounts[1] }),
                "PriceRevealed", { voter: accounts[1], epochId: toBN(epochId), price: toBN(500) });
            // finalize price
            await increaseTimeTo((epochId + 1) * 120 + 60, 'web3'); // reveal period end
            expectEvent(await ftso.finalizePriceEpoch(epochId, false, { from: accounts[10] }),
                "PriceFinalized", { epochId: toBN(epochId), price: toBN(500), finalizationType: toBN(1) });
        });

    });
});
