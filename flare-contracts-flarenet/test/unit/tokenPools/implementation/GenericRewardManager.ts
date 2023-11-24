import { constants, expectEvent, expectRevert } from '@openzeppelin/test-helpers';
import { Contracts } from '../../../../deployment/scripts/Contracts';
import {
    InflationMockInstance, SuicidalMockInstance, ValidatorRewardManagerInstance, WNatContract,
    WNatInstance
} from "../../../../typechain-truffle";
import { compareArrays, encodeContractNames, toBN } from "../../../utils/test-helpers";
import { setDefaultVPContract } from "../../../utils/token-test-helpers";

const getTestFile = require('../../../utils/constants').getTestFile;

const ValidatorRewardManager = artifacts.require("ValidatorRewardManager");
const AttestationProviderRewardManager = artifacts.require("AttestationProviderRewardManager");
const WNAT = artifacts.require("WNat") as WNatContract;
const InflationMock = artifacts.require("InflationMock");
const SuicidalMock = artifacts.require("SuicidalMock");
const GasConsumer = artifacts.require("GasConsumer2");


contract(`GenericRewardManager.sol; ${getTestFile(__filename)}; Generic reward manager unit tests`, async accounts => {
    // contains a fresh contract for each test
    let validatorRewardManager: ValidatorRewardManagerInstance;
    let wNat: WNatInstance;
    let mockInflation: InflationMockInstance;
    let mockSuicidal: SuicidalMockInstance;

    const ADDRESS_UPDATER: string = accounts[16];
    const REWARD_DISTIBUTOR: string = accounts[17];
    const burnAddress = "0x000000000000000000000000000000000000dEaD";

    beforeEach(async () => {
        mockInflation = await InflationMock.new();

        validatorRewardManager = await ValidatorRewardManager.new(
            accounts[0],
            ADDRESS_UPDATER,
            constants.ZERO_ADDRESS
        );

        await mockInflation.setInflationReceiver(validatorRewardManager.address);

        wNat = await WNAT.new(accounts[0], "Wrapped NAT", "WNAT");
        await setDefaultVPContract(wNat, accounts[0]);

        await validatorRewardManager.updateContractAddresses(
            encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, Contracts.WNAT]),
            [ADDRESS_UPDATER, mockInflation.address, wNat.address], {from: ADDRESS_UPDATER});

        await validatorRewardManager.setRewardDistributor(REWARD_DISTIBUTOR);
        
        // set the daily authorized inflation...this proxies call to validator reward manager
        await mockInflation.setDailyAuthorizedInflation(2000000);
        await mockInflation.receiveInflation({ value: "100" });
        
        mockSuicidal = await SuicidalMock.new(validatorRewardManager.address);

        let activate = await validatorRewardManager.activate();
        expectEvent(activate, "RewardManagerActivated", { rewardManager: validatorRewardManager.address });

    });

    async function distributeRewards() {
        return await validatorRewardManager.distributeRewards(
            [accounts[1], accounts[2]],
            [25, 75],
            {from: REWARD_DISTIBUTOR});
    }

    describe("basic", async () => {
        it("Should revert calling activate if contracts are not set", async () => {
            validatorRewardManager = await ValidatorRewardManager.new(
                accounts[0],
                ADDRESS_UPDATER,
                constants.ZERO_ADDRESS
            );

            await expectRevert(validatorRewardManager.activate(), "contract addresses not set");
        });

        it("Should revert calling activate if not from governance", async () => {
            await expectRevert(validatorRewardManager.activate({ from: accounts[1] }), "only governance");
        });

        it("Should deactivate and disable claiming rewards", async () => {
            let deactivate = await validatorRewardManager.deactivate();
            expectEvent(deactivate, "RewardManagerDeactivated", { rewardManager: validatorRewardManager.address });


            await expectRevert(validatorRewardManager.claim(accounts[2], accounts[2], 100, false), "reward manager deactivated");
        });

        it("Should revert calling deactivate if not from governance", async () => {
            await expectRevert(validatorRewardManager.deactivate({ from: accounts[1] }), "only governance");
        });
        
        it("Should revert calling updateContractAddresses if not from address updater", async () => {
            await expectRevert(validatorRewardManager.updateContractAddresses(
                encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, Contracts.WNAT]),
                [ADDRESS_UPDATER, mockInflation.address, wNat.address], {from: accounts[1]}), "only address updater");
        });

        it("Should update WNAT", async () => {
            expect(await validatorRewardManager.wNat()).to.equals(wNat.address);
            await validatorRewardManager.updateContractAddresses(
                encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, Contracts.WNAT]),
                [ADDRESS_UPDATER, mockInflation.address, accounts[8]], {from: ADDRESS_UPDATER});
            expect(await validatorRewardManager.wNat()).to.equals(accounts[8]);
        });

        it("Should revert updating wNAt if setting to address(0)", async () => {
            await expectRevert(validatorRewardManager.updateContractAddresses(
                encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, Contracts.WNAT]),
                [ADDRESS_UPDATER, mockInflation.address, constants.ZERO_ADDRESS], {from: ADDRESS_UPDATER}), "address zero");
        });

        it("Should update inflation", async () => {
            expect(await validatorRewardManager.getInflationAddress()).to.equals(mockInflation.address);
            await validatorRewardManager.updateContractAddresses(
                encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, Contracts.WNAT]),
                [ADDRESS_UPDATER, accounts[8], wNat.address], {from: ADDRESS_UPDATER});
            expect(await validatorRewardManager.getInflationAddress()).to.equals(accounts[8]);
        });

        it("Should issue event when daily authorized inflation is set", async () => {
            const txReceipt = await mockInflation.setDailyAuthorizedInflation(2000000);
            await expectEvent.inTransaction(
                txReceipt.tx,
                validatorRewardManager,
                "DailyAuthorizedInflationSet", {authorizedAmountWei: toBN(2000000)}
            );
        });

        it("Should revert updating inflation if setting to address(0)", async () => {
            await expectRevert(validatorRewardManager.updateContractAddresses(
                encodeContractNames([Contracts.ADDRESS_UPDATER, Contracts.INFLATION, Contracts.WNAT]),
                [ADDRESS_UPDATER, constants.ZERO_ADDRESS, wNat.address], {from: ADDRESS_UPDATER}), "address zero");
        });

        it("Should set old reward manager", async () => {
            validatorRewardManager = await ValidatorRewardManager.new(
                accounts[0],
                ADDRESS_UPDATER,
                accounts[2]
            );

            expect(await validatorRewardManager.oldRewardManager()).to.equals(accounts[2]);
        });

        it("Should set new reward manager", async () => {
            expect(await validatorRewardManager.newRewardManager()).to.equals(constants.ZERO_ADDRESS);
            await validatorRewardManager.setNewRewardManager(accounts[2]);
            expect(await validatorRewardManager.newRewardManager()).to.equals(accounts[2]);
        });

        it("Should revert calling setNewRewardManager if not from governance", async () => {
            await expectRevert(validatorRewardManager.setNewRewardManager(accounts[2], { from: accounts[1] }), "only governance");
        });

        it("Should revert calling setNewRewardManager twice", async () => {
            await validatorRewardManager.setNewRewardManager(accounts[2]);
            await expectRevert(validatorRewardManager.setNewRewardManager(accounts[2]), "new reward manager already set");
        });
        
        it("Should revert calling setNewRewardManager with zero address", async () => {
            await expectRevert(validatorRewardManager.setNewRewardManager(constants.ZERO_ADDRESS), "new reward manager zero");
        });

        it("Should return contract name - ValidatorRewardManager", async () => {
            expect(await validatorRewardManager.getContractName()).to.equals(Contracts.VALIDATOR_REWARD_MANAGER);
        });
        
        it("Should return contract name - AttestationProviderRewardManager", async () => {
            const attestationProviderRewardManager = await AttestationProviderRewardManager.new(accounts[0], ADDRESS_UPDATER, constants.ZERO_ADDRESS);
            expect(await attestationProviderRewardManager.getContractName()).to.equals(Contracts.ATTESTATION_PROVIDER_REWARD_MANAGER);
        });
    });

    describe("Reward distribution", async () => {

        it("Should distribute rewards", async () => {
            const tx = await distributeRewards();
            expectEvent(tx, "RewardsDistributed", {addresses: [accounts[1], accounts[2]], rewards: [toBN(25), toBN(75)]});
        });

        it("Should only be called from reward distributor", async () => {
            await expectRevert(validatorRewardManager.distributeRewards(
                [accounts[1], accounts[2]],
                [25, 75]
            ), "reward distributor only");
        });

        it("Should not distribute if arrays lengths mismatch", async () => {
            await expectRevert(validatorRewardManager.distributeRewards(
                [accounts[1], accounts[2]],
                [1, 1, 1],
                {from: REWARD_DISTIBUTOR}
            ), "arrays lengths mismatch");
        });

        it("Should not distribute more than authorized", async () => {
            await expectRevert(validatorRewardManager.distributeRewards(
                [accounts[1], accounts[2]],
                [2000000, 1],
                {from: REWARD_DISTIBUTOR}
            ), "too much");
        });

        it("Should not distribute more than authorized 2", async () => {
            await validatorRewardManager.distributeRewards(
                [accounts[1], accounts[2]],
                [2000000 - 1, 1],
                {from: REWARD_DISTIBUTOR});
            
            await expectRevert(validatorRewardManager.distributeRewards(
                [accounts[3]],
                [1],
                {from: REWARD_DISTIBUTOR}
            ), "too much");
        });
    });

    describe("getters", async () => {
        it("Should get token pool supply data", async () => {
            let data = await validatorRewardManager.getTokenPoolSupplyData();
            expect(data[0].toNumber()).to.equals(0);
            expect(data[1].toNumber()).to.equals(2000000);
            expect(data[2].toNumber()).to.equals(0);

            await distributeRewards();

            await validatorRewardManager.claim(accounts[1], accounts[1], 20, false, { from: accounts[1] });

            data = await validatorRewardManager.getTokenPoolSupplyData();
            expect(data[0].toNumber()).to.equals(0);
            expect(data[1].toNumber()).to.equals(2000000);
            expect(data[2].toNumber()).to.equals(20);

            await validatorRewardManager.claim(accounts[2], accounts[2], 40, true, { from: accounts[2] });

            data = await validatorRewardManager.getTokenPoolSupplyData();
            expect(data[0].toNumber()).to.equals(0);
            expect(data[1].toNumber()).to.equals(2000000);
            expect(data[2].toNumber()).to.equals(60);

            await validatorRewardManager.claim(accounts[3], accounts[3], 0, false, { from: accounts[3] });
            await validatorRewardManager.claim(accounts[4], accounts[4], 0, true, { from: accounts[4] });

            data = await validatorRewardManager.getTokenPoolSupplyData();
            expect(data[0].toNumber()).to.equals(0);
            expect(data[1].toNumber()).to.equals(2000000);
            expect(data[2].toNumber()).to.equals(60);
        });

        it("Should get state of rewards", async () => {
            let data = await validatorRewardManager.getStateOfRewards(accounts[1]);
            expect(data[0].toNumber()).to.equals(0);
            expect(data[1].toNumber()).to.equals(0);

            await distributeRewards();

            data = await validatorRewardManager.getStateOfRewards(accounts[1]);
            expect(data[0].toNumber()).to.equals(25);
            expect(data[1].toNumber()).to.equals(0);

            await validatorRewardManager.claim(accounts[1], accounts[1], 20, false, { from: accounts[1] });
            data = await validatorRewardManager.getStateOfRewards(accounts[1]);
            expect(data[0].toNumber()).to.equals(25);
            expect(data[1].toNumber()).to.equals(20);

            await validatorRewardManager.claim(accounts[1], accounts[1], 5, false, { from: accounts[1] });
            data = await validatorRewardManager.getStateOfRewards(accounts[1]);
            expect(data[0].toNumber()).to.equals(25);
            expect(data[1].toNumber()).to.equals(25);

            await distributeRewards();

            data = await validatorRewardManager.getStateOfRewards(accounts[1]);
            expect(data[0].toNumber()).to.equals(50);
            expect(data[1].toNumber()).to.equals(25);

            await validatorRewardManager.claim(accounts[1], accounts[1], 10, false, { from: accounts[1] });
            data = await validatorRewardManager.getStateOfRewards(accounts[1]);
            expect(data[0].toNumber()).to.equals(50);
            expect(data[1].toNumber()).to.equals(35);
        });
    });

    describe("reward claiming", async () => {
        it("Should accept NAT", async () => {
            // Assemble
            // Act
            // Inflation must call reward manager during funding, and this proxy does it.
            const txReceipt = await mockInflation.receiveInflation({ value: "200000" });
            await expectEvent.inTransaction( txReceipt.tx,
                validatorRewardManager,
                "InflationReceived", {amountReceivedWei: toBN(200000)}
            );

            // Assert
            let balance = web3.utils.toBN(await web3.eth.getBalance(validatorRewardManager.address));
            assert.equal(balance.toNumber(), 200100);
        });

        it("Should gracefully receive self-destruct proceeds", async () => {
            let balanceBefore = await web3.eth.getBalance(burnAddress);
            // Assemble
            // Give suicidal some NAT
            await web3.eth.sendTransaction({ from: accounts[0], to: mockSuicidal.address, value: 1 });
            // Sneak it into reward manager
            await mockSuicidal.die();
            assert.equal(await web3.eth.getBalance(validatorRewardManager.address), "101");
            // Act
            await mockInflation.receiveInflation({ value: "1" });
            // Assert
            // currentBalance > expectedBalance => burn the difference
            assert.equal(await web3.eth.getBalance(validatorRewardManager.address), "101");
            let balanceAfter = await web3.eth.getBalance(burnAddress);
            assert.equal(parseInt(balanceAfter) - parseInt(balanceBefore), 1);
        });

        it("Should gracefully receive self-destruct proceeds - initial balance > 0", async () => {
            // Add some initial balance (inflation)
            let balanceBefore = await web3.eth.getBalance(burnAddress);
            await mockInflation.receiveInflation({ value: "1" });
            assert.equal(await web3.eth.getBalance(validatorRewardManager.address), "101");
            // Assemble
            // Give suicidal some NAT
            await web3.eth.sendTransaction({ from: accounts[0], to: mockSuicidal.address, value: 1 });
            // Sneak it into reward manager
            await mockSuicidal.die();
            assert.equal(await web3.eth.getBalance(validatorRewardManager.address), "102");
            // Act
            await mockInflation.receiveInflation({ value: "1" });
            // Assert
            assert.equal(await web3.eth.getBalance(validatorRewardManager.address), "102");
            let balanceAfter = await web3.eth.getBalance(burnAddress);
            assert.equal(parseInt(balanceAfter) - parseInt(balanceBefore), 1);
        });

        it("Should not accept NAT unless from inflation", async () => {
            // Assemble
            // Act
            const receivePromise = validatorRewardManager.receiveInflation({ value: "2000000" });
            // Assert
            await expectRevert(receivePromise, "inflation only");
        });

        it("Should enable rewards to be claimed once distributed", async () => {
            await distributeRewards();

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await validatorRewardManager.claim(accounts[1], accounts[3], 20, false, { from: accounts[1] });
            // Assert
            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(natClosingBalance.sub(natOpeningBalance).toNumber(), 20);
        });

        it("Should enable rewards to be claimed once distributed - with self-destruct proceeds", async () => {
            await distributeRewards();

            let balance1 = await web3.eth.getBalance(burnAddress);
            // Give suicidal some NAT
            await web3.eth.sendTransaction({ from: accounts[0], to: mockSuicidal.address, value: 1 });
            // Sneak it into reward manager
            await mockSuicidal.die();

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await validatorRewardManager.claim(accounts[2], accounts[3], 40, false, { from: accounts[2] });
            // Assert
            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(natClosingBalance.sub(natOpeningBalance).toNumber(), 40);
            let balance2 = await web3.eth.getBalance(burnAddress);
            assert.equal(parseInt(balance2) - parseInt(balance1), 1);

            // Create another suicidal
            const anotherMockSuicidal = await SuicidalMock.new(validatorRewardManager.address);
            // Give suicidal some NAT
            await web3.eth.sendTransaction({ from: accounts[0], to: anotherMockSuicidal.address, value: 1 });
            // Sneak it into reward manager
            await anotherMockSuicidal.die();

            // Act
            // Claim reward to a5 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let natOpeningBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            await validatorRewardManager.claim(accounts[1], accounts[5], 25, false, { from: accounts[1] });
            let natClosingBalance2 = web3.utils.toBN(await web3.eth.getBalance(accounts[5]));
            assert.equal(natClosingBalance2.sub(natOpeningBalance2).toNumber(), 25);
            let balance3 = await web3.eth.getBalance(burnAddress);
            assert.equal(parseInt(balance3) - parseInt(balance2), 1);
        });

        it("Should revert claiming rewards if no receiver method", async () => {
            await distributeRewards();

            // Act
            let consumer = await GasConsumer.new(3);
            let tx = validatorRewardManager.claim(accounts[1], consumer.address, 20, false, { from: accounts[1] });
            // Assert
            await expectRevert(tx, "claim failed");
        });

        it("Should revert claiming rewards if zero address", async () => {
            await distributeRewards();

            // Act
            let tx = validatorRewardManager.claim(accounts[1], constants.ZERO_ADDRESS, 20, false, { from: accounts[1] });
            // Assert
            await expectRevert(tx, "recipient zero");
        });

        it("Should revert claiming rewards if more than allowed", async () => {
            await distributeRewards();

            // Act
            let tx = validatorRewardManager.claim(accounts[1], accounts[1], 30, false, { from: accounts[1] });
            // Assert
            await expectRevert(tx, "too much");

            await validatorRewardManager.claim(accounts[1], accounts[1], 20, false, { from: accounts[1] });
            let tx2 = validatorRewardManager.claim(accounts[1], accounts[1], 6, false, { from: accounts[1] });
            // Assert
            await expectRevert(tx2, "too much");
        });

        it("Should revert claiming rewards if more than current balance", async () => {
            await distributeRewards();
            await distributeRewards();

            // Act
            let tx = validatorRewardManager.claim(accounts[2], accounts[1], 150, false, { from: accounts[2] });
            // Assert
            await expectRevert(tx, "claim failed");
        });

        it("Should revert claiming and wrapping rewards if more than current balance", async () => {
            await distributeRewards();
            await distributeRewards();

            // Act
            let tx = validatorRewardManager.claim(accounts[2], accounts[1], 150, true, { from: accounts[2] });
            // Assert
            await expectRevert.unspecified(tx);
        });

        it("Should enable rewards to be claimed and wrapped once distributed", async () => {
            await distributeRewards();

            // Act
            // Claim reward to a3 - test both 3rd party claim and avoid
            // having to calc gas fees            
            let wNatOpeningBalance = await wNat.votePowerOf(accounts[1]);
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            await validatorRewardManager.claim(accounts[1], accounts[1], 20, true, { from: accounts[1] });
            // Assert
            let wNatClosingBalance = await wNat.votePowerOf(accounts[1]);
            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[3]));
            assert.equal(wNatClosingBalance.sub(wNatOpeningBalance).toNumber(), 20);
            assert(natOpeningBalance.eq(natClosingBalance));
        });

        it("Should enable rewards to be claimed (by executor) once distributed", async () => {
            await distributeRewards();
            await validatorRewardManager.setClaimExecutors([accounts[5]], { from: accounts[1] });

            // Act
            let wNatOpeningBalance = await wNat.votePowerOf(accounts[1]);
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[1]));
            await validatorRewardManager.claim(accounts[1], accounts[1], 20, false, { from: accounts[5] });
            // Assert
            let wNatClosingBalance = await wNat.votePowerOf(accounts[1]);
            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[1]));
            assert.equal(natClosingBalance.sub(natOpeningBalance).toNumber(), 20);
            assert(wNatOpeningBalance.eq(wNatClosingBalance));
        });

        it("Should enable rewards to be claimed and wrapped (by executor) once distributed", async () => {
            await distributeRewards();
            await validatorRewardManager.setClaimExecutors([accounts[5]], { from: accounts[1] });

            // Act
            let wNatOpeningBalance = await wNat.votePowerOf(accounts[1]);
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[1]));
            await validatorRewardManager.claim(accounts[1], accounts[1], 20, true, { from: accounts[5] });
            // Assert
            let wNatClosingBalance = await wNat.votePowerOf(accounts[1]);
            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[1]));
            assert.equal(wNatClosingBalance.sub(wNatOpeningBalance).toNumber(), 20);
            assert(natOpeningBalance.eq(natClosingBalance));
        });

        it("Should enable rewards to be claimed and wrapped by multiple executors to other accounts once distributed", async () => {
            await distributeRewards();

            // Act
            await validatorRewardManager.setClaimExecutors([accounts[5], accounts[6]], { from: accounts[1] });
            await validatorRewardManager.setAllowedClaimRecipients([accounts[7], accounts[8]], { from: accounts[1] });

            // claiming from first executor to first allowed recipient
            let wNatOpeningBalance = await wNat.votePowerOf(accounts[7]);
            let natOpeningBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[7]));
            await validatorRewardManager.claim(accounts[1], accounts[7], 20, true, { from: accounts[5] });
            // Assert
            let wNatClosingBalance = await wNat.votePowerOf(accounts[7]);
            let natClosingBalance = web3.utils.toBN(await web3.eth.getBalance(accounts[7]));
            assert.equal(wNatClosingBalance.sub(wNatOpeningBalance).toNumber(), 20);
            assert(natOpeningBalance.eq(natClosingBalance));

            // claiming from second executor to second allowed recipient
            let wNatOpeningBalance1 = await wNat.votePowerOf(accounts[8]);
            let natOpeningBalance1 = web3.utils.toBN(await web3.eth.getBalance(accounts[8]));
            await validatorRewardManager.claim(accounts[1], accounts[8], 5, true, { from: accounts[6] });
            // Assert
            let wNatClosingBalance1 = await wNat.votePowerOf(accounts[8]);
            let natClosingBalance1 = web3.utils.toBN(await web3.eth.getBalance(accounts[8]));
            assert.equal(wNatClosingBalance1.sub(wNatOpeningBalance1).toNumber(), 5);
            assert(natOpeningBalance1.eq(natClosingBalance1));
            
        });

        it("Executors and recipients should match allowed", async () => {
            await distributeRewards();

            // Act
            await validatorRewardManager.setClaimExecutors([accounts[5], accounts[6]], { from: accounts[1] });
            await validatorRewardManager.setAllowedClaimRecipients([accounts[7], accounts[8]], { from: accounts[1] });

            // Assert
            
            // not an executor
            await expectRevert(validatorRewardManager.claim(accounts[1], accounts[8], 20, true, { from: accounts[7] }),
                "only owner or executor");
            
            // not a valid recipient
            await expectRevert(validatorRewardManager.claim(accounts[1], accounts[6], 20, true, { from: accounts[5] }),
                "recipient not allowed");
            
            // owner is always valid recipient
            let wNatOpeningBalance = await wNat.votePowerOf(accounts[1]);
            await validatorRewardManager.claim(accounts[1], accounts[1], 20, true, { from: accounts[5] });
            let wNatClosingBalance = await wNat.votePowerOf(accounts[1]);
            assert.equal(wNatClosingBalance.sub(wNatOpeningBalance).toNumber(), 20);
        });
        
        it("Executor must be allowed to be able to claim for the reward owner", async () => {
            await distributeRewards();

            // Act
            // Assert
            await expectRevert(validatorRewardManager.claim(accounts[1], accounts[1], 20, false, { from: accounts[5] }),
                "only owner or executor");
            await expectRevert(validatorRewardManager.claim(accounts[1], accounts[1], 20, true, { from: accounts[5] }),
                "only owner or executor");
        });
        
        it("Executor must not be removed to be able to claim for the reward owner", async () => {
            await distributeRewards();

            // Act
            await validatorRewardManager.setClaimExecutors([accounts[5]], { from: accounts[1] });
            await validatorRewardManager.setClaimExecutors([], { from: accounts[1] });
            
            // Assert
            await expectRevert(validatorRewardManager.claim(accounts[1], accounts[1], 20, true, { from: accounts[5] }),
                "only owner or executor");
        });
        
        it("Executor change emits event", async () => {
            const res = await validatorRewardManager.setClaimExecutors([accounts[2], accounts[3], accounts[6]], { from: accounts[1] });
            expectEvent(res, 'ClaimExecutorsChanged', { rewardOwner: accounts[1], executors: [accounts[2], accounts[3], accounts[6]] });
            compareArrays(await validatorRewardManager.claimExecutors(accounts[1]), [accounts[2], accounts[3], accounts[6]]);
        });
        
        it("Recipient change emits event", async () => {
            const res = await validatorRewardManager.setAllowedClaimRecipients([accounts[2], accounts[3], accounts[6]], { from: accounts[1] });
            expectEvent(res, 'AllowedClaimRecipientsChanged', { rewardOwner: accounts[1], recipients: [accounts[2], accounts[3], accounts[6]] });
            compareArrays(await validatorRewardManager.allowedClaimRecipients(accounts[1]), [accounts[2], accounts[3], accounts[6]]);
        });
        
        it("Can change executors multiple times", async() => {
            await distributeRewards();
            
            // can set
            await validatorRewardManager.setClaimExecutors([accounts[5]], { from: accounts[1] });
            compareArrays(await validatorRewardManager.claimExecutors(accounts[1]), [accounts[5]]);

            // can replace
            await validatorRewardManager.setClaimExecutors([accounts[2], accounts[3], accounts[6]], { from: accounts[1] });
            compareArrays(await validatorRewardManager.claimExecutors(accounts[1]), [accounts[2], accounts[3], accounts[6]]);

            // can clear
            await validatorRewardManager.setClaimExecutors([], { from: accounts[1] });
            compareArrays(await validatorRewardManager.claimExecutors(accounts[1]), []);
            
            // duplicates are ignored
            await validatorRewardManager.setClaimExecutors([accounts[2], accounts[3], accounts[6], accounts[3], accounts[2]], { from: accounts[1] });
            compareArrays(await validatorRewardManager.claimExecutors(accounts[1]), [accounts[2], accounts[3], accounts[6]]);
            
            // only last value should be used
            await validatorRewardManager.setClaimExecutors([accounts[5]], { from: accounts[1] });
            // all other than 1 and 5 should succeed            
            for (let i = 0; i < 10; i++) {
                if (i !== 1 && i !== 5) {
                    await expectRevert(validatorRewardManager.claim(accounts[1], accounts[1], 20, true, { from: accounts[i] }),
                        "only owner or executor");
                }
            }
            // 5 should succeed
            let wNatOpeningBalance = await wNat.votePowerOf(accounts[1]);
            await validatorRewardManager.claim(accounts[1], accounts[1], 20, true, { from: accounts[5] });
            let wNatClosingBalance = await wNat.votePowerOf(accounts[1]);
            assert.equal(wNatClosingBalance.sub(wNatOpeningBalance).toNumber(), 20);
        });

        it("Can change recipients multiple times", async () => {
            await distributeRewards();

            // can set
            await validatorRewardManager.setAllowedClaimRecipients([accounts[5]], { from: accounts[1] });
            compareArrays(await validatorRewardManager.allowedClaimRecipients(accounts[1]), [accounts[5]]);

            // can replace
            await validatorRewardManager.setAllowedClaimRecipients([accounts[2], accounts[3], accounts[6]], { from: accounts[1] });
            compareArrays(await validatorRewardManager.allowedClaimRecipients(accounts[1]), [accounts[2], accounts[3], accounts[6]]);

            // can clear
            await validatorRewardManager.setAllowedClaimRecipients([], { from: accounts[1] });
            compareArrays(await validatorRewardManager.allowedClaimRecipients(accounts[1]), []);

            // duplicates are ignored
            await validatorRewardManager.setAllowedClaimRecipients([accounts[2], accounts[3], accounts[6], accounts[3], accounts[2]], { from: accounts[1] });
            compareArrays(await validatorRewardManager.allowedClaimRecipients(accounts[1]), [accounts[2], accounts[3], accounts[6]]);

            // only last value should be used
            await validatorRewardManager.setClaimExecutors([accounts[2]], { from: accounts[1] });
            await validatorRewardManager.setAllowedClaimRecipients([accounts[5]], { from: accounts[1] });
            // all other than 1 and 5 should succeed            
            for (let i = 0; i < 10; i++) {
                if (i !== 5 && i !== 1) {   // 5 is allowed, 1 is owner (always allowed)
                    await expectRevert(validatorRewardManager.claim(accounts[1], accounts[i], 20, true, { from: accounts[2] }),
                        "recipient not allowed");
                }
            }
            // 5 should succeed
            let wNatOpeningBalance = await wNat.votePowerOf(accounts[5]);
            await validatorRewardManager.claim(accounts[1], accounts[5], 20, true, { from: accounts[2] });
            let wNatClosingBalance = await wNat.votePowerOf(accounts[5]);
            assert.equal(wNatClosingBalance.sub(wNatOpeningBalance).toNumber(), 20);
        });
    });
});
