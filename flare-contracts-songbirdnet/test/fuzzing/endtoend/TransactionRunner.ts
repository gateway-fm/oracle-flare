import { TransactionReceipt as EthersTransactionReceipt, TransactionResponse as EthersTransactionResponse } from "@ethersproject/abstract-provider";
import { constants, time } from "@openzeppelin/test-helpers";
import { BaseContract, ContractTransaction, Signer } from "ethers";
import { network } from "hardhat";
import { FlareDaemon } from "../../../typechain";
import { FlareDaemonInstance } from "../../../typechain-truffle";
import { BaseEvent, EthersEventDecoder, ethersFindEvent, findEvent, TruffleEvent, Web3EventDecoder } from "../../utils/EventDecoder";
import { currentRealTime, Statistics } from "../../utils/fuzzing-utils";
import { LogFile } from "../../utils/LogFile";
import { foreachAsyncParallel, foreachAsyncSerial, increaseTimeTo, sleep, toBN, waitFinalize3 } from "../../utils/test-helpers";
import { reportError } from "./EndToEndFuzzingUtils";

export enum NetworkType { HARDHAT, SCDEV };

export interface SignerWithAddress extends Signer {
    readonly address: string;
}

export interface RunTransactionOptions {
    from?: string;
    signer?: SignerWithAddress;
    text?: string;
    method?: string;
    comment?: string;
    methodCall?: [contract: BaseContract, func: (c: any) => Promise<EthersTransactionResponse>];  // only used internally
};

export type EventHandler = (event: TruffleEvent) => void;

export interface TypedContract extends BaseContract {
    connect(signer: Signer): this;
    attach(addressOrName: string): this;
    deployed(): Promise<this>;
}


// if flareDaemon is not at this address, trigger() must be called manually
export const AUTOMATIC_FLARE_DAEMON_ADDRESS = "0x1000000000000000000000000000000000000002";

export interface TransactionResult<EVENTS extends Truffle.AnyEvent> {
    tx: string;                                 // transaction hash
    receipt: TransactionReceipt;                // typed transaction receipt
    logs: Truffle.TransactionLog<EVENTS>[];     // typed events (only those emitted from called contract address)
    allEvents: TruffleEvent[];                  // all events emitted during transaction
}

export interface EthersTransactionResult {
    receipt: EthersTransactionReceipt;          // typed transaction receipt
    allEvents: TruffleEvent[];                  // all events emitted during transaction
}

export function ethersExpectEvent(tx: EthersTransactionResult, eventName: string) {
    const event = tx.allEvents.find(ev => ev.event === eventName);
    assert.isNotNull(event, `Missing expected event ${eventName}`);
}

export abstract class TransactionRunnerBase {
    logFile?: LogFile;
    eventHandlers: Map<string, EventHandler> = new Map();
    gasUsage: Map<string, Statistics> = new Map();
    errorCounts: Map<String, number> = new Map();
    eventCounts: Map<String, number> = new Map();
    unexpectedErrorCount: number = 0;

    // parameters - may be changed
    autoRunTrigger: number | null = null;             // if non-null, trigger is run every `autoRunTrigger` transactions (on Hardhat)
    flareDaemonGas = 50_000_000;

    constructor(
        public readonly network: NetworkType
    ) {
    }

    get hardhatNetwork() {
        return this.network === NetworkType.HARDHAT;
    }

    openLog(path: string) {
        this.logFile = new LogFile(path);
    }

    closeLog() {
        if (this.logFile) {
            this.logFile.close();
            this.logFile = undefined;
        }
    }

    log(text: string) {
        if (this.logFile) {
            this.logFile.log(text);
        }
    }
    
    logUnexpectedError(e: any) {
        reportError(e);
        this.log(`    !!! UNEXPECTED ${('' + e.stack)?.replace(/\n/g, '\n        ') || e}`);
        this.unexpectedErrorCount += 1;
    }

    comment(comment: string) {
        console.log(comment);
        this.log('****** ' + comment);
    }

    abstract triggerFlareDaemon(manual: boolean): Promise<any>;

    async skipToTime(timestamp: number) {
        const currentTime = (await time.latest()).toNumber();
        this.comment(`Skipping time to ${timestamp} (${timestamp - currentTime}s)`);
        if (timestamp > currentTime) {
            await increaseTimeTo(timestamp);
            await this.triggerFlareDaemon(false);
        } else {
            console.warn("Trying to skip to the past");
        }
    }

    logGasUsage() {
        if (!this.logFile) return;
        const methods = Array.from(this.gasUsage.keys());
        methods.sort();
        this.log('');
        this.log(`ERRORS: ${Array.from(this.errorCounts.values()).reduce((x, y) => x + y, 0)}`);
        for (const [key, count] of this.errorCounts.entries()) {
            this.log(`${key}: ${count}`);
        }
        this.log('');
        this.log(`EVENTS: ${Array.from(this.eventCounts.values()).reduce((x, y) => x + y, 0)}`);
        for (const [key, count] of this.eventCounts.entries()) {
            this.log(`${key}: ${count}`);
        }
        this.log('');
        this.log('GAS USAGE');
        for (const method of methods) {
            this.log(`${method}:   ${this.gasUsage.get(method)?.toString(0)}`);
        }
    }
    
    increaseErrorCount(error: any) {
        const errorKey = (error + '').replace(/^.*:\s*revert\s*/, '').trim();
        this.errorCounts.set(errorKey, (this.errorCounts.get(errorKey) ?? 0) + 1);
    }

    increaseEventCount(event: BaseEvent) {
        this.eventCounts.set(event.event, (this.eventCounts.get(event.event) ?? 0) + 1);
    }
}

export class TruffleTransactionRunner extends TransactionRunnerBase {
    constructor(
        network: NetworkType,
        public defaultAccount: string,
        public flareDaemon: FlareDaemonInstance,
        public eventDecoder: Web3EventDecoder,
    ) {
        super(network);
    }

    // auto trigger is only run every `autoRunTrigger` transactions, to prevent too much slowdown
    private transactionRunCount: number = 0;
    private lastTriggerRun: number = -1000; // always trigger on first run

    async run<T extends Truffle.AnyEvent>(transactionCall: () => Promise<Truffle.TransactionResponse<T> | TransactionReceipt>, options?: RunTransactionOptions): Promise<TransactionResult<T>> {
        ++this.transactionRunCount;
        if (this.mockFlareDaemon() && this.autoRunTrigger != null && (this.transactionRunCount - this.lastTriggerRun >= this.autoRunTrigger)) {
            // when flare daemon is not in genesis block, trigger must be called manually
            await this.triggerFlareDaemon(false);
        }
        // run the transaction
        return this._run(transactionCall, options);
    }

    // lock to make sure only one daemon trigger is running at a time
    private triggerRunning = false;

    async triggerFlareDaemon(manual: boolean) {
        if (this.triggerRunning) return;
        this.triggerRunning = true;
        try {
            this.lastTriggerRun = this.transactionRunCount;
            if (this.mockFlareDaemon()) {
                const tx = await this._run(() => this.flareDaemon.trigger({ gas: this.flareDaemonGas }),
                    { from: this.defaultAccount, text: 'DAEMON TRIGGER', method: 'FlareDaemon.trigger()' });
                // if flareDaemon asks for minting, provide it (just like validator would in real network)
                await this.provideRequestedMinting(tx);
                return tx;
            } else if (manual) {
                // burn 1 wei to force mine a block
                return await this._run(() => web3.eth.sendTransaction({ from: this.defaultAccount, to: constants.ZERO_ADDRESS, value: toBN(1) }),
                    { from: this.defaultAccount, text: 'FORCE MINE', method: 'Burn1Wei()' });
            }
        } catch (e) {
            reportError(e);
        } finally {
            this.triggerRunning = false;
        }
    }

    private mockFlareDaemon() {
        return this.flareDaemon.address !== AUTOMATIC_FLARE_DAEMON_ADDRESS;
    }

    private async provideRequestedMinting(tx: Truffle.TransactionResponse<any>) {
        const event = findEvent(tx.logs, 'MintingRequestTriggered');
        if (event) {
            const mintRequest = toBN(event.args.amountWei);
            this.comment(`Minting ${mintRequest} wei to FlareDaemon`);
            await web3.eth.sendTransaction({ from: this.defaultAccount, to: this.flareDaemon.address, value: mintRequest });
        }
    }

    public startRealTime = new Date().getTime() / 1000;

    private async _run<T extends Truffle.AnyEvent>(transactionCall: () => Promise<Truffle.TransactionResponse<T> | TransactionReceipt>, options?: RunTransactionOptions): Promise<TransactionResult<T>> {
        const opts = { from: this.defaultAccount, ...(options ?? {}) };
        const txLog: string[] = []; // keep the logs together when running several transactions in parallel
        try {
            // print comment
            if (opts.comment) {
                console.log(opts.comment);
                txLog.push('****** ' + opts.comment);
            }
            // print info about called method
            const callText = opts.text ?? transactionCall.toString();
            if (this.logFile != null) {
                txLog.push(`${callText}  [from ${this.eventDecoder.formatAddress(opts.from)},  realtime=${(new Date().getTime() / 1000 - this.startRealTime).toFixed(3)}]`);
            }
            // run the transaction
            const callStartTime = currentRealTime();
            const tx = this.hardhatNetwork
                ? await transactionCall()
                : await waitFinalize3(opts.from, transactionCall);
            const callEndTime = currentRealTime();
            // extract transaction data
            const receipt: TransactionReceipt = 'receipt' in tx ? tx.receipt : tx;
            // make sure "from" field matches the one in actual call
            assert.equal(opts.from.toLowerCase(), receipt.from?.toLowerCase());
            // gas info
            const callMethod = opts.method ?? callText;
            if (!this.gasUsage.has(callMethod)) {
                this.gasUsage.set(callMethod, new Statistics());
            }
            this.gasUsage.get(callMethod)!.add(receipt.gasUsed);
            // read events
            const events = this.eventDecoder.decodeEvents(tx);
            // print events
            if (this.logFile != null) {
                txLog.push(`    GAS: ${receipt.gasUsed},  BLOCK: ${receipt.blockNumber},  DURATION(rt): ${(callEndTime - callStartTime).toFixed(3)}`);
                for (const event of events) {
                    txLog.push(`    ${this.eventDecoder.format(event)}`);
                    this.increaseEventCount(event);
                }
            }
            // call handlers
            for (const event of events) {
                for (const handler of this.eventHandlers.values()) {
                    handler(event);
                }
            }
            // return the result of transactionCall(), converted to have the same type for truffle and web3 calls
            if ('receipt' in tx) {
                return { ...tx, allEvents: events };   // only add `events` to truffle transaction
            } else {
                const logs = events.filter(e => e.address === receipt.from);    // emulate truffle `logs` field
                return { tx: receipt.transactionHash, receipt, logs, allEvents: events };
            }
        } catch (e) {
            txLog.push(`    !!! ${e}`);
            // console.log('INSPECT:', (e as object).constructor.name, Object.keys(e as object));
            this.increaseErrorCount(e);
            throw e;
        } finally {
            if (this.logFile != null) {
                this.log(txLog.join('\n'));
            }
        }
    }
}

export class EthersTransactionRunner extends TransactionRunnerBase {
    public flareDaemon: FlareDaemon;

    constructor(
        network: NetworkType,
        public defaultSigner: SignerWithAddress,
        flareDaemon: FlareDaemon,
        public eventDecoder: EthersEventDecoder,
    ) {
        super(network);
        this.flareDaemon = flareDaemon.connect(defaultSigner);
    }

    // batch auto mining
    public miningBatchSize: number | null = null;    // null to turn off auto mining
    public parallelism: number = 0;

    private transactionsSubmitting: number = 0;
    private transactionsToMine: number = 0;
    private transactionsMining: number = 0;

    private transactionsToTrigger: number = 0;
    private triggerRunning = false;

    async runMethod<T extends TypedContract>(contract: T, func: (c: T) => Promise<ContractTransaction>, options?: RunTransactionOptions): Promise<EthersTransactionResult> {
        const opts = { signer: this.defaultSigner, ...(options ?? {}) };
        opts.text ??= func.toString();
        const connectedContract = contract.signer === opts.signer ? contract : contract.connect(opts.signer);
        opts.methodCall = [connectedContract, func];
        return this.run(() => func(connectedContract), opts);
    }

    async runAll<T>(parallel: boolean, array: T[], func: (elt: T) => Promise<void>) {
        const foreach = parallel ? foreachAsyncParallel : foreachAsyncSerial;
        await foreach(array, async elt => {
            this.parallelism += 1;
            try {
                await func(elt);
            } finally {
                this.parallelism -= 1;
                await this.mineIfNeeded();
            }
        });
    }

    async run(transactionCall: () => Promise<EthersTransactionResponse>, options?: RunTransactionOptions): Promise<EthersTransactionResult> {
        if (this.mockFlareDaemon() && this.autoRunTrigger != null && ++this.transactionsToTrigger >= this.autoRunTrigger) {
            await this.triggerFlareDaemon(false);
        }
        // run the transaction
        return this._run(transactionCall, options);
    }

    async triggerFlareDaemon(manual: boolean) {
        if (this.triggerRunning) return;
        try {
            this.triggerRunning = true;
            if (this.mockFlareDaemon()) {
                const tx = await this._run(() => this.flareDaemon.trigger({ gasLimit: this.flareDaemonGas }),
                    { signer: this.defaultSigner, text: 'DAEMON TRIGGER', method: 'FlareDaemon.trigger()' });
                // if flareDaemon asks for minting, provide it (just like validator would in real network)
                await this.provideRequestedMinting(tx);
                return tx;
            } else if (manual) {
                // burn 1 wei to force mine a block
                return await this._run(() => this.defaultSigner.sendTransaction({ to: constants.ZERO_ADDRESS, value: 1 }),
                    { signer: this.defaultSigner, text: 'FORCE MINE', method: 'Burn1Wei()' });
            }
        } catch (e) {
            reportError(e);
        } finally {
            this.transactionsToTrigger = 0;
            this.triggerRunning = false;
        }
    }

    public async mineBlock() {
        if (!this.hardhatNetwork) return;
        if (this.transactionsToMine === 0) return;
        while (this.transactionsMining > 0) {
            await sleep(50);
        }
        if (this.miningBatchSize != null) {
            this.comment(`Mining ${this.transactionsToMine} transactions`);
            // console.log(`   toMine=${this.transactionsToMine} mining=${this.transactionsMining} submitting=${this.transactionsSubmitting} parallelism=${this.parallelism}`);
        }
        this.transactionsMining = this.transactionsToMine;
        this.transactionsToMine = 0;
        await network.provider.send('evm_mine', []);
    }

    public async mineIfNeeded() {
        if (this.miningBatchSize != null) {
            if (this.transactionsToMine >= Math.min(this.miningBatchSize, this.parallelism)) {
                await this.mineBlock();
            }
        }
    }

    private mockFlareDaemon() {
        return this.flareDaemon.address !== AUTOMATIC_FLARE_DAEMON_ADDRESS;
    }

    private async provideRequestedMinting(tx: EthersTransactionResult) {
        const event = ethersFindEvent(tx.allEvents, this.flareDaemon, 'MintingRequestTriggered');
        if (event) {
            const mintRequest = event.args.amountWei;
            this.comment(`Minting ${mintRequest} wei to FlareDaemon`);
            await this._run(() => this.defaultSigner.sendTransaction({ to: this.flareDaemon.address, value: mintRequest }),
                { signer: this.defaultSigner, text: 'MINT INFLATION', method: 'mintToFlareDaemon()' });
        }
    }

    private async waitRecipt(signer: Signer, resp: EthersTransactionResponse, confirmations: number = 1) {
        while (true) {
            const receipt = await signer.provider!.getTransactionReceipt(resp.hash);
            if (receipt && receipt.confirmations >= confirmations) return receipt;
            await sleep(50);
        }
    }

    private async methodCallError(methodCall?: [contract: BaseContract, func: (c: any) => Promise<EthersTransactionResponse>]): Promise<any> {
        try {
            // a hack to get correct stack traces (apparently not needed for auto mining)
            if (methodCall && (this.miningBatchSize != null || this.network !== NetworkType.HARDHAT)) {
                const [contract, method] = methodCall;
                await method(contract.callStatic);
            }
        } catch (e) {
            return e;
        }
        return null;
    }

    public startRealTime = new Date().getTime() / 1000;

    private async _run(transactionCall: () => Promise<EthersTransactionResponse>, options?: RunTransactionOptions): Promise<EthersTransactionResult> {
        const opts = { signer: this.defaultSigner, ...(options ?? {}) };
        const txLog: string[] = []; // keep the logs together when running several transactions in parallel
        try {
            // wait if currently mining or mining buffer is full
            while (this.transactionsMining > 0 || (this.miningBatchSize != null && this.transactionsToMine + this.transactionsSubmitting >= this.miningBatchSize)) {
                await sleep(50);
            }
            // print comment
            if (opts.comment) {
                console.log(opts.comment);
                txLog.push('****** ' + opts.comment);
            }
            // print info about called method
            const callText = opts.text ?? transactionCall.toString();
            if (this.logFile != null) {
                txLog.push(`${callText}  [from ${this.eventDecoder.formatAddress(opts.signer.address)},  realtime=${(new Date().getTime() / 1000 - this.startRealTime).toFixed(3)}]`);
            }
            // run the transaction
            const callStartTime = currentRealTime();
            const receipt = await this._submitAndWaitReceipt(opts.signer, transactionCall);
            const callEndTime = currentRealTime();
            // get usable error
            if (receipt.status === 0) {
                let callError = await this.methodCallError(opts.methodCall);
                if (callError == null) {
                    callError = new Error("Unknown error during method processing");
                }
                callError.gasUsed = receipt.gasUsed;
                callError.blockNumber = receipt.blockNumber;
                callError.duration = callEndTime - callStartTime;
                throw callError;
            }
            // make sure "signer" address field matches the one in actual call
            assert.equal(opts.signer.address.toLowerCase(), receipt.from.toLowerCase());
            // gas info
            const callMethod = opts.method ?? callText;
            if (!this.gasUsage.has(callMethod)) {
                this.gasUsage.set(callMethod, new Statistics());
            }
            this.gasUsage.get(callMethod)!.add(receipt.gasUsed.toNumber());
            // read events
            const events = this.eventDecoder.decodeEvents(receipt);
            // print events
            if (this.logFile != null) {
                txLog.push(`    GAS: ${receipt.gasUsed.toNumber()},  BLOCK: ${receipt.blockNumber},  DURATION(rt): ${(callEndTime - callStartTime).toFixed(3)}`);
                for (const event of events) {
                    this.increaseEventCount(event);
                    txLog.push(`    ${this.eventDecoder.format(event)}`);
                }
            }
            // call handlers
            for (const event of events) {
                for (const handler of this.eventHandlers.values()) {
                    handler(event);
                }
            }
            // return the result of transactionCall(), converted to have the same type for truffle and web3 calls
            return { receipt: receipt, allEvents: events };
        } catch (e: any) {
            txLog.push(`    GAS: ${e.gasUsed?.toNumber()},  BLOCK: ${e.blockNumber},  DURATION(rt): ${e.duration?.toFixed(3)}`);
            txLog.push(`    !!! ${e}`);
            // console.log('INSPECT:', (e as object).constructor.name, Object.keys(e as object));
            this.increaseErrorCount(e);
            throw e;
        } finally {
            if (this.logFile != null) {
                this.log(txLog.join('\n'));
            }
        }
    }

    scdevSubmitting: { [address: string]: number } = {};
    
    private async _submitAndWaitReceipt(signer: SignerWithAddress, transactionCall: () => Promise<EthersTransactionResponse>) {
        if (this.hardhatNetwork) {
            this.transactionsSubmitting += 1;
            // submit transaction
            const response = await transactionCall()
                .finally(() => {
                    this.transactionsSubmitting -= 1;
                });
            if (this.miningBatchSize != null) {
                this.transactionsToMine += 1;
                await this.mineIfNeeded();
            }
            const receipt = await this.waitRecipt(signer, response)
                .finally(() => {
                    if (this.miningBatchSize != null) {
                        this.transactionsMining -= 1;
                    }
                });
            return receipt;
        } else {
            // scdev - must wait finalization and lock (otherwise multiple txs with same nonce might be sent)
            this.scdevSubmitting[signer.address] ??= 0;
            const t0 = currentRealTime();
            while (this.scdevSubmitting[signer.address] > 0) {
                await sleep(50); 
            }
            const t1 = currentRealTime();
            this.scdevSubmitting[signer.address] += 1;
            // const nonce = await ethers.provider.getTransactionCount(signer.address);
            const response = await transactionCall();
            this.scdevSubmitting[signer.address] -= 1;
            const t2 = currentRealTime();
            //const receipt = await response.wait();
            const receipt = await this.waitRecipt(signer, response);
            const t3 = currentRealTime();
            // console.log(`TIME: wait=${(t1 - t0).toFixed(3)}, submit=${(t2 - t1).toFixed(3)}, mine=${(t3 - t2).toFixed(3)}`);
            // if (receipt.from !== signer.address) {
            //     throw new Error("Transaction from and signer mismatch, did you forget connect()?");
            // }
            // while ((await ethers.provider.getTransactionCount(signer.address)) == nonce) {
            //     await sleep(100);
            // }
            return receipt;
        }
    }
}

// export class TransactionRunner extends EthersTransactionRunner {};
