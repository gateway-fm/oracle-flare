import { time } from "@openzeppelin/test-helpers";
import { Ftso, FtsoManager } from "../../../typechain";
import { FtsoInstance, FtsoManagerInstance } from "../../../typechain-truffle";

const OFFSET = 0;

// Returns last mined block time, may be in the past if not used just after a transaction or advanceBlock().
export async function latestBlockTimestamp(advanceBefore: boolean = false) {
    if (advanceBefore) {
        await time.advanceBlock();
    }
    return (await time.latest()).toNumber();
}

export class PriceEpochTimes {
    constructor(
        public firstPriceEpochStartTs: number,
        public priceEpochDurationSeconds: number,
        public revealEpochDurationSeconds: number,
    ) {
    }
    
    static async forFtso(ftso: FtsoInstance | Ftso) {
        const epochConfig = await ftso.getPriceEpochConfiguration();
        return new PriceEpochTimes(epochConfig[0].toNumber(), epochConfig[1].toNumber(), epochConfig[2].toNumber());
    }
    
    epochId(timestamp: number) {
        return Math.floor((timestamp - this.firstPriceEpochStartTs) / this.priceEpochDurationSeconds);
    }
    
    epochStartTime(epochId: number) {
        return this.firstPriceEpochStartTs + epochId * this.priceEpochDurationSeconds + OFFSET;
    }
    
    revealStartTime(epochId: number) {
        return this.epochStartTime(epochId + 1);
    }

    finalizeTime(epochId: number) {
        return this.epochStartTime(epochId + 1) + this.revealEpochDurationSeconds;
    }

    async currentEpochId() {
        return this.epochId(await latestBlockTimestamp());
    }
    
    async nextEpochStartTime() {
        const epochId = await this.currentEpochId();
        return this.epochStartTime(epochId + 1);
    }
}

export class RewardEpochTimes {
    constructor(
        public firstRewardEpochsStartTs: number,
        public rewardEpochDurationSeconds: number,
    ) {
    }
 
    static async forFtsoManager(ftsoManager: FtsoManagerInstance | FtsoManager) {
        const epochConfig = await ftsoManager.getRewardEpochConfiguration();
        return new RewardEpochTimes(epochConfig[0].toNumber(), epochConfig[1].toNumber());
    }

    epochId(timestamp: number) {
        return Math.floor((timestamp - this.firstRewardEpochsStartTs) / this.rewardEpochDurationSeconds);
    }

    epochStartTime(epochId: number) {
        return this.firstRewardEpochsStartTs + epochId * this.rewardEpochDurationSeconds + OFFSET;
    }

    finalizeTime(epochId: number) {
        return this.epochStartTime(epochId + 1);
    }
    
    async currentEpochId() {
        return this.epochId(await latestBlockTimestamp());
    }

    async nextEpochStartTime() {
        const epochId = await this.currentEpochId();
        return this.epochStartTime(epochId + 1);
    }
}
