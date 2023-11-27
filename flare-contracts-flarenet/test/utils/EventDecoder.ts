import { EventFragment, ParamType } from "@ethersproject/abi";
import { Log as EthersRawEvent, TransactionReceipt as EthersTransactionReceipt } from "@ethersproject/abstract-provider";
import BN from "bn.js";
import { BigNumber, Contract, ContractReceipt, Event as EthersEvent } from "ethers";
import { TypedEventFilter } from "../../typechain/commons";
import { isNotNull, toBN } from "./test-helpers";

export interface BaseEvent {
    address: string;
    event: string;
    args: any;
}

export interface TypedEvent<A> extends BaseEvent {
    args: A;
}

export interface TruffleEvent extends Truffle.TransactionLog<any> {
    signature: string;
}

declare type RawEvent = import("web3-core").Log;

// truffle typed event filtering
export function findEvent<E extends Truffle.AnyEvent, N extends E['name']>(log: Truffle.TransactionLog<E>[], name: N): Truffle.TransactionLog<Extract<E, { name: N }>> | undefined {
    return log.find(e => e.event === name) as any;
}

export function filterEvents<E extends Truffle.AnyEvent, N extends E['name']>(log: Truffle.TransactionLog<E>[], name: N): Truffle.TransactionLog<Extract<E, { name: N }>>[] {
    return log.filter(e => e.event === name) as any;
}

export function eventIs<T extends Truffle.AnyEvent>(event: BaseEvent, name: string): event is Truffle.TransactionLog<T> {
    return event.event === name;
}

// ethers typed event filtering

export type EthersEventKeys<T extends { filters: {} }> = keyof T['filters'];

export type EthersEventArgs<T extends { filters: {} }, E extends keyof T['filters']> =
    T['filters'][E] extends (...args: any) => infer R ?
    (R extends TypedEventFilter<infer A, infer B> ? A & B : never) : never;

export type EthersEventType<T extends { filters: {} }, E extends keyof T['filters']> = 
    TypedEvent<EthersEventArgs<T, E>>;

export type StringOrNumberForBigNum<T extends {}> =
    { [K in keyof T]: T[K] extends BigNumber ? BigNumber | string | number : T[K] };

export type SimpleEthersEventArgs<T extends { filters: {} }, E extends keyof T['filters']> =
    Omit<StringOrNumberForBigNum<EthersEventArgs<T, E>>, keyof typeof Array.prototype>;
    
//export type EthersEventArgsForExcept<T extends { filters: {} }, E extends keyof T['filters']> =
    
    
export function ethersFindEvent<T extends Contract, E extends EthersEventKeys<T>>(events: BaseEvent[], contract: T, eventName: E, start: number = 0, end: number = events.length): EthersEventType<T, E> | undefined {
    for (let i = start; i < end; i++) {
        const event = events[i];
        if (event.address === contract.address && event.event === eventName) {
            return event;
        }
    }
}

export function ethersFilterEvents<T extends Contract, E extends EthersEventKeys<T>>(events: BaseEvent[], contract: T, eventName: E, start: number = 0, end: number = events.length): EthersEventType<T, E>[] {
    const result: EthersEventType<T, E>[] = [];
    for (let i = start; i < end; i++) {
        const event = events[i];
        if (event.address === contract.address && event.event === eventName) {
            result.push(event);
        }
    }
    return result;
}

export function ethersEventIs<T extends Contract, E extends EthersEventKeys<T>>(event: BaseEvent, contract: T, eventName: E): event is EthersEventType<T, E> {
    return event.address === contract.address && event.event === eventName;
}

export function expectEthersEvent<T extends Contract, E extends EthersEventKeys<T>>(tx: EthersTransactionReceipt | ContractReceipt, contract: T, eventName: E, args?: Partial<SimpleEthersEventArgs<T, E>>) {
    const eventDecoder = new EthersEventDecoder({ contract });
    const allEvents = eventDecoder.decodeEvents(tx);
    const events = ethersFilterEvents(allEvents, contract, eventName);
    if (events.length === 0) assert.fail(`Missing event ${String(eventName)}`);
    if (args != undefined) {
        let mismatch: [string, any] | undefined;
        for (const event of events) {
            mismatch = Object.entries(args)
                .find(([k, v]) => (event.args as any)[k]?.toString() !== (v as any)?.toString());
            if (mismatch == null) return;  // found exact match
        }
        const [mismatchKey, mismatchValue] = mismatch!;
        assert.fail(`Event ${String(eventName)} mismatch for '${mismatchKey}': ${mismatchValue} != ${(events[0].args as any)[mismatchKey]}`);
    }
}

export function expectEthersEventNotEmitted<T extends Contract, E extends EthersEventKeys<T>>(tx: EthersTransactionReceipt | ContractReceipt, contract: T, eventName: E) {
    const eventDecoder = new EthersEventDecoder({ contract });
    const allEvents = eventDecoder.decodeEvents(tx);
    const events = ethersFilterEvents(allEvents, contract, eventName);
    if (events.length > 0) assert.fail(`Expected event ${String(eventName)} not to be emitted`);
}

// event formatting

export function formatEvent(event: BaseEvent, contractName?: string, formattedArgs: any = event.args) {
    const keys = Object.keys(formattedArgs).filter(k => /^\d+$/.test(k)).map(k => Number(k));
    keys.sort((a, b) => a - b);
    const args = keys.map(k => formattedArgs[k]).map(x => web3.utils.isBN(x) ? x.toString() : x);
    return `${contractName ?? event.address}.${event.event}(${args.join(', ')})`;
}

export function formatEventByNames(event: BaseEvent, contractName?: string, formattedArgs: any = event.args) {
    const keys = Object.keys(formattedArgs).filter(k => !/^\d+$/.test(k) && k !== '__length__');
    const args = keys.map(k => formattedArgs[k]).map(x => web3.utils.isBN(x) ? x.toString() : x);
    const parts = keys.map((k, i) => `${k}: ${args[i]}`);
    return `${contractName ?? event.address}.${event.event}(${parts.join(', ')})`;
}

function groupIntegerDigits(x: string) {
    let startp = x.indexOf('.');
    if (startp < 0) startp = x.length;
    for (let p = startp - 3; p > 0; p -= 3) {
        x = x.slice(0, p) + '_' + x.slice(p); x
    }
    return x;
}

export function formatBN(x: BigNumber | BN | string | number) {
    const xs = x.toString();
    if (xs.length >= 18) {
        const dec = Math.max(0, 22 - xs.length);
        const xm = (Number(xs) / 1e18).toFixed(dec);
        return groupIntegerDigits(xm) + 'e+18';
    } else {
        return groupIntegerDigits(xs);
    }
}

export function isBigNumber(x: any): x is BigNumber | BN {
    return BN.isBN(x) || x instanceof BigNumber;
}

export class EventFormatter {
    public formatEventByNames: boolean = true;
    public contractNames = new Map<string, string>();   // address => name

    addAddress(name: string, address: string) {
        this.contractNames.set(address, name);
    }

    addAddresses(addressMap: { [name: string]: string }) {
        for (const [name, address] of Object.entries(addressMap)) {
            this.contractNames.set(address, name);
        }
    }

    isAddress(s: any): s is string {
        return typeof s === 'string' && /^0x[0-9a-fA-F]{40}/.test(s);
    }
    
    formatAddress(address: string) {
        return this.contractNames.get(address) ?? address.slice(0, 10) + '...';
    }

    private formatArg(value: unknown) {
        if (isBigNumber(value)) {
            return formatBN(value);
        } else if (this.isAddress(value)) {
            return this.formatAddress(value);
        } else {
            return value;
        }
    }
    
    formatArgs(event: BaseEvent) {
        const result: any = { };
        for (const [key, value] of Object.entries(event.args)) {
            if (Array.isArray(value)) {
                result[key] = value.map(v => this.formatArg(v));
            } else {
                result[key] = this.formatArg(value);
            }
        }
        return result;
    }

    format(event: BaseEvent) {
        const contractName = this.formatAddress(event.address);
        const formattedArgs = this.formatArgs(event);
        if (this.formatEventByNames) {
            return formatEventByNames(event, contractName, formattedArgs);
        } else {
            return formatEvent(event, contractName, formattedArgs);
        }
    }
}

export class Web3EventDecoder extends EventFormatter {
    public eventTypes = new Map<string, AbiItem>();     // signature (topic[0]) => type

    constructor(contracts: { [name: string]: Truffle.ContractInstance }, filter?: string[]) {
        super();
        this.addContracts(contracts, filter);
    }

    addContracts(contracts: { [name: string]: Truffle.ContractInstance; }, filter: string[] | undefined) {
        for (const contractName of Object.keys(contracts)) {
            const contract = contracts[contractName];
            this.contractNames.set(contract.address, contractName);
            for (const item of contract.abi) {
                if (item.type === 'event' && (filter == null || filter.includes(item.name!))) {
                    this.eventTypes.set((item as any).signature, item);
                }
            }
        }
    }

    decodeEvent(event: RawEvent): TruffleEvent | null {
        const signature = event.topics[0];
        const evtType = this.eventTypes.get(signature);
        if (evtType == null) return null;
        // based on web3 docs, first topic has to be removed for non-anonymous events
        const topics = evtType.anonymous ? event.topics : event.topics.slice(1);
        const decodedArgs: any = web3.eth.abi.decodeLog(evtType.inputs!, event.data, topics);
        // convert parameters based on type (BN for now)
        evtType.inputs!.forEach((arg, i) => {
            if (/^u?int\d*$/.test(arg.type)) {
                decodedArgs[i] = decodedArgs[arg.name] = toBN(decodedArgs[i]);
            } else if (/^u?int\d*\[\]$/.test(arg.type)) {
                decodedArgs[i] = decodedArgs[arg.name] = decodedArgs[i].map(toBN);
            }
        });
        return {
            address: event.address,
            type: evtType.type,
            signature: signature,
            event: evtType.name,
            args: decodedArgs,
            blockHash: event.blockHash,
            blockNumber: event.blockNumber,
            logIndex: event.logIndex,
            transactionHash: event.transactionHash,
            transactionIndex: event.transactionIndex,
        }
    }
    
    decodeEvents(tx: Truffle.TransactionResponse<any> | TransactionReceipt): TruffleEvent[] {
        // for truffle, must decode tx.receipt.rawLogs to also obtain logs from indirectly called contracts
        // for plain web3, just decode receipt.logs
        const receipt: TransactionReceipt = 'receipt' in tx ? tx.receipt : tx;
        const rawLogs: RawEvent[] = 'rawLogs' in receipt ? (receipt as any).rawLogs : receipt.logs;
        // decode all events
        return rawLogs.map(raw => this.decodeEvent(raw)).filter(isNotNull);
    }
}

export class EthersEventDecoder extends EventFormatter {
    public contracts = new Map<string, Contract>();     // address => instance

    constructor(contracts: { [name: string]: Contract }) {
        super();
        this.addContracts(contracts);
    }

    addContracts(contracts: { [name: string]: Contract }) {
        for (const [contractName, contract] of Object.entries(contracts)) {
            this.contractNames.set(contract.address, contractName);
            this.contracts.set(contract.address, contract);
        }
    }

    decodeArg(type: ParamType, value: any) {
        return value;
    }
    
    decodeEvent(event: EthersRawEvent | EthersEvent): TruffleEvent | null {
        const contract = this.contracts.get(event.address);
        if (contract == null) return null;
        let eventName: string;
        let fragment: EventFragment;
        let args: any;
        if ('args' in event && event.args && event.event && event.eventSignature) {
            eventName = event.event;
            fragment = contract.interface.events[event.eventSignature];
            args = event.args;
        } else {
            const decoded = contract.interface.parseLog(event);
            eventName = decoded.name;
            fragment = decoded.eventFragment;
            args = decoded.args;
        }
        const decodedArgs: any = [];  // decodedArgs will be tuple with named properties
        fragment.inputs.forEach((type, i) => {
            decodedArgs[i] = decodedArgs[type.name] = args[i];
        });
        return {
            address: event.address,
            type: 'event',
            signature: event.topics[0],
            event: eventName,
            args: decodedArgs,
            blockHash: event.blockHash,
            blockNumber: event.blockNumber,
            logIndex: event.logIndex,
            transactionHash: event.transactionHash,
            transactionIndex: event.transactionIndex,
        }
    }

    decodeEvents(tx: EthersTransactionReceipt | ContractReceipt): TruffleEvent[] {
        const events = (tx as ContractReceipt).events ?? tx.logs;
        return events.map(raw => this.decodeEvent(raw)).filter(isNotNull);
    }
}
