import { constants, expectEvent, expectRevert, time } from '@openzeppelin/test-helpers';
import { Contracts } from '../../../../deployment/scripts/Contracts';
import { CleanupBlockNumberManagerInstance } from "../../../../typechain-truffle";
import { getTestFile } from "../../../utils/constants";
import { assertNumberEqual, encodeContractNames, toBN } from "../../../utils/test-helpers";
import { setDefaultVPContract } from "../../../utils/token-test-helpers";

const VPToken = artifacts.require("VPTokenMock");
const VPContract = artifacts.require("VPContract");
const CleanupBlockNumberManager = artifacts.require("CleanupBlockNumberManager");

contract(`CleanupBlockNumberManager.sol; ${getTestFile(__filename)}; CleanupBlockNumberManager unit tests`, async accounts => {
    const governance = accounts[0];
    const ADDRESS_UPDATER = accounts[16];
    const TRIGGER_CONTRACT_NAME = "TRIGGER";
    const trigger = accounts[10];
    let cbnManager: CleanupBlockNumberManagerInstance;

    beforeEach(async () => {
        cbnManager = await CleanupBlockNumberManager.new(governance, ADDRESS_UPDATER, TRIGGER_CONTRACT_NAME);
        await cbnManager.updateContractAddresses(
            encodeContractNames([Contracts.ADDRESS_UPDATER, TRIGGER_CONTRACT_NAME]),
            [ADDRESS_UPDATER, trigger], {from: ADDRESS_UPDATER});
    });

    it("Can set trigger", async () => {
        // Assemble
        // Act
        await cbnManager.updateContractAddresses(
            encodeContractNames([Contracts.ADDRESS_UPDATER, TRIGGER_CONTRACT_NAME]),
            [ADDRESS_UPDATER, accounts[5]], {from: ADDRESS_UPDATER});
        // Assert
        assert.equal(await cbnManager.triggerContract(), accounts[5]);
    });

    it("Only address updater can set trigger", async () => {
        // Assemble
        // Act
        // Assert
        await expectRevert(cbnManager.updateContractAddresses(
            encodeContractNames([Contracts.ADDRESS_UPDATER, TRIGGER_CONTRACT_NAME]),
            [ADDRESS_UPDATER, accounts[5]], { from: accounts[1] }),
            "only address updater");
    });

    async function createVPToken(name: string, symbol: string) {
        const vpToken = await VPToken.new(governance, name, symbol);
        await setDefaultVPContract(vpToken, governance);
        return vpToken;
    }

    it("Can register contracts", async () => {
        // Assemble
        const vpToken = await createVPToken("A token", "ATOK");
        // Act
        await cbnManager.registerToken(vpToken.address, { from: governance });
        // Assert
        assert.equal(await cbnManager.registeredTokens(0), vpToken.address);
    });

    it("Only governance can register contracts", async () => {
        // Assemble
        const vpToken = await createVPToken("A token", "ATOK");
        // Act
        // Assert
        await expectRevert(cbnManager.registerToken(vpToken.address, { from: accounts[1] }),
            "only governance");
    });

    it("Can register multiple contracts", async () => {
        // Assemble
        const vpToken1 = await createVPToken("A token", "ATOK");
        const vpToken2 = await createVPToken("Another token", "BTOK");
        // Act
        await cbnManager.registerToken(vpToken1.address, { from: governance });
        await cbnManager.registerToken(vpToken2.address, { from: governance });
        // Assert
        assert.equal(await cbnManager.registeredTokens(0), vpToken1.address);
        assert.equal(await cbnManager.registeredTokens(1), vpToken2.address);
    });

    it("Each contract is registered only once", async () => {
        // Assemble
        const vpToken1 = await createVPToken("A token", "ATOK");
        const vpToken2 = await createVPToken("Another token", "BTOK");
        // Act
        await cbnManager.registerToken(vpToken1.address, { from: governance });
        await cbnManager.registerToken(vpToken2.address, { from: governance });
        await cbnManager.registerToken(vpToken1.address, { from: governance });
        // Assert
        assert.equal(await cbnManager.registeredTokens(0), vpToken1.address);
        assert.equal(await cbnManager.registeredTokens(1), vpToken2.address);
        await expectRevert(cbnManager.registeredTokens(2),
            "Transaction reverted without a reason");   // reading past array end
    });

    it("Can unregister contract", async () => {
        // Assemble
        const vpToken1 = await createVPToken("A token", "ATOK");
        const vpToken2 = await createVPToken("Another token", "BTOK");
        await cbnManager.registerToken(vpToken1.address, { from: governance });
        await cbnManager.registerToken(vpToken2.address, { from: governance });
        // Act
        await cbnManager.unregisterToken(vpToken1.address, { from: governance });
        // Assert
        assert.equal(await cbnManager.registeredTokens(0), vpToken2.address);
        await expectRevert(cbnManager.registeredTokens(1),
            "Transaction reverted without a reason");   // reading past array end
    });

    it("Unregistering contract that is not registered reverts", async () => {
        // Assemble
        const vpToken1 = await createVPToken("A token", "ATOK");
        const vpToken2 = await createVPToken("Another token", "BTOK");
        await cbnManager.registerToken(vpToken1.address, { from: governance });
        // Act
        // Assert
        await expectRevert(cbnManager.unregisterToken(vpToken2.address, { from: governance }),
            "contract not found");
    });

    it("Only governance can unregister contract", async () => {
        // Assemble
        const vpToken1 = await createVPToken("A token", "ATOK");
        await cbnManager.registerToken(vpToken1.address, { from: governance });
        // Act
        // Assert
        await expectRevert(cbnManager.unregisterToken(vpToken1.address, { from: accounts[1] }),
            "only governance");
    });

    it("Register and unregister trigger events", async () => {
        // Assemble
        const vpToken1 = await createVPToken("A token", "ATOK");
        const vpToken2 = await createVPToken("Another token", "BTOK");
        // Act
        // Assert
        expectEvent(await cbnManager.registerToken(vpToken1.address, { from: governance }),
            "RegistrationUpdated", { theContract: vpToken1.address, add: true });
        expectEvent(await cbnManager.registerToken(vpToken2.address, { from: governance }),
            "RegistrationUpdated", { theContract: vpToken2.address, add: true });
        expectEvent.notEmitted(await cbnManager.registerToken(vpToken1.address, { from: governance }),
            "RegistrationUpdated");     // there should be no event when contract is already registered
        expectEvent(await cbnManager.unregisterToken(vpToken1.address, { from: governance }),
            "RegistrationUpdated", { theContract: vpToken1.address, add: false });
    });

    it("Can set cleanup block to one or more contracts", async () => {
        // Assemble
        const vpToken1 = await createVPToken("A token", "ATOK");
        await vpToken1.setCleanupBlockNumberManager(cbnManager.address, { from: governance });
        await cbnManager.registerToken(vpToken1.address, { from: governance });
        const vpToken2 = await createVPToken("Another token", "BTOK");
        await vpToken2.setCleanupBlockNumberManager(cbnManager.address, { from: governance });
        await cbnManager.registerToken(vpToken2.address, { from: governance });
        const blk1 = await web3.eth.getBlockNumber();
        await time.advanceBlock();
        // Act
        await cbnManager.setCleanUpBlockNumber(blk1, { from: trigger });
        // Assert
        assertNumberEqual(await vpToken1.cleanupBlockNumber(), blk1);
        assertNumberEqual(await vpToken2.cleanupBlockNumber(), blk1);
    });

    it("Trigger can also set cleanup block", async () => {
        // Assemble
        const vpToken1 = await createVPToken("A token", "ATOK");
        await vpToken1.setCleanupBlockNumberManager(cbnManager.address, { from: governance });
        await cbnManager.registerToken(vpToken1.address, { from: governance });
        const blk1 = await web3.eth.getBlockNumber();
        await time.advanceBlock();
        // Act
        await cbnManager.setCleanUpBlockNumber(blk1, { from: trigger });
        // Assert
        assertNumberEqual(await vpToken1.cleanupBlockNumber(), blk1);
    });

    it("Only governance and trigger can set cleanup block", async () => {
        // Assemble
        const vpToken1 = await createVPToken("A token", "ATOK");
        await vpToken1.setCleanupBlockNumberManager(cbnManager.address, { from: governance });
        await cbnManager.registerToken(vpToken1.address, { from: governance });
        const blk1 = await web3.eth.getBlockNumber();
        await time.advanceBlock();
        // Act
        // Assert
        await expectRevert(cbnManager.setCleanUpBlockNumber(blk1, { from: accounts[1] }),
            "trigger contract only");
    });

    it("Setting cleanup blocks emits events", async () => {
        // Assemble
        const vpToken1 = await createVPToken("A token", "ATOK");
        await vpToken1.setCleanupBlockNumberManager(cbnManager.address, { from: governance });
        await cbnManager.registerToken(vpToken1.address, { from: governance });
        const vpToken2 = await createVPToken("Another token", "BTOK");
        await vpToken2.setCleanupBlockNumberManager(cbnManager.address, { from: governance });
        await cbnManager.registerToken(vpToken2.address, { from: governance });
        const blk1 = await web3.eth.getBlockNumber();
        await time.advanceBlock();
        // Act
        const receipt = await cbnManager.setCleanUpBlockNumber(blk1, { from: trigger });
        // Assert
        expectEvent(receipt, "CleanupBlockNumberSet", { theContract: vpToken1.address, blockNumber: toBN(blk1), success: true });
        expectEvent(receipt, "CleanupBlockNumberSet", { theContract: vpToken2.address, blockNumber: toBN(blk1), success: true });
    });

    it("Setting cleanup blocks fails silently if something is wrong", async () => {
        // Assemble
        // create tokens
        const vpToken1 = await createVPToken("A token", "ATOK");
        const vpToken2 = await createVPToken("Another token", "BTOK");
        const blk1 = await web3.eth.getBlockNumber();
        await time.advanceBlock();
        // set cleanup block manually on token1
        await vpToken1.setCleanupBlockNumberManager(accounts[30], { from: governance });
        await vpToken1.setCleanupBlockNumber(blk1 + 1, { from: accounts[30]  });
        // set real cleanup block manager
        await vpToken1.setCleanupBlockNumberManager(cbnManager.address, { from: governance });
        await cbnManager.registerToken(vpToken1.address, { from: governance });
        await vpToken2.setCleanupBlockNumberManager(cbnManager.address, { from: governance });
        await cbnManager.registerToken(vpToken2.address, { from: governance });
        // Act
        await vpToken2.setCleanupBlockNumberManager(constants.ZERO_ADDRESS, { from: governance });
        const receipt = await cbnManager.setCleanUpBlockNumber(blk1, { from: trigger });
        // Assert
        expectEvent(receipt, "CleanupBlockNumberSet", { theContract: vpToken1.address, blockNumber: toBN(blk1), success: false });
        expectEvent(receipt, "CleanupBlockNumberSet", { theContract: vpToken2.address, blockNumber: toBN(blk1), success: false });
    });
});
