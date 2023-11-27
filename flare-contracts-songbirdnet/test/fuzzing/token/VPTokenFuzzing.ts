import { constants } from "@openzeppelin/test-helpers";
import { GovernanceVotePowerInstance, WNatInstance } from "../../../typechain-truffle";
import { getTestFile } from "../../utils/constants";
import { setDefaultVPContract } from "../../utils/token-test-helpers";
import { coinFlip, linearFallingRandom, loadJson, MAX_BIPS, Nullable, randomChoice, randomInt, randomIntDist, saveJson, weightedRandomChoice } from "../../utils/fuzzing-utils";
import { VPTokenChecker } from "./VPTokenChecker";
import { Checkpoint, VPTokenHistory, VPTokenSimulator } from "./VPTokenSimulator";
import axios from "axios";
const fs = require("fs");

const VPToken = artifacts.require("WNat");
const GovernanceVP = artifacts.require("GovernanceVotePower");

contract(`VPToken.sol; ${getTestFile(__filename)}; Token fuzzing tests`, availableAccounts => {
    let vpToken: WNatInstance;
    let history: VPTokenHistory;
    let simulator: VPTokenSimulator;
    let governanceVP: GovernanceVotePowerInstance;
    
    let env = process.env;

    ///////////////////////////////////////////////////////////////////////////////////////
    // PARAMETERS
    
    // when set and true (ok, not 'false') replays the previous test run (saved in `cache/history.json`)
    let REPLAY = env.REPLAY ? env.REPLAY !== 'false' : false;
    
    // the length of the run (i.e. the number of actions executed)
    let LENGTH = env.LENGTH ? Number(env.LENGTH) : 3000;

    // there are two ways to set checkpoint indices:
    // 1) create a checkpoint at each index in the checkpoint list
    let CHECKPOINT_LIST = env.CHECKPOINT_LIST ? env.CHECKPOINT_LIST.split(',').map(s => Number(s)) : null;

    // 2) create a checkpoint after every CHECKPOINT_EVERY actions
    let CHECKPOINT_EVERY = env.CHECKPOINT_EVERY ? Number(env.CHECKPOINT_EVERY) : 1000;

    // the number of accounts participating in tests (actually, there are 2 more - governance and a user)
    let N_ACCOUNTS = env.N_ACCOUNTS ? Number(env.N_ACCOUNTS) : 50;
    
    // the number of accounts that will always delgate by percent
    let N_PERC_DLG = env.N_PERC_DLG ? Number(env.N_PERC_DLG) : 20;
    
    // the number of accounts that will always delgate explicitly
    let N_AMOUNT_DLG = env.N_AMOUNT_DLG ? Number(env.N_AMOUNT_DLG) : 10;

    // the initial amount of tokens minted to all participating accounts
    let INIT_AMOUNT = env.INIT_AMOUNT ? Number(env.INIT_AMOUNT) : 1_000_000;

    // the block number to replace write vpcontract
    let REPLACE_VPCONTRACT_AT = env.REPLACE_VPCONTRACT_AT ? Number(env.REPLACE_VPCONTRACT_AT) : null;
    
    // the number of blocks to work with differrent read and write vpcontracts
    let SPLIT_VPCONTRACTS_BLOCKS = env.SPLIT_VPCONTRACTS_BLOCKS ? Number(env.SPLIT_VPCONTRACTS_BLOCKS) : 0;
    
    // index of the checkpoint where cleanup block number will be set (previous checkpoints will be discarded)
    let CLEANUP_BLOCK = env.CLEANUP_BLOCK ? Number(env.CLEANUP_BLOCK) : null;
    
    // the block at which cleanup block number will be set
    let SET_CLEANUP_BLOCK_AT = env.SET_CLEANUP_BLOCK_AT ? Number(env.SET_CLEANUP_BLOCK_AT) : CLEANUP_BLOCK;

    // END PARAMETERS
    ///////////////////////////////////////////////////////////////////////////////////////

    let governance = availableAccounts[0];
    let plainuser = availableAccounts[1];
    let accounts = availableAccounts.slice(2, N_ACCOUNTS + 2).concat(constants.ZERO_ADDRESS);

    let percentageAccounts = accounts.slice(0, N_PERC_DLG);
    let explicitAccounts = accounts.slice(N_PERC_DLG, N_PERC_DLG + N_AMOUNT_DLG);
    let otherAccounts = accounts.slice(N_PERC_DLG + N_AMOUNT_DLG);

    // VPToken wrappers
    before(async () => {
        vpToken = await VPToken.new(governance, "Test token", "TTOK");
        await setDefaultVPContract(vpToken, governance);
        governanceVP = await GovernanceVP.new(vpToken.address);
        await vpToken.setGovernanceVotePower(governanceVP.address);
        await vpToken.setCleanupBlockNumberManager(governance, { from: governance });
        history = new VPTokenHistory(vpToken, governanceVP);
        simulator = new VPTokenSimulator(history);
    });

    let is_passing = true
    afterEach(function() {
      const status = this.currentTest?.state
      if(status === "failed"){
        is_passing = false;
      }
    })

    after(async () => {
        let BadgeStorageURL = ""
        if (process.env.BADGE_URL) {
          BadgeStorageURL = process.env.BADGE_URL
        }
      
        let fromMaster = false
        if (process.env.FROM_MASTER) {
            fromMaster = process.env.FROM_MASTER === 'true'
        }
        
        let badge_data;
        if(!is_passing){
            badge_data = {
                "name": "FlareSCFuzzerToken",
                "schemaVersion": 1,
                "label": "Fuzzer token",
                "color": "red",
                "message": "Fail"
            }
        } else {
            badge_data = {
                "name": "FlareSCFuzzerToken",
                "schemaVersion": 1,
                "label": "Fuzzer token",
                "color": "green",
                "message": "Pass"
            }
        }
        if(fromMaster){
            await axios.post(
                BadgeStorageURL+"api/0/badges",
                badge_data
              )
        }
    });


    // utility functions
    it("run randomized tests", async () => {
        try {
            if (REPLAY) {
                await loadAndReplayHistory();
            } else {
                await runRandomActions();
            }
        } finally {
            // save history and state, even on fail (last command will be the failing one)
            if (!REPLAY) {
                saveHistory();
            }
            
            history.state.save('cache/state.json', 4);
            for (const cp of history.checkpoints.values()) {
                cp.state.save(`cache/state-${cp.id}.json`, 4);
            }
            
            console.log("Error counts:");
            for (const [key, count] of history.errorCounts.entries()) {
                console.log(`   ${key}  -  ${count}`);
            }
        }

        console.log("Checking...");
        await performChecks(vpToken, history, null, governanceVP);
        for (const checkpoint of history.checkpoints.values()) {
            await performChecks(vpToken, history, checkpoint, governanceVP);
        }
    });

    async function runRandomActions() {
        console.log("Depositing initial funds...");
        for (const account of accounts) {
            await simulator.deposit(account, INIT_AMOUNT);
        }

        const presentActions: Array<[() => Promise<void>, number]> = [
            [testDeposit, 5],
            [testWithdraw, 5],
            [testDepositTo, 5],
            [testWithdrawFrom, 5],
            [testTransfer, 5],
            [testDelegate, 10],
            [testDelegateGovernance, 10],
            [testDelegateExplicit, 10],
            [testUndelegateAll, 1],
            [testUndelegateAllExplicit, 1],
            [testUndelegateGovernance, 1]
        ];
        const historyActions: Array<[() => Promise<void>, number]> = [
            [testRevokeDelegationAt, 5],
            [testVotePowerAtCached, 5],
            [testVotePowerOfAtCached, 5],
        ]
        const allActions = presentActions.concat(historyActions);

        console.log("Running actions...");
        for (let i = 1; i <= LENGTH; i++) {
            if (i % 100 === 0) console.log("   ", i);
            
            const actions = history.checkpoints.size === 0 ? presentActions : allActions;
            const action = weightedRandomChoice(actions);
            simulator.context = i;
            
            await action();
            
            if (REPLACE_VPCONTRACT_AT != null) {
                if (i === REPLACE_VPCONTRACT_AT) {
                    await replaceWriteVpContract();
                }
                if (i === REPLACE_VPCONTRACT_AT + SPLIT_VPCONTRACTS_BLOCKS) {
                    await replaceReadVpContract();
                }
            }
            
            const isCheckpoint = CHECKPOINT_LIST != null ? CHECKPOINT_LIST.includes(i) : (i < LENGTH && i % CHECKPOINT_EVERY === 0);
            if (isCheckpoint) {
                await history.createCheckpoint('CP' + i);
            }

            if (i === CLEANUP_BLOCK) {
                await history.createCheckpoint('CLEANUP');
            }
            if (i === SET_CLEANUP_BLOCK_AT) {
                await setCleanupBlock('CLEANUP');
            }
        }
    }
    
    async function replaceWriteVpContract() {
        await simulator.replaceWriteVpContract(governance);
    }

    async function replaceReadVpContract() {
        await simulator.replaceReadVpContract(governance);
    }

    async function setCleanupBlock(checkpointId: string) {
        await simulator.setCleanupBlock(governance, checkpointId);
    }

    async function testDeposit() {
        const to = randomChoice(accounts);
        const amount = randomInt(INIT_AMOUNT);
        await simulator.deposit(to, amount);
    }

    async function testWithdraw() {
        const from = randomChoice(accounts);
        const balance = history.state.balances.get(from).toNumber();
        const amount = coinFlip(0.9) ? randomInt(balance) : randomInt(INIT_AMOUNT);
        await simulator.withdraw(from, amount);
    }

    async function testDepositTo() {
        const from = randomChoice(accounts);
        const to = randomChoice(accounts);
        const amount = randomInt(INIT_AMOUNT);
        await simulator.depositTo(from, to, amount);
    }

    async function testWithdrawFrom() {
        const sender = randomChoice(accounts);
        const from = randomChoice(accounts);
        const balance = history.state.balances.get(from).toNumber();
        const amount = coinFlip(0.9) ? randomInt(balance) : randomInt(INIT_AMOUNT);
        const approval = randomInt(0.9 * amount, 1.1 * amount);
        await simulator.approve(from, sender, approval);
        await simulator.withdrawFrom(sender, from, amount);
    }

    async function testTransfer() {
        const from = randomChoice(accounts);
        const to = randomChoice(accounts);
        const balance = history.state.balances.get(from).toNumber();
        const amount = coinFlip(0.9) ? randomInt(balance) : randomInt(INIT_AMOUNT);
        await simulator.transfer(from, to, amount);
    }

    async function testDelegate() {
        const from = randomChoice(coinFlip(0.9) ? percentageAccounts : otherAccounts);
        const to = randomChoice(accounts);
        const currentDelegation = history.state.bipsDelegations.row(from).total().toNumber();
        const bips = currentDelegation !== 0 && currentDelegation !== MAX_BIPS && coinFlip(0.8)
            ? MAX_BIPS - currentDelegation                          // delegate all should be common
            : randomIntDist(0, MAX_BIPS, linearFallingRandom);      // delegate any
        await simulator.delegate(from, to, bips);
    }

    async function testDelegateExplicit() {
        const from = randomChoice(coinFlip(0.9) ? explicitAccounts : otherAccounts);
        const to = randomChoice(accounts);
        const balance = history.state.balances.get(from).toNumber();
        const amount = randomIntDist(0, balance, linearFallingRandom);
        await simulator.delegateExplicit(from, to, amount);
    }

    async function testDelegateGovernance() {
        const from = randomChoice(accounts);
        const to = randomChoice(accounts);
        await simulator.delegateGovernance(from, to, MAX_BIPS);
    }

    async function testRevokeDelegationAt() {
        const checkpoints = history.checkpointList();
        if (checkpoints.length === 0) return;
        const cp = checkpoints[checkpoints.length - 1];
        const from = randomChoice(accounts);
        const fromDelegates = cp.state.delegateesOf(from);
        const to = randomChoice(fromDelegates.length > 0 && coinFlip(0.9) ? fromDelegates : accounts);
        await simulator.revokeDelegationAt(from, to, cp.id);
    }

    async function testUndelegateAll() {
        const from = randomChoice(coinFlip(0.9) ? percentageAccounts : otherAccounts);
        await simulator.undelegateAll(from);
    }

    async function testUndelegateAllExplicit() {
        const from = randomChoice(coinFlip(0.9) ? explicitAccounts : otherAccounts);
        const fromDelegates = Array.from(history.state.amountDelegations.rowMap(from).keys());
        await simulator.undelegateAllExplicit(from, fromDelegates);
    }

    async function testUndelegateGovernance() {
        const from = randomChoice(accounts);
        await simulator.undelegateGovernance(from);
    }

    async function testVotePowerAtCached() {
        const checkpoints = history.checkpointList();
        if (checkpoints.length === 0) return;
        const cp = randomChoice(checkpoints);
        await simulator.totalVotePowerAtCached(plainuser, cp.id);
    }

    async function testVotePowerOfAtCached() {
        const checkpoints = history.checkpointList();
        if (checkpoints.length === 0) return;
        const cp = randomChoice(checkpoints);
        const from = randomChoice(accounts);
        await simulator.votePowerOfAtCached(plainuser, from, cp.id);
    }

    async function performChecks(
        vpToken: WNatInstance,
        history: VPTokenHistory,
        checkpoint: Nullable<Checkpoint>,
        governanceVP: GovernanceVotePowerInstance
    ) {
        const checker = checkpoint != null
            ? new VPTokenChecker(vpToken, checkpoint.blockNumber, accounts, checkpoint.state, governanceVP)
            : new VPTokenChecker(vpToken, null, accounts, history.state, governanceVP)

        const cpMsg = checkpoint ? `for checkpoint ${checkpoint.id}` : '';

        console.log("Checking invariants", cpMsg);
        await checker.checkInvariants();

        console.log("Checking state", cpMsg);
        await checker.checkStateMatch();
    }

    function saveHistory() {
        history.save('cache/history.json', 4);
        saveJson('cache/accounts.json', { N_ACCOUNTS, N_PERC_DLG, N_AMOUNT_DLG, governance, plainuser, accounts }, 4);
    }

    async function loadAndReplayHistory() {
        console.log("Replaying...");
        history.load('cache/history.json');
        for (const action of history.history) {
            await history.execute(action);
        }
        ({ N_ACCOUNTS, N_PERC_DLG, N_AMOUNT_DLG, governance, plainuser, accounts } = loadJson('cache/accounts.json'));
        percentageAccounts = accounts.slice(0, N_PERC_DLG);
        explicitAccounts = accounts.slice(N_PERC_DLG, N_PERC_DLG + N_AMOUNT_DLG);
        otherAccounts = accounts.slice(N_PERC_DLG + N_AMOUNT_DLG);
    }
});
