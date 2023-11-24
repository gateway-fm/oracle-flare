import { constants, expectRevert } from "@openzeppelin/test-helpers";
import { network } from "hardhat";
import { GovernanceSettingsInstance, GovernedWithTimelockMockInstance } from "../../../../typechain-truffle";
import { getTestFile } from "../../../utils/constants";
import { testDeployGovernanceSettings } from "../../../utils/contract-test-helpers";
import { compareArrays, findRequiredEvent } from "../../../utils/test-helpers";

const GovernedWithTimelockMock = artifacts.require("GovernedWithTimelockMock");

contract(`GovernanceSettings.sol; ${getTestFile(__filename)}; GovernanceSettings unit tests`, async accounts => {
    const GOVERNANCE_SETTINGS_ADDRESS = "0x1000000000000000000000000000000000000007";
    const GENESIS_GOVERNANCE_ADDRESS = "0xfffEc6C83c8BF5c3F4AE0cCF8c45CE20E4560BD7";
    
    const initialGovernance = accounts[10];
    const governance = accounts[11];
    const executor = accounts[12];
    
    let governanceSettings: GovernanceSettingsInstance;
    let mock: GovernedWithTimelockMockInstance;
    
    beforeEach(async () => {
        governanceSettings = await testDeployGovernanceSettings(governance, 3600, [governance, executor]);
        mock = await GovernedWithTimelockMock.new(initialGovernance);
        await mock.switchToProductionMode({ from: initialGovernance });
    });
    
    it("can change executors", async () => {
        const origExecutors = [governance, executor];
        const newExecutors = [accounts[13], accounts[14], accounts[15]];
        const isExecutorOld = [false, true, true, false, false, false];
        const isExecutorNew = [false, false, false, true, true, true];
        // compare old
        compareArrays(await governanceSettings.getExecutors(), origExecutors);
        for (let i = 10; i < 15; i++) {
            assert.equal(await governanceSettings.isExecutor(accounts[i]), isExecutorOld[i - 10]);
        }
        // change
        const res = await governanceSettings.setExecutors(newExecutors, { from: governance });
        const event = findRequiredEvent(res, "GovernanceExecutorsUpdated");
        compareArrays(event.args.oldExecutors, origExecutors);
        compareArrays(event.args.newExecutors, newExecutors);
        // compare new
        compareArrays(await governanceSettings.getExecutors(), newExecutors);
        for (let i = 10; i < 15; i++) {
            assert.equal(await governanceSettings.isExecutor(accounts[i]), isExecutorNew[i - 10]);
        }
    });

    it("only governance can set executors", async () => {
        await expectRevert(governanceSettings.setExecutors([accounts[15]]),
            "only governance");
    });
    
    it("changing governance address should fail silently (only effective by fork)", async () => {
        await governanceSettings.setGovernanceAddress(accounts[15], { from: governance });
        // should remain as before
        assert.equal(await governanceSettings.getGovernanceAddress(), accounts[11]);
    });

    it("changing timelock should fail silently", async () => {
        await governanceSettings.setTimelock(1000, { from: governance });
        // should remain as before
        assert.equal(Number(await governanceSettings.getTimelock()), 3600);
    });

    it("changing governance should check that it's different", async () => {
        await expectRevert(governanceSettings.setGovernanceAddress(governance),
            "governanceAddress == _newGovernance");
    });
    
    it("changing timelock should check that it's different", async () => {
        await expectRevert(governanceSettings.setTimelock(3600),
            "timelock == _newTimelock");
    });
    
    it("changing timelock should check size", async () => {
        await expectRevert(governanceSettings.setTimelock("1000000000000000"),
            "timelock too large");
    });

    it("cannot initialise twice", async () => {
        await expectRevert(governanceSettings.initialise(accounts[11], 3600, [governance, executor], { from: GENESIS_GOVERNANCE_ADDRESS }),
            "already initialised");
    });

    it("only genesis governance can initialise", async () => {
        await network.provider.send("hardhat_setStorageAt", [GOVERNANCE_SETTINGS_ADDRESS, "0x0", constants.ZERO_BYTES32]);  // clear initialisation
        await expectRevert(governanceSettings.initialise(accounts[11], 3600, [governance, executor], { from: accounts[10] }),
            "only genesis governance");
    });

    it("check timelock size in initialisation", async () => {
        await network.provider.send("hardhat_setStorageAt", [GOVERNANCE_SETTINGS_ADDRESS, "0x0", constants.ZERO_BYTES32]);  // clear initialisation
        await expectRevert(governanceSettings.initialise(accounts[11], "1000000000000000", [governance, executor], { from: GENESIS_GOVERNANCE_ADDRESS }),
            "timelock too large");
    });
});
