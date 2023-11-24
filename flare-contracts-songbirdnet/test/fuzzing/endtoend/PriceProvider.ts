import { BigNumber } from "@ethersproject/bignumber";
import { Ftso, FtsoRewardManager, PriceSubmitter } from "../../../typechain";
import { BaseEvent, ethersEventIs } from "../../utils/EventDecoder";
import { submitPriceHash, toBigNumber, toBigNumberFixedPrecision } from "../../utils/test-helpers";
import { coinFlip, randomChoice, randomInt, randomNum, toNumber } from "../../utils/fuzzing-utils";
import { expectErrors } from "./EndToEndFuzzingUtils";
import { latestBlockTimestamp } from "./EpochTimes";
import { ethersExpectEvent, EthersTransactionRunner, SignerWithAddress } from "./TransactionRunner";
import { UserAccount } from "./UserAccount";

export const USD_DECIMALS = 5;

export const MAX_PRICE_JUMP_PER_SEC = Math.pow(1.1, 1 / 90);    // jump of 1.1 per typical price epoch

export class FtsoList {
    constructor(
        public ftsos: Ftso[],
        public ftsoIndices: BigNumber[],
    ) {
        this.ftsoIndex = new Map();
        ftsos.forEach((ftso, i) => this.ftsoIndex.set(ftso.address, i));
    }

    ftsoIndex: Map<string, number>;
}

// same price oracle is used by all providers, so that prices don't diverge too much
export class PriceSimulator {
    constructor(
        public ftsoList: FtsoList,
        initialPrices: number[],
        initialTimestamp: number,
        public maxPriceJumpPerSec: number,
    ) {
        this.prices = [...initialPrices];
        this.lastTimestamp = initialTimestamp;
        this.priceRandomizationMax = maxPriceJumpPerSec ** 30;
    }

    prices: number[];
    lastTimestamp: number;
    priceRandomizationMax: number;

    updatePrices(timestamp: number) {
        if (timestamp <= this.lastTimestamp) return;
        const timeDelta = timestamp - this.lastTimestamp;
        this.lastTimestamp = timestamp;
        for (let i = 0; i < this.prices.length; i++) {
            const jump = Math.min(randomNum(1, this.maxPriceJumpPerSec ** timeDelta), 2);
            const price = this.prices[i];
            // if the prices are too big or too small (not between 1 cent and 1 million usd), push them toward center
            let mulProb = 0.5;
            if (price < 1e-2) mulProb = 0.75;
            if (price > 1e+6) mulProb = 0.25;
            this.prices[i] = coinFlip(mulProb) ? price * jump : price / jump;
        }
    }

    scaledPrices() {
        return this.prices.map(price => toBigNumberFixedPrecision(price, USD_DECIMALS));
    }

    scaledRandomizedPrices(addErrors: boolean) {
        return this.prices.map(price => {
            if (addErrors && coinFlip(0.05)) {
                return this.randomBigNum(50);
            }
            const randomization = randomNum(1 / this.priceRandomizationMax, this.priceRandomizationMax);
            return toBigNumberFixedPrecision(price * randomization, USD_DECIMALS);
        });
    }

    randomBigNum(maxDigits: number) {
        const n = randomInt(maxDigits);
        let res = ['1'];
        for (let i = 0; i < n; i++) {
            res.push('0');
        }
        return toBigNumber(res.join(''));
    }
}

interface PriceSubmission {
    epochId: number;
    ftsoIndices: BigNumber[];
    prices: (number | BigNumber)[];
    randoms: number[];
    revealed: boolean;
}

export class PriceProvider extends UserAccount {
    protected submitted = new Map<number, PriceSubmission>();
    protected ftsoList: FtsoList;
    protected whitelist: Set<number>;

    constructor(
        name: string,
        signer: SignerWithAddress,
        transactionRunner: EthersTransactionRunner,
        ftsoRewardManager: FtsoRewardManager,
        protected priceSubmitter: PriceSubmitter,
        protected priceSimulator: PriceSimulator,
    ) {
        super(name, signer, transactionRunner, ftsoRewardManager);
        this.ftsoList = priceSimulator.ftsoList;
        this.whitelist = new Set();
    }

    async submitPrices(epochId: number) {
        if (this.submitted.has(epochId)) return;
        const timestamp = await latestBlockTimestamp();
        this.priceSimulator.updatePrices(timestamp);
        const allPrices = this.priceSimulator.scaledRandomizedPrices(!this.avoidErrors());
        const ftsoIndices: BigNumber[] = [];
        const prices: BigNumber[] = [];
        this.ftsoList.ftsoIndices.forEach((ftsoIndex, i) => {
            if (this.whitelist.has(ftsoIndex.toNumber())) {
                prices.push(allPrices[i]);
                ftsoIndices.push(ftsoIndex);
            }
        })
        if (ftsoIndices.length === 0) return;
        const randoms = ftsoIndices.map(_ => randomInt(1e9));  // not crypto safe, but it's just a simulation
        const hashes = prices.map((price, ind) => submitPriceHash(price, randoms[ind], this.address));
        try {
            const tx = await this.transactionRunner.runMethod(
                this.priceSubmitter, (p) => p.submitPriceHashes(epochId, ftsoIndices, hashes, { gasLimit: 5_000_000 }),
                { signer: this.signer, method: 'PriceSubmitter.submitPriceHashes', comment: `Submitting prices ${prices} by ${this.name} for epoch ${epochId}` });
            this.submitted.set(epochId, { epochId, ftsoIndices, prices, randoms, revealed: false });
            ethersExpectEvent(tx, "PriceHashesSubmitted");
        } catch (e) {
            expectErrors(e, ['Wrong epoch id', 'Not whitelisted']);
        }
    }

    async revealPrices(epochId: number) {
        const submitted = this.submitted.get(epochId);
        if (submitted == null) {
            console.warn(`${this.name}: no price submit data for epoch ${epochId}`);
            return;
        }
        try {
            const tx = await this.transactionRunner.runMethod(
                this.priceSubmitter, (p) => p.revealPrices(epochId, submitted.ftsoIndices, submitted.prices, submitted.randoms, { gasLimit: 5_000_000 }),
                { signer: this.signer, method: 'PriceSubmitter.revealPrices', comment: `Revealing prices ${submitted.prices} by ${this.name} for epoch ${epochId}` });
            ethersExpectEvent(tx, "PricesRevealed");
        } catch (e) {
            expectErrors(e, ['Price too high', 'Reveal period not active', 'Not whitelisted', 'Epoch data not available']);
        }
    }

    async updateWhitelist() {
        this.whitelist.clear();
        const bitmap = toNumber(await this.priceSubmitter.voterWhitelistBitmap(this.address));
        for (const indexB of this.ftsoList.ftsoIndices) {
            const index = indexB.toNumber();
            if ((bitmap & (1 << index)) !== 0) {
                this.whitelist.add(index);
            }
        }
    }
    
    async fullWhitelistProvider() {
        await this.updateWhitelist();   // in case whitelists were already set (on reused scdev)
        try {
            await this.transactionRunner.runMethod(this.environment!.voterWhitelister, (v) => v.requestFullVoterWhitelisting(this.address, { gasLimit: 7_500_000 }),
                { signer: this.signer, comment: `Whitelisting provider ${this.name}`, method: 'VoterWhitelister.requestFullVoterWhitelisting' });
        } catch (e) {
            expectErrors(e, ['contract call run out of gas']);
        }
    }
    
    async whitelistProvider() {
        const indices = this.ftsoList.ftsoIndices.filter(ind => !this.whitelist.has(ind.toNumber()));
        const index = randomChoice(indices);
        try {
            const tx = await this.transactionRunner.runMethod(
                this.environment!.voterWhitelister, (p) => p.requestWhitelistingVoter(this.address, index, { gasLimit: 7_500_000 }),
                { signer: this.signer, method: 'VoterWhitelister.requestWhitelistingVoter', comment: `Request whitelisting ${this.name} for ftso ${index}` });
        } catch (e) {
            expectErrors(e, ['vote power too low']);
        }
    }

    override async runStep(events: BaseEvent[], startEvent: number, endEvent: number) {
        const env = this.environment!;
        // read events
        let submitEpochId: number | null = null;
        let revealEpochId: number | null = null;
        for (let ind = startEvent; ind < endEvent; ind++) {
            const event = events[ind];
            if (event.event === 'SubmitEpochStarted') {
                submitEpochId = toNumber(event.args.epochId);
            } else if (event.event === 'RevealEpochStarted') {
                revealEpochId = toNumber(event.args.epochId);
            } else if (ethersEventIs(event, env.voterWhitelister, 'VoterWhitelisted')) {
                if (event.args.voter === this.address) {
                    this.whitelist.add(event.args.ftsoIndex.toNumber());
                }
            } else if (ethersEventIs(event, env.voterWhitelister, 'VoterRemovedFromWhitelist')) {
                if (event.args.voter === this.address) {
                    this.whitelist.delete(event.args.ftsoIndex.toNumber());
                }
            }
        }
        // act based on events
        // do reveals first, because there is less time
        if (revealEpochId != null) {
            await this.revealPrices(revealEpochId);
        }
        // do submits
        if (submitEpochId != null) {
            await this.submitPrices(submitEpochId);
        }
        // try to whitelist
        if (this.whitelist.size < this.ftsoList.ftsos.length && coinFlip(0.05)) {
            await this.whitelistProvider();
            
        }
        // call super at end (there is enough time for reward claiming)
        await super.runStep(events, startEvent, endEvent);
    }

    override isProvider() {
        return true;
    }
}
