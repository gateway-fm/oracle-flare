import { JsonRpcProvider, StaticJsonRpcProvider } from "@ethersproject/providers";
import { BigNumber, Contract, Wallet } from "ethers";
import { ethers, network } from "hardhat";
import { HardhatNetworkAccountUserConfig } from "hardhat/types";
import { Contracts } from "../../../deployment/scripts/Contracts";
import hardhatConfig from "../../../hardhat.config";
import { FlareDaemon, FlareDaemon__factory, Ftso, FtsoManager, FtsoManager__factory, FtsoRegistry, FtsoRegistry__factory, FtsoRewardManager, FtsoRewardManager__factory, Ftso__factory, Inflation, Inflation__factory, PriceSubmitter, PriceSubmitter__factory, VoterWhitelister, VoterWhitelister__factory, VPContract__factory, WNat, WNat__factory } from "../../../typechain";
import { getTestFile } from "../../utils/constants";
import { BaseEvent, EthersEventDecoder, ethersEventIs, ethersFindEvent, formatBN } from "../../utils/EventDecoder";
import { toBigNumberFixedPrecision } from "../../utils/test-helpers";
import { BIG_NUMBER_ZERO, currentRealTime, randomShuffled, toNumber } from "../../utils/fuzzing-utils";
import { messageIncluded, getChainConfigParameters, internalFullDeploy, reportError } from "./EndToEndFuzzingUtils";
import { latestBlockTimestamp, PriceEpochTimes, RewardEpochTimes } from "./EpochTimes";
import { FtsoList, PriceProvider, PriceSimulator } from "./PriceProvider";
import { EventStateChecker, PriceAndRewardChecker } from "./StateChecker";
import { EthersTransactionRunner, NetworkType, SignerWithAddress } from "./TransactionRunner";
import { DelegatorAccount, UserAccount, UserEnvironment } from "./UserAccount";
import axios from "axios";
import { ChainParameters } from "../../../deployment/chain-config/chain-parameters";
const fs = require("fs");

contract(`EndToEndFuzzing.sol; ${getTestFile(__filename)}; End to end fuzzing tests`, accounts => {
    let env = process.env;

    const networkType: NetworkType = detectNetwork();
    if (networkType === NetworkType.SCDEV) {
        env.VM_FLARE_TEST = 'shift';
    }
    const RESERVED_ACCOUNTS = env.RESERVED_ACCOUNTS ? Number(env.RESERVED_ACCOUNTS) : 5;
    const N_PROVIDERS = env.N_PROVIDERS ? Number(env.N_PROVIDERS) : 15;
    const N_DELEGATORS = env.N_DELEGATORS ? Number(env.N_DELEGATORS) : 5;
    const LOOPS = env.LOOPS ? Number(env.LOOPS) : 100;
    const MAX_PRICE_JUMP = env.MAX_PRICE_JUMP ? Number(env.MAX_PRICE_JUMP) : 1.1;
    const RUN_PARALLEL = env.RUN_PARALLEL !== 'false';
    const BIG_JUMP_EVERY = env.BIG_JUMP_EVERY ? Number(env.BIG_JUMP_EVERY) : null;
    const BIG_JUMP_ON = env.BIG_JUMP_ON ? env.BIG_JUMP_ON.split(',').map(Number) : [];
    const BIG_JUMP_SECONDS = env.BIG_JUMP_SECONDS ? Number(env.BIG_JUMP_SECONDS) : 3600;
    const AVOID_ERRORS = env.AVOID_ERRORS !== 'false';      // avoid errors if true (default)
    const RUN_CHECKERS = env.RUN_CHECKERS !== 'false';      // disable event checking? (might be needed for long running scdev)
    const AUTO_RUN_TRIGGER = env.AUTO_RUN_TRIGGER ? Number(env.AUTO_RUN_TRIGGER) : 10;   // on hardhat, trigger every this many transaction runs
    const MINING_BATCH_SIZE = env.MINING_BATCH_SIZE ? Number(env.MINING_BATCH_SIZE) : null;   // on hardhat without automining, trigger mining every this many transaction runs
    const CHAIN_CONFIG = env.CHAIN_CONFIG ? JSON.parse(env.CHAIN_CONFIG) : null;

    let signers: SignerWithAddress[];
    let governance: SignerWithAddress;
    let executor: SignerWithAddress;

    // contract instances
    let flareDaemon: FlareDaemon;
    let ftsoRewardManager: FtsoRewardManager;
    let ftsoManager: FtsoManager;
    let priceSubmiter: PriceSubmitter;
    let wNat: WNat;
    let ftsoWnat: Ftso;
    let registry: FtsoRegistry;
    let voterWhitelister: VoterWhitelister;
    let inflation: Inflation;

    let contractDict: { [name: string]: Contract };
    let contractByAddressDict: { [name: string]: Contract };

    // epoch times
    let priceEpochs: PriceEpochTimes;
    let rewardEpochs: RewardEpochTimes;

    // runners
    let eventDecoder: EthersEventDecoder;
    let transactionRunner: EthersTransactionRunner;

    function detectNetwork() {
        const network = process.env.NETWORK;
        switch (network) {
            case 'scdev': return NetworkType.SCDEV;
            default: return NetworkType.HARDHAT;
        }
    }

    async function setTestContracts(contracts: Contracts) {
        // Wire up needed contracts
        flareDaemon = FlareDaemon__factory.connect(contracts.getContractAddress(Contracts.FLARE_DAEMON), signers[0]);
        ftsoRewardManager = FtsoRewardManager__factory.connect(contracts.getContractAddress(Contracts.FTSO_REWARD_MANAGER), signers[0]);
        ftsoManager = FtsoManager__factory.connect(contracts.getContractAddress(Contracts.FTSO_MANAGER), signers[0]);
        priceSubmiter = PriceSubmitter__factory.connect(contracts.getContractAddress(Contracts.PRICE_SUBMITTER), signers[0]);
        voterWhitelister = VoterWhitelister__factory.connect(contracts.getContractAddress(Contracts.VOTER_WHITELISTER), signers[0]);
        registry = FtsoRegistry__factory.connect(contracts.getContractAddress(Contracts.FTSO_REGISTRY), signers[0]);
        inflation = Inflation__factory.connect(contracts.getContractAddress(Contracts.INFLATION), signers[0]);

        // All tokens
        wNat = WNat__factory.connect(contracts.getContractAddress(Contracts.WNAT), signers[0]);
        ftsoWnat = Ftso__factory.connect(contracts.getContractAddress(Contracts.FTSO_WNAT), signers[0]);

        // set up time epochs
        priceEpochs = await PriceEpochTimes.forFtso(ftsoWnat);
        rewardEpochs = await RewardEpochTimes.forFtsoManager(ftsoManager);

        // generic dict of all deployed contracts
        [contractDict, contractByAddressDict] = await createContractDict(contracts);
    }

    async function createContractDict(contracts: Contracts) {
        const result: { [name: string]: Contract } = {};
        const resultByAddress: { [address: string]: Contract } = {};
        for (const contract of contracts.allContracts()) {
            const contractName = contract.contractName.replace(/\.sol$/, '');
            // let contractFactory = await ethers.getContractFactory(contractName, signers[0]);
            // const instance = contractFactory.attach(contract.address);
            const instance = await ethers.getContractAt(contractName, contract.address, signers[0]);
            const instanceName = contract.name.slice(0, 1).toLowerCase() + contract.name.slice(1);
            result[instanceName] = instance;
            resultByAddress[contract.address] = instance;
            if ('writeVotePowerContract' in instance) {
                result[`${instanceName}VPContract`] = VPContract__factory.connect(await instance.writeVotePowerContract(), signers[0]);
            }
        }
        return [result, resultByAddress];
    }

    async function createPriceSimulator() {
        const initialPriceDict: { [name: string]: number } = {
            NAT: 0.40,
            XRP: 1.50,
            LTC: 340,
            DOGE: 0.45,
            DGB: 0.11,
            ADA: 1.90,
            ALGO: 1.33,
            BCH: 1203,
            BTC: 20000,
            ETH: 2000,
            XLM: 10,
            FIL: 1.2,
        }

        const { 0: indices, 1: ftsoSymbols, 2: ftsoAddresses } = await registry.getSupportedIndicesSymbolsAndFtsos();

        // create list of ftsos and corresponding prices
        const ftsos: Ftso[] = [];
        const ftsoIndices: BigNumber[] = [];
        const initialPrices: number[] = [];
        for (let i = 0; i < ftsoAddresses.length; i++) {
            const symbol = ftsoSymbols[i];
            if (symbol in initialPriceDict) {
                ftsos.push(contractByAddressDict[ftsoAddresses[i]] as Ftso);
                ftsoIndices.push(indices[i]);
                initialPrices.push(initialPriceDict[symbol]);
            }
        }

        const timestamp = await latestBlockTimestamp(true);
        const maxPriceJumpPerSec = Math.pow(MAX_PRICE_JUMP, 1 / priceEpochs.priceEpochDurationSeconds);
        const ftsoList = new FtsoList(ftsos, ftsoIndices);
        const priceSimulator = new PriceSimulator(ftsoList, initialPrices, timestamp, maxPriceJumpPerSec);
        return priceSimulator;
    }

    function containsInterestingEvents(events: BaseEvent[], start: number, end: number) {
        for (let i = start; i < end; i++) {
            if (events[i].event !== 'ContractDaemonized') {
                return true;
            };
        }
        return false;
    }

    function getProviders(): JsonRpcProvider[] {
        if (networkType === NetworkType.HARDHAT) {
            return [ethers.provider];
        } else {
            const jsonRpcAddresses = [9650, 9652];
            // const jsonRpcAddresses = [9650];
            return jsonRpcAddresses.map(port => new StaticJsonRpcProvider(`http://127.0.0.1:${port}/ext/bc/C/rpc`));
        }
    }

    function getSigners(providers: JsonRpcProvider[], nAccounts: number) {
        const accounts = hardhatConfig.networks?.hardhat?.accounts as HardhatNetworkAccountUserConfig[];
        const result: SignerWithAddress[] = [];
        for (let i = 0; i < nAccounts; i++) {
            const wallet = new Wallet(accounts[i].privateKey, providers[i % providers.length]);
            result.push(wallet);
        }
        return result;
    }

    let annualInflationWei: BigNumber = BIG_NUMBER_ZERO;
    let maxAuthorizedInflationWei: BigNumber = BIG_NUMBER_ZERO;

    async function increaseMaxMintingRequest() {
        try {
            const maxMintingRequestWei = await flareDaemon.maxMintingRequestWei();
            const newMaxMintingRequestWei = maxMintingRequestWei.mul(110).div(100);   // multiply by 1.1 - max allowed per day
            if (newMaxMintingRequestWei.gt(annualInflationWei)) return;
            // setMaxMintingRequest (possibly with timelock)
            const response = await transactionRunner.runMethod(flareDaemon, f => f.setMaxMintingRequest(newMaxMintingRequestWei, { gasLimit: 1_000_000 }),
                { signer: governance, method: "flareDaemon.setMaxMintingRequest()", comment: `Increasing maxMintingRequest to ${formatBN(newMaxMintingRequestWei)}` });
            const event = ethersFindEvent(response.allEvents, flareDaemon, 'GovernanceCallTimelocked');
            if (event) {    // timelocked?
                await transactionRunner.skipToTime(event.args.allowedAfterTimestamp.toNumber() + 1);
                await transactionRunner.runMethod(flareDaemon, f => f.executeGovernanceCall(event.args.selector, { gasLimit: 1_000_000 }),
                    { signer: executor, method: "flareDaemon.executeGovernanceCall()", comment: `Executing timelocked call to flareDaemon.setMaxMintingRequest()` });
            }
        } catch (e) {
            transactionRunner.logUnexpectedError(e);
        }
    }

    async function handleSystemEvents(events: BaseEvent[], start: number, end: number) {
        for (let i = start; i < end; i++) {
            const event = events[i];
            // make sure topup request grows soon enough as we are limited per day
            // for that, increase maxMintingRequest every time authorized inflation grows
            if (ethersEventIs(event, inflation, 'NewAnnumInitialized')) {
                annualInflationWei = event.args.recognizedInflationWei;
            }
            if (ethersEventIs(event, inflation, 'InflationAuthorized')) {
                if (event.args.amountWei.gt(maxAuthorizedInflationWei)) {
                    transactionRunner.comment(`Authorized inflation increased to ${formatBN(event.args.amountWei)}`);
                    await increaseMaxMintingRequest();
                    maxAuthorizedInflationWei = event.args.amountWei;
                }
            }
        }
    }

    function getConfigParameters(filename: string, updates: any) {
        const parameters = getChainConfigParameters(filename);
        if (updates != null) {
            for (const [key, value] of Object.entries(updates)) {
                if (!(key in parameters)) {
                    throw new Error(`Invalid parameter ${key}`);
                }
                console.log(`Setting deploy parameter ${key} = ${JSON.stringify(value)}`);
                (parameters as any)[key] = value;
            }
        }
        return parameters;
    }
    
    function signerForAddress(address: string) {
        const signer = signers.find(signer => signer.address === address);
        if(signer == null) assert.fail(`Missing signer with address ${address}`);
        return signer;
    }

    before(async () => {
        console.log(`Network = ${networkType}`);
        signers = getSigners(getProviders(), RESERVED_ACCOUNTS + N_DELEGATORS + N_PROVIDERS);
        let parameters: ChainParameters;
        if (networkType === NetworkType.HARDHAT) {
            console.log("Deploying contracts...");
            parameters = getConfigParameters(`test/fuzzing/endtoend/fuzzing-chain-config.json`, CHAIN_CONFIG);
            const deployed = await internalFullDeploy(parameters, true);
            console.log("...deployed");
            await setTestContracts(deployed.contracts!);
        } else {
            const contracts = new Contracts();
            parameters = getConfigParameters(`deployment/chain-config/scdev.json`, {});
            contracts.deserializeFile('deployment/deploys/scdev.json');
            await setTestContracts(contracts);
        }
        // create event decoder for all contracts
        eventDecoder = new EthersEventDecoder(contractDict);
        eventDecoder.addAddress('defaultAccount', signers[0].address);
        // after deploy, governance was transferred to account 1
        governance = signerForAddress(parameters.governancePublicKey);
        eventDecoder.addAddress('governance', governance.address);
        executor = signerForAddress(parameters.governanceExecutorPublicKey);
        eventDecoder.addAddress('executor', executor.address);
        // set runner
        transactionRunner = new EthersTransactionRunner(networkType, signers[0], flareDaemon, eventDecoder);
        transactionRunner.openLog("test_logs/end-to-end-fuzzing.log");
        transactionRunner.comment(`Extra parameters = ${JSON.stringify(CHAIN_CONFIG, null, 4)}`);
        transactionRunner.autoRunTrigger = AUTO_RUN_TRIGGER;
        if (networkType === NetworkType.HARDHAT) {
            // switch off auto mine mode when MINING_BATCH_SIZE != null
            await network.provider.send('evm_setAutomine', [MINING_BATCH_SIZE == null]);
            await network.provider.send("evm_setIntervalMining", [0]);
            transactionRunner.miningBatchSize = MINING_BATCH_SIZE; // turn on mining in transactionRunner
        }
    });

    let is_passing = true;
    
    async function uploadBadge() {
        let BadgeStorageURL = process.env.BADGE_URL;
        if (!BadgeStorageURL) return;
        let fromMaster = true;
        // if (process.env.FROM_MASTER) {
        //     fromMaster = process.env.FROM_MASTER
        // }
        let badge_data;
        if (!is_passing) {
            badge_data = {
                "name": "FlareSCE2EFuzzer",
                "schemaVersion": 1,
                "label": "E2E Fuzzer",
                "color": "red",
                "message": "Fail"
            };
        } else {
            badge_data = {
                "name": "FlareSCE2EFuzzer",
                "schemaVersion": 1,
                "label": "E2E Fuzzer",
                "color": "green",
                "message": "Pass"
            };
        }
        if (fromMaster) {
            await axios.post(
                BadgeStorageURL + "api/0/badges",
                badge_data
            );
        }
    }
    
    afterEach(function () {
        const status = this.currentTest?.state
        if (status === "failed") {
            is_passing = false;
        }
    })

    after(async () => {
        transactionRunner.logGasUsage();
        transactionRunner.closeLog();
        await uploadBadge();

    });

    function checkForbiddenErrors() {
        // in AVOID_ERRORS mode, we have strict error checking - all errors are forbidden,
        // except for those that cannot be avoided (due to timing issues)
        const allowedErrors = ['Wrong epoch id', 'vote power too low', 'Not whitelisted'];
        // if AVOID_ERRORS=false, then all errors, expected by methods, are allowed, but assertion failures are forbidden (in solidity and ts)
        const forbiddenErrors = ['Transaction reverted without a reason', 'invalid opcode', 'AssertionError'];
        // count unexpectd / forbidden errors
        let unexpectedErrors = transactionRunner.unexpectedErrorCount;
        for (const [key, count] of transactionRunner.errorCounts.entries()) {
            const forbidden = AVOID_ERRORS ? !messageIncluded(key, allowedErrors) : messageIncluded(key, forbiddenErrors);
            if (forbidden) {
                console.error(`Unexpected error: ${key} (${count})`);
                unexpectedErrors += count;
            }
        }
        assert(unexpectedErrors === 0, `There were ${unexpectedErrors} unexpected errors`);
    }
    
    it("(almost) realtime fuzzing test", async () => {
        const startTimestamp = await latestBlockTimestamp();
        const startRealTime = currentRealTime();
        transactionRunner.startRealTime = startRealTime;

        // listen to events
        const events: BaseEvent[] = [];
        transactionRunner.eventHandlers.set('SimulationRunner', (event) => {
            events.push(event);
        });

        // Define ftsos
        const priceSimulator = await createPriceSimulator();

        // Define delegators and providers
        let delegatorSigners = signers.slice(RESERVED_ACCOUNTS, RESERVED_ACCOUNTS + N_DELEGATORS);
        let providerSigners = signers.slice(RESERVED_ACCOUNTS + N_DELEGATORS, RESERVED_ACCOUNTS + N_DELEGATORS + N_PROVIDERS);

        const delegators = delegatorSigners.map(
            (address, i) => new DelegatorAccount(`delegator_${i + 1}`, address, transactionRunner, ftsoRewardManager));

        const providers = providerSigners.map(
            (address, i) => new PriceProvider(`provider_${i + 1}`, address, transactionRunner, ftsoRewardManager, priceSubmiter, priceSimulator));

        // combined delegators and providers
        const users: UserAccount[] = [...delegators, ...providers];

        // set environment
        const userEnvironment: UserEnvironment = {
            users, avoidErrors: AVOID_ERRORS,
            flareDaemon, ftsoManager, ftsoRewardManager, wNat, ftsoWnat, priceSubmiter, registry, voterWhitelister,
        };

        // Mint some WNAT for each delegator and price provider
        const someNAT = toBigNumberFixedPrecision(3_000_000_000, 18);
        transactionRunner.comment(`Depositing ${formatBN(someNAT)} NAT to ${users.length} users`);
        await transactionRunner.runAll(RUN_PARALLEL, users, async user => {
            user.environment = userEnvironment;
            await user.deposit(wNat, someNAT);
        });

        // Jump to reward epoch start
        await transactionRunner.skipToTime(rewardEpochs.epochStartTime(0));

        // whitelist providers
        await transactionRunner.runAll(RUN_PARALLEL, providers, async provider => {
            await provider.fullWhitelistProvider();
        });

        // create checkers
        const checkers: EventStateChecker[] = [
            new PriceAndRewardChecker(transactionRunner, eventDecoder, userEnvironment),
        ];

        // start simulation
        let currentPriceEpoch = toNumber(await ftsoWnat.getCurrentEpochId());
        let currentRevealEpoch = currentPriceEpoch - 1;    // this one will not be used
        events.push({ address: 'fake', event: 'SubmitEpochStarted', args: { epochId: currentPriceEpoch } });
        transactionRunner.comment(`PRICE EPOCH START:  submitEpoch=${currentPriceEpoch}`);
        
        // enable reward claiming
        await transactionRunner.runMethod(ftsoRewardManager, f => f.enableClaims({ gasLimit: 1_000_000 }),
            { signer: governance, method: "ftsoRewardManager.enableClaims()", comment: `Enabling ftso reward claims` });

        // run very long loop
        let startEvent = 0;
        let bigJumpTime = false;
        let bigJumpOccured = false;

        try {
            for (let loop = 1; loop <= LOOPS; loop++) {
                const latestTime = await latestBlockTimestamp();
                const latestRealTime = currentRealTime();
                transactionRunner.comment(`LOOP ${loop}, time = ${latestTime} (${latestTime - startTimestamp}s since start), ` +
                    `real time ${(latestRealTime - startRealTime).toFixed(3)}s`);

                // time for large timeshift?
                if ((BIG_JUMP_EVERY != null && loop % BIG_JUMP_EVERY === 0) || BIG_JUMP_ON.includes(loop)) {
                    bigJumpTime = true;
                }

                // allow flare daemon to do its work and possibly add events
                for (let i = 0; i < 3; i++) {
                    const tx = await transactionRunner.triggerFlareDaemon(true);
                    if (tx && !containsInterestingEvents(tx.allEvents, 0, tx.allEvents.length)) break;
                }

                // add fake events for start of price/reveal epoch
                const priceEpoch = toNumber(await ftsoWnat.getCurrentEpochId());
                const lastUnprocessedEpochData = await ftsoManager.getLastUnprocessedPriceEpochData();
                const lastUnprocessedPriceEpoch = toNumber(lastUnprocessedEpochData._lastUnprocessedPriceEpoch);
                const lastUnprocessedPriceEpochInitialized = lastUnprocessedEpochData._lastUnprocessedPriceEpochInitialized;
                if (priceEpoch > currentPriceEpoch && lastUnprocessedPriceEpoch >= priceEpoch - 1 && lastUnprocessedPriceEpochInitialized) {
                    currentPriceEpoch = priceEpoch;
                    events.push({ address: 'fake', event: 'SubmitEpochStarted', args: { epochId: currentPriceEpoch } });
                    transactionRunner.comment(`PRICE EPOCH START:  submitEpoch=${currentPriceEpoch}  revealEpoch=${currentRevealEpoch}`);
                    if (lastUnprocessedPriceEpoch === priceEpoch - 1) {
                        currentRevealEpoch = lastUnprocessedPriceEpoch;
                        events.push({ address: 'fake', event: 'RevealEpochStarted', args: { epochId: currentRevealEpoch } });
                        transactionRunner.comment(`REVEAL EPOCH START:  submitEpoch=${currentPriceEpoch}  revealEpoch=${currentRevealEpoch}`);
                    }
                }

                // proces intervals in [startEvent, endEvent)
                const endEvent = events.length;
                const interestingEvents = containsInterestingEvents(events, startEvent, endEvent);
                // detect boring times and skip some more time
                if (interestingEvents) {
                    const runUsers = randomShuffled(users);
                    // run all account updates
                    await transactionRunner.runAll(RUN_PARALLEL, runUsers, async user => {
                        await user.runStep(events, startEvent, endEvent);
                    });
                    // hacks and fixes
                    await handleSystemEvents(events, startEvent, endEvent);
                    //
                    bigJumpOccured = false;
                } else {
                    // skip some time
                    const timestamp = await latestBlockTimestamp();
                    const timeskip = bigJumpTime ? BIG_JUMP_SECONDS : Math.round(priceEpochs.revealEpochDurationSeconds / 2);
                    await transactionRunner.skipToTime(timestamp + timeskip);
                    bigJumpOccured = bigJumpTime;
                    bigJumpTime = false;
                }
                // run all checkers
                if (RUN_CHECKERS) {
                    for (const checker of checkers) {
                        await checker.check(events, startEvent, endEvent);
                    }
                }
                // process next batch of events
                startEvent = endEvent;
            }
        } catch (e) {
            transactionRunner.logUnexpectedError(e);
        }

        const endTimestamp = await latestBlockTimestamp();
        transactionRunner.comment(`Total network time ${endTimestamp - startTimestamp}s`);
        
        // check errors
        checkForbiddenErrors();
    });
});
