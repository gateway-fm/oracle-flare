import { constants } from "@openzeppelin/test-helpers";
import { HistoryCleanerMockInstance, IICleanableInstance } from "../../typechain-truffle";
import { CreatedVotePowerCache, Delegate, Revoke } from "../../typechain-truffle/VPContract";
import { CreatedTotalSupplyCache, Transfer, VotePowerContractChanged } from "../../typechain-truffle/VPToken";
import { formatEvent, Web3EventDecoder } from "./EventDecoder";

const VPToken = artifacts.require("VPTokenMock");
const VPContract = artifacts.require("VPContract");

async function cacheGet<K, V, R extends V>(cache: Map<K, V>, key: K, load: (key: K) => Promise<R>): Promise<R> {
    let result = cache.get(key) as R;
    if (result === undefined) {
        result = await load(key);
        cache.set(key, result);
    }
    return result;
}

export interface HistoryCleanupRecord {
    address: string;
    blockNumber: number;
    comment: string;
    methodCall: string;     // abi encoded
}

export type CleanupEvent =
    | Transfer
    | Delegate
    | Revoke
    | CreatedTotalSupplyCache
    | CreatedVotePowerCache
    | VotePowerContractChanged;

export const CLEANUP_EVENTS: CleanupEvent['name'][] =
    ['Transfer', 'Delegate', 'Revoke', 'CreatedVotePowerCache', 'CreatedTotalSupplyCache', 'VotePowerContractChanged'];

export class SimpleHistoryCleaner {
    public cleanupCount = 1;
    public records = new Set<HistoryCleanupRecord>();
    public contractInstances = new Map<string, Truffle.ContractInstance>();
    public eventDecoder: Web3EventDecoder;
    public historyCleaner: HistoryCleanerMockInstance;
    public debug = false;

    constructor(
        contracts: { [name: string]: Truffle.ContractInstance },
        historyCleaner: HistoryCleanerMockInstance
    ) {
        this.eventDecoder = new Web3EventDecoder(contracts, CLEANUP_EVENTS);
        this.historyCleaner = historyCleaner;
    }

    async track<T extends Truffle.AnyEvent>(response: Promise<Truffle.TransactionResponse<T>>): Promise<Truffle.TransactionResponse<T>> {
        const logs = this.eventDecoder.decodeEvents(await response);
        for (const log of logs) {
            if (this.debug) {
                console.log(formatEvent(log));
            }
            const event = { name: log.event, args: log.args } as CleanupEvent;
            const blockNumber = this.eventBlockNumber(event) ?? log.blockNumber;
            const methodCalls = await this.eventToMethodCalls(log.address, event);
            for (const [address, comment, methodCall] of methodCalls) {
                this.records.add({ address, blockNumber, comment, methodCall });
            }
        }
        return response;
    }

    async check(batchSize: number) {
        const batch = await this.prepareCleanerBatch(batchSize);
        return await this.checkBatch(batch);
    }

    async cleanup(batchSize: number) {
        const batch = await this.prepareCleanerBatch(batchSize);
        const counts = await this.checkBatch(batch)
        const filteredBatch = batch.filter((rec, i) => counts[i] !== 0);
        await this.historyCleaner.cleanup(filteredBatch.map(r => r.address), filteredBatch.map(r => r.methodCall));
        // now we can delete all from filtered batch
        for (let i = 0; i < filteredBatch.length; i++) {
            this.records.delete(filteredBatch[i]);      // no need to delete more than once
        }
    }

    private async checkBatch(batch: HistoryCleanupRecord[]) {
        const countsBN = await this.historyCleaner.cleanup.call(batch.map(r => r.address), batch.map(r => r.methodCall));
        return countsBN.map(n => n.toNumber());
    }

    private async prepareCleanerBatch(batchSize: number): Promise<HistoryCleanupRecord[]> {
        let count = 0;
        const result: HistoryCleanupRecord[] = [];
        const cleanupBlocks = new Map<String, number>();
        for (const record of this.records) {
            const cleanupBlock = await this.cleanupBlockNumber(cleanupBlocks, record.address);
            if (record.blockNumber < cleanupBlock) {
                result.push(record);
                if (++count >= batchSize) break;
            }
        }
        return result;
    }

    private cleanupBlockNumber(cache: Map<String, number>, address: string) {
        return cacheGet(cache, address, async _ => {
            const instance = this.contractInstances.get(address) as IICleanableInstance;    // can not be null, since it was added by event, when contractInstances was also filled
            return (await instance.cleanupBlockNumber()).toNumber();
        });
    }

    private writeVpContracts = new Map<string, string>();
    private delegationModes = new Map<string, number>();

    private async eventToMethodCalls(address: string, e: CleanupEvent) {
        const result: Array<[address: string, comment: string, encodedCall: string]> = [];
        switch (e.name) {
            case 'Transfer': {
                const vpToken = await this.getOrCreateInstance(VPToken, address);
                if (e.args.from === constants.ZERO_ADDRESS || e.args.to === constants.ZERO_ADDRESS) {
                    // if from or to is zero, there was some minting/burning going on
                    result.push([address, 'Transfer:totalSupplyHistoryCleanup()',
                        this.encodeMethodCall(vpToken, token => token.totalSupplyHistoryCleanup(this.cleanupCount))]);
                }
                if (e.args.from !== constants.ZERO_ADDRESS) {
                    result.push([address, `Transfer:balanceHistoryCleanup(from:${this.shorten(e.args.from)})`,
                        this.encodeMethodCall(vpToken, token => token.balanceHistoryCleanup(e.args.from, this.cleanupCount))]);
                }
                if (e.args.to !== constants.ZERO_ADDRESS) {
                    result.push([address, `Transfer:balanceHistoryCleanup(to:${this.shorten(e.args.to)})`,
                        this.encodeMethodCall(vpToken, token => token.balanceHistoryCleanup(e.args.to, this.cleanupCount))]);
                }
                const writeVpContractAddr = await cacheGet(this.writeVpContracts, vpToken.address, _ => vpToken.getWriteVpContract());
                if (writeVpContractAddr !== constants.ZERO_ADDRESS) {
                    const vpContract = await this.getOrCreateInstance(VPContract, writeVpContractAddr);
                    if (e.args.from !== constants.ZERO_ADDRESS) {
                        result.push([writeVpContractAddr, `Transfer:votePowerHistoryCleanup(from:${this.shorten(e.args.from)})`,
                            this.encodeMethodCall(vpContract, contract => contract.votePowerHistoryCleanup(e.args.from, this.cleanupCount))]);
                    }
                    if (e.args.to !== constants.ZERO_ADDRESS) {
                        result.push([writeVpContractAddr, `Transfer:votePowerHistoryCleanup(to:${this.shorten(e.args.to)})`,
                            this.encodeMethodCall(vpContract, contract => contract.votePowerHistoryCleanup(e.args.to, this.cleanupCount))]);
                    }
                }
                break;
            }
            case 'Delegate': {
                const vpContract = await this.getOrCreateInstance(VPContract, address);
                result.push([address, `Delegate:votePowerHistoryCleanup(from:${this.shorten(e.args.from)})`,
                    this.encodeMethodCall(vpContract, contract => contract.votePowerHistoryCleanup(e.args.from, this.cleanupCount))]);
                result.push([address, `Delegate:votePowerHistoryCleanup(to:${this.shorten(e.args.to)})`,
                    this.encodeMethodCall(vpContract, contract => contract.votePowerHistoryCleanup(e.args.to, this.cleanupCount))]);
                const delegationMode = await cacheGet(this.delegationModes, e.args.from, async from => (await vpContract.delegationModeOf(from)).toNumber());
                if (delegationMode === 1) {
                    result.push([address, `Delegate:percentageDelegationHistoryCleanup(from:${this.shorten(e.args.from)})`,
                        this.encodeMethodCall(vpContract, contract => contract.percentageDelegationHistoryCleanup(e.args.from, this.cleanupCount))]);
                } else if (delegationMode === 2) {
                    result.push([address, `Delegate:explicitDelegationHistoryCleanup(from:${this.shorten(e.args.from)}, to:${this.shorten(e.args.to)})`,
                        this.encodeMethodCall(vpContract, contract => contract.explicitDelegationHistoryCleanup(e.args.from, e.args.to, this.cleanupCount))]);
                }
                break;
            }
            case 'Revoke': {
                const vpContract = await this.getOrCreateInstance(VPContract, address);
                result.push([address, `Revoke:votePowerCacheCleanup(from:${this.shorten(e.args.delegator)}, ${e.args.blockNumber})`,
                    this.encodeMethodCall(vpContract, contract => contract.votePowerCacheCleanup(e.args.delegator, e.args.blockNumber))]);
                result.push([address, `Revoke:votePowerCacheCleanup(to:${this.shorten(e.args.delegatee)}, ${e.args.blockNumber})`,
                    this.encodeMethodCall(vpContract, contract => contract.votePowerCacheCleanup(e.args.delegatee, e.args.blockNumber))]);
                result.push([address, `Revoke:revocationCleanup(from:${this.shorten(e.args.delegator)}, to:${this.shorten(e.args.delegatee)}, ${e.args.blockNumber})`,
                    this.encodeMethodCall(vpContract, contract => contract.revocationCleanup(e.args.delegator, e.args.delegatee, e.args.blockNumber))]);
                break;
            }
            case 'CreatedTotalSupplyCache': {
                const vpToken = await this.getOrCreateInstance(VPToken, address);
                result.push([address, `CreatedTotalSupplyCache:totalSupplyCacheCleanup(${e.args._blockNumber})`,
                    this.encodeMethodCall(vpToken, token => token.totalSupplyCacheCleanup(e.args._blockNumber))]);
                break;
            }
            case 'CreatedVotePowerCache': {
                const vpContract = await this.getOrCreateInstance(VPContract, address);
                result.push([address, `CreatedVotePowerCache:votePowerCacheCleanup(owner:${this.shorten(e.args._owner)}, ${e.args._blockNumber})`,
                    this.encodeMethodCall(vpContract, contract => contract.votePowerCacheCleanup(e.args._owner, e.args._blockNumber))]);
                break;
            }
            case 'VotePowerContractChanged': {
                this.writeVpContracts.delete(address);  // need to reinitialize vpContract cache for this token
                break;
            }
            default: {
                throw new Error(`Unknown cleanup event ${(e as any).name}`);
            }
        }
        return result;
    }
    
    private shortenAddrs = new Map<string, string>();
    private shorten(addr: string) {
        if (!this.shortenAddrs.has(addr)) {
            this.shortenAddrs.set(addr, String.fromCharCode(65 + this.shortenAddrs.size));
        }
        return this.shortenAddrs.get(addr);
    }
    
    private eventBlockNumber(e: CleanupEvent) {
        switch (e.name) {
            case 'Revoke':
                return e.args.blockNumber.toNumber();
            case 'CreatedVotePowerCache':
            case 'CreatedTotalSupplyCache':
                return e.args._blockNumber.toNumber();
            default:
                return null;
        }
    }

    private encodeMethodCall<T extends Truffle.ContractInstance>(contractInstance: T, method: (inst: T) => any): string {
        // a hack to add typechecking - replace contact instance with contractInstance.contract.methods, which contains methods for abi encoding
        return method.call(null, contractInstance.contract.methods).encodeABI();
    }

    private getOrCreateInstance<T extends Truffle.ContractInstance>(contractConstructor: Truffle.Contract<T>, address: string): Promise<T> {
        return cacheGet(this.contractInstances, address, _ => contractConstructor.at(address));
    }
}
