import { assert } from "chai";
import { BigNumber } from "ethers";
import { Ftso, FtsoManager, FtsoRewardManager, PriceSubmitter } from "../../../typechain";
import { BaseEvent, EthersEventDecoder, EthersEventKeys, EthersEventArgs, formatBN, ethersEventIs } from "../../utils/EventDecoder";
import { BN_ZERO, MAX_BIPS } from "../../utils/fuzzing-utils";
import { SparseArray } from "../../utils/SparseMatrix";
import { LogFile } from "../../utils/LogFile";
import { TransactionRunnerBase } from "./TransactionRunner";
import { UserEnvironment } from "./UserAccount";
import { toBN } from "../../utils/test-helpers";

const MAX_PRICE = BigNumber.from(2).pow(128);

export interface EventStateChecker {
    check(events: BaseEvent[], start: number, end: number): Promise<void>;
}

interface RewardedFtsoData {
    ftso: string;
    lowPrice: BigNumber;
    highPrice: BigNumber;
}

interface RewardEpochData {
    status: 'open' | 'finalized' | 'expired';
    rewards: SparseArray;
    claimed: SparseArray;
}

type FtsoEvents<E extends EthersEventKeys<Ftso>> = EthersEventArgs<Ftso, E>;
type FtsoManagerEvents<E extends EthersEventKeys<FtsoManager>> = EthersEventArgs<FtsoManager, E>;
type FtsoRewardManagerEvents<E extends EthersEventKeys<FtsoRewardManager>> = EthersEventArgs<FtsoRewardManager, E>;
type PriceSubmitterEvents<E extends EthersEventKeys<PriceSubmitter>> = EthersEventArgs<PriceSubmitter, E>;

export class PriceAndRewardChecker implements EventStateChecker {
    constructor(
        public transactionRunner: TransactionRunnerBase,
        public eventDecoder: EthersEventDecoder,
        public environment: UserEnvironment
    ) {
        this.logFile = transactionRunner.logFile!;
    }
    
    // generic
    public logFile: LogFile;
    
    // price epoch data
    priceEpochId?: BigNumber;
    initializedFtso = new Set<string>();
    revealedPrices: { [ftso: string]: { [voter: string]: BigNumber } } = {};
    rewarded?: RewardedFtsoData;
    lastRewards = new SparseArray();   // temporary store for rewards
    // reward epoch data
    rewardEpochId?: BigNumber;
    rewardEpochs = new Map<string, RewardEpochData>();
    
    async check(events: BaseEvent[], start: number, end: number) {
        for (let i = start; i < end; i++) {
            let event = events[i];
            try {
                await this.checkEvent(event);
            } catch (err: any) {
                this.logFile.log(`!!! ${err.stack ?? err}`);
                this.transactionRunner.increaseErrorCount(err.name ?? "UNKNOWN_ERROR");
            }
        }
    }
    
    private async checkEvent(event: BaseEvent) {
        if (event.event === 'PriceEpochInitializedOnFtso') {
            this.priceEpochInitializedOnFtso(event.address, event.args);
        }
        if (ethersEventIs(event, this.environment.priceSubmiter, 'PricesRevealed')) {
            this.pricesRevealed(event.args);
        }
        if (event.event === 'PriceFinalized') {
            this.priceFinalized(event.address, event.args);
        }
        if (ethersEventIs(event, this.environment.ftsoRewardManager, 'RewardsDistributed')) {
            this.rewardsDistributed(event.args);
        }
        if (ethersEventIs(event, this.environment.ftsoManager, 'PriceEpochFinalized')) {
            this.priceEpochFinalized(event.args);
        }
        if (ethersEventIs(event, this.environment.ftsoManager, 'RewardEpochFinalized')) {
            this.rewardEpochFinalized(event.args);
            await this.logRewardEpochInfo(this.rewardEpochId);
        }
        if (ethersEventIs(event, this.environment.ftsoRewardManager, 'RewardClaimed')) {
            this.rewardClaimed(event.args);
        }
        if (ethersEventIs(event, this.environment.ftsoRewardManager, 'RewardClaimsExpired')) {
            this.rewardClaimsExpired(event.args);
        }
    }

    priceEpochInitializedOnFtso(ftsoAddress: string, args: FtsoEvents<'PriceEpochInitializedOnFtso'>) {
        // console.log(`***** checkPriceEpochInitializedOnFtso: this.priceEpochId: ${this.priceEpochId}, args.epochId: ${args.epochId}`);
        assert(!this.priceEpochId || args.epochId.eq(this.priceEpochId), `PriceEpochInitializedOnFtso: wrong price epoch id ${args.epochId}`);
        if (!this.priceEpochId) {
            this.priceEpochId = args.epochId;
        }
        assert(!this.initializedFtso.has(ftsoAddress), `PriceEpochInitializedOnFtso: ftso ${ftsoAddress} already initialized for reveal, epochId=${args.epochId}`);
        this.initializedFtso.add(ftsoAddress);
    }
    
    pricesRevealed(args: PriceSubmitterEvents<'PricesRevealed'>) {
        // console.log(`***** checkPricesRevealed: this.priceEpochId: ${this.priceEpochId}, args.epochId: ${args.epochId}`);
        assert(this.priceEpochId && args.epochId.eq(this.priceEpochId), `PricesRevealed: wrong price epoch id ${args.epochId}`);
        args.prices.forEach((price, i) => {
            assert(price.lt(MAX_PRICE), `PricesRevealed: too high price accepted ${price}`);
            const ftsoAddress = args.ftsos[i];
            assert(this.initializedFtso.has(ftsoAddress), `PricesRevealed: ftso ${ftsoAddress} not initialized, epochId=${this.priceEpochId}`);
            const ftsoPrices = this.revealedPrices[ftsoAddress] ??= {};
            ftsoPrices[args.voter] = price;
        });
    }

    priceFinalized(ftsoAddress: string, args: FtsoEvents<'PriceFinalized'>) {
        assert(this.priceEpochId && args.epochId.eq(this.priceEpochId), `PriceFinalized: wrong price epoch id ${args.epochId}`);
        assert(this.initializedFtso.has(ftsoAddress), `PriceFinalized: ftso ${ftsoAddress} not initialized, epochId=${this.priceEpochId}`);
        if (args.finalizationType === 1) { // 1 = WEIGHTED_MEDIAN
            assert(ftsoAddress in this.revealedPrices, `PriceFinalized: no reveal data for ftso ${ftsoAddress}, priceEpochId=${this.priceEpochId}`);
            const prices = Object.values(this.revealedPrices[ftsoAddress]);
            const max = prices.reduce((x, y) => x.gte(y) ? x : y);
            const min = prices.reduce((x, y) => x.lte(y) ? x : y);
            assert(min.lte(args.price) && args.price.lte(max), `PriceFinalized: price ${args.price} not between ${min} and ${max}, priceEpochId=${this.priceEpochId}`);
            if (args.rewardedFtso) {
                this.rewarded = { ftso: ftsoAddress, lowPrice: args.lowIQRRewardPrice, highPrice: args.highIQRRewardPrice };
            }
        }
    }

    rewardsDistributed(args: FtsoRewardManagerEvents<'RewardsDistributed'>) {
        assert(this.priceEpochId && args.epochId.eq(this.priceEpochId), `RewardsDistributed: wrong price epoch id ${args.epochId}`);
        assert(this.rewarded != undefined, `RewardsDistributed: no rewarded ftso obtained from PriceFinalized, priceEpochId=${this.priceEpochId}`);
        const rewarded = this.rewarded!;
        const ftsoPrices = this.revealedPrices[rewarded.ftso];
        const voters = Object.keys(ftsoPrices);
        const canGetRewards = voters.filter(v => ftsoPrices[v].gte(rewarded.lowPrice) && ftsoPrices[v].lte(rewarded.highPrice));
        assert.includeMembers(canGetRewards, args.addresses, `RewardsDistributed: ${canGetRewards} does not include all rewarded ${args.addresses}, priceEpochId=${this.priceEpochId}`);
        // const mustGetRewards = voters.filter(v => ftsoPrices[v].gt(rewarded.lowPrice) && ftsoPrices[v].lt(rewarded.highPrice));
        // assert.includeMembers(args.addresses, canGetRewards, `RewardsDistributed: rewarded ${args.addresses} does not include all ${mustGetRewards}, priceEpochId=${this.priceEpochId}`);
        assert.equal(args.addresses.length, args.rewards.length, `RewardsDistributed: rewarded addresses have different length than rewards, priceEpochId=${this.priceEpochId}`);
        this.lastRewards.clear();
        args.addresses.forEach((voter, ind) => this.lastRewards.set(voter, toBN(args.rewards[ind])));
    }

    priceEpochFinalized(args: FtsoManagerEvents<'PriceEpochFinalized'>) {
        if (!this.rewardEpochId || !args.rewardEpochId.eq(this.rewardEpochId)) {
            assert(!this.rewardEpochId || args.rewardEpochId.gt(this.rewardEpochId), 
                `PriceEpochFinalized: new reward epoch ${args.rewardEpochId} smaller than previous ${this.rewardEpochId}`);
            this.rewardEpochs.set(args.rewardEpochId.toString(), {
                status: 'open',
                rewards: new SparseArray(),
                claimed: new SparseArray(),
            });
            this.rewardEpochId = args.rewardEpochId;
        }
        // update total rewards for epoch
        const rewardEpoch = this.rewardEpochs.get(this.rewardEpochId!.toString())!;
        for (const voter of this.lastRewards.keys()) {
            rewardEpoch.rewards.addTo(voter, this.lastRewards.get(voter));
        }
        // destroy price epoch data
        this.priceEpochId = undefined;
        this.revealedPrices = {};
        this.rewarded = undefined;
        this.initializedFtso.clear();
        this.lastRewards.clear();
    }

    private hasRewardEpoch(epochId: BigNumber) {
        return this.rewardEpochs.has(epochId.toString());
    }
    
    private getRewardEpoch(epochId: BigNumber, messageKey: string): RewardEpochData {
        const rewardEpoch = this.rewardEpochs.get(epochId.toString());
        assert(rewardEpoch != null, `${messageKey}: missing reward epoch data for ${this.rewardEpochId}`);
        return rewardEpoch!;
    }
    
    rewardEpochFinalized(args: FtsoManagerEvents<'RewardEpochFinalized'>) {
        if (this.rewardEpochId && this.hasRewardEpoch(this.rewardEpochId)) {
            const rewardEpoch = this.getRewardEpoch(this.rewardEpochId, 'RewardEpochFinalized');
            assert(rewardEpoch.status === 'open' || rewardEpoch.status === 'finalized', 
                `RewardEpochFinalized: reward epoch ${this.rewardEpochId} already ${rewardEpoch.status}`)
            rewardEpoch.status = 'finalized';
        }
    }

    async logRewardEpochInfo(rewardEpochId: BigNumber | undefined) {
        this.logFile.log(`====== REWARD EPOCH ${rewardEpochId}`);
        if (rewardEpochId && this.hasRewardEpoch(rewardEpochId)) {
            try {
                const rewardEpoch = this.getRewardEpoch(rewardEpochId, 'logRewardEpochInfo');
                this.logFile.log(`    total rewards: ${formatBN(rewardEpoch.rewards.total())}`);
                const perProvider = Array.from(rewardEpoch.rewards.keys()).map(p => `${this.eventDecoder.formatAddress(p)}:${formatBN(rewardEpoch.rewards.get(p))}`);
                this.logFile.log(`    total rewards per provider: [${perProvider.join(', ')}]`);
                for (const user of this.environment.users) {
                    const { 0: providers, 1: amounts, 3: claimable } = await this.environment.ftsoRewardManager.getStateOfRewards(user.address, rewardEpochId);
                    const { votepowerBlock } = await this.environment.ftsoManager.getRewardEpochData(rewardEpochId);
                    const { 0: delegates, 1: bips } = await this.environment.wNat.delegatesOfAt(user.address, votepowerBlock);
                    const balance = await this.environment.wNat.balanceOfAt(user.address, votepowerBlock);
                    const delegations = delegates.map((dlg, i) => `${this.eventDecoder.formatAddress(dlg)}:${formatBN(bips[i].mul(balance).div(MAX_BIPS))}`);
                    const rewards = providers.map((p, i) => `${this.eventDecoder.formatAddress(p)}:${formatBN(amounts[i])}`);
                    this.logFile.log(`     ${user.name}: balance=${formatBN(balance)}  delegations=[${delegations.join(', ')}]  rewards=[${rewards.join(', ')}]  claimable=${claimable}`);
                }
            } catch (e) {
                this.logFile.log(`     error getting reward epoch data ${e}`);
            }
        } else {
            this.logFile.log(`     no data about epoch in events`);
        }
    }

    rewardClaimed(args: FtsoRewardManagerEvents<'RewardClaimed'>) {
        const rewardEpoch = this.getRewardEpoch(args.rewardEpoch, 'RewardClaimed');
        assert(rewardEpoch.status === 'finalized', 
            `RewardClaimed: reward epoch ${this.rewardEpochId} is ${rewardEpoch.status} but should be finalized`)
        rewardEpoch.claimed.addTo(args.dataProvider, toBN(args.amount));
        const providerClaimed = rewardEpoch.claimed.get(args.dataProvider);
        const providerReward = rewardEpoch.rewards.get(args.dataProvider);
        assert(providerClaimed.lte(providerReward), 
            `RewardClaimed: total claimed ${providerClaimed} for provider ${args.dataProvider} greater than total reward ${providerReward}, epoch=${args.rewardEpoch}`);
    }
    
    rewardClaimsExpired(args: FtsoRewardManagerEvents<'RewardClaimsExpired'>) {
        if (!this.hasRewardEpoch(args.rewardEpochId)) return;
        const rewardEpoch = this.getRewardEpoch(args.rewardEpochId, 'RewardClaimsExpired');
        assert(rewardEpoch.status === 'finalized', `RewardClaimsExpired: reward epoch ${args.rewardEpochId} already ${rewardEpoch.status}`)
        rewardEpoch.status = 'expired';
        // check that all rewards have been claimed - this is not an invariant of the contract, but should be true for this fuzzing test
        const providers = Array.from(rewardEpoch.rewards.keys());
        const unclaimed = providers.map(p => rewardEpoch.rewards.get(p).sub(rewardEpoch.claimed.get(p)));
        const totalUnclaimed = unclaimed.reduce((x, y) => x.add(y), BN_ZERO);
        // don't fail but log for mismatch        
        assert(totalUnclaimed.eq(BN_ZERO),
            `RewardClaimsExpired: total unclaimed ${totalUnclaimed} not zero, providers=${providers}, unclaimed=${unclaimed}, epoch=${args.rewardEpochId}`);
    }
}
