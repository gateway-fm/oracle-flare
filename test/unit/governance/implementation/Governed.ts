import { GovernanceSettingsInstance, GovernedInstance } from "../../../../typechain-truffle";

import { constants, expectEvent, expectRevert } from '@openzeppelin/test-helpers';
import { testDeployGovernanceSettings } from "../../../utils/contract-test-helpers";
const getTestFile = require('../../../utils/constants').getTestFile;

const Governed = artifacts.require("Governed");
const GovernanceSettings = artifacts.require("GovernanceSettings");

const ALREADY_INIT_MSG = "initialised != false";
const ONLY_GOVERNANCE_MSG = "only governance";
const GOVERNANCE_ZERO = "_governance zero";

contract(`Governed.sol; ${getTestFile(__filename)}; Governed unit tests`, async accounts => {
    const initialGovernance = accounts[1];
    const productionGovernance = accounts[2];
    const productionExecutor = accounts[3];

    // contains a fresh contract for each test
    let governed: GovernedInstance;
    let governanceSettings: GovernanceSettingsInstance;

    beforeEach(async () => {
        governed = await Governed.new(initialGovernance);
        governanceSettings = await testDeployGovernanceSettings(productionGovernance, 10, [productionGovernance, productionExecutor]);
    });

    describe("initialise", async () => {
        it("Should only initialize with non-zero governance", async () => {
            // Assemble
            // Act
            const promise = Governed.new(constants.ZERO_ADDRESS);
            // Assert
            await expectRevert(promise, GOVERNANCE_ZERO);
        });

        it("Should only be initializable once", async () => {
            // Assemble
            // Act
            const initPromise = governed.initialise(productionGovernance);
            // Assert
            await expectRevert(initPromise, ALREADY_INIT_MSG);
            // Original governance should still be set
            const currentGovernance = await governed.governance();
            assert.equal(currentGovernance, initialGovernance);
        });
    });

    describe("switch to production", async () => {
        it("Should switch to production", async () => {
            // Assemble
            // Act
            const tx = await governed.switchToProductionMode({ from: initialGovernance });
            // Assert
            const currentGovernance = await governed.governance();
            assert.equal(currentGovernance, productionGovernance);
            expectEvent(tx, "GovernedProductionModeEntered", { governanceSettings: governanceSettings.address });
        });

        it("Should reject switch if not from governed address", async () => {
            // Assemble
            // Act
            const promiseTransfer = governed.switchToProductionMode({ from: accounts[3] });
            // Assert
            await expectRevert(promiseTransfer, ONLY_GOVERNANCE_MSG);
        });

        it("Should not switch to production twice", async () => {
            // Assemble
            await governed.switchToProductionMode({ from: initialGovernance });
            // Act
            const promiseTransfer1 = governed.switchToProductionMode({ from: initialGovernance });
            // Assert
            await expectRevert(promiseTransfer1, ONLY_GOVERNANCE_MSG);
            // Act
            const promiseTransfer2 = governed.switchToProductionMode({ from: productionGovernance });
            // Assert
            await expectRevert(promiseTransfer2, "already in production mode");
        });
        
        it("Should have new governance parameters after switching", async () => {
            // Assemble
            const startGovernance = await governed.governance();
            const startProductionMode = await governed.productionMode();
            // Act
            const tx = await governed.switchToProductionMode({ from: initialGovernance });
            // Assert
            const newGovernance = await governed.governance();
            const newProductionMode = await governed.productionMode();
            //
            assert.equal(startGovernance, initialGovernance);
            assert.equal(startProductionMode, false);
            assert.equal(newGovernance, productionGovernance);
            assert.equal(newProductionMode, true);
        });
    });
});
