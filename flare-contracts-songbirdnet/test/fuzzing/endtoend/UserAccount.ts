import { BigNumber } from "ethers";
import { AssetToken, DummyAssetMinter, FlareDaemon, Ftso, FtsoManager, FtsoRegistry, FtsoRewardManager, PriceSubmitter, VoterWhitelister, WNat } from "../../../typechain";
import { BaseEvent, ethersFilterEvents, formatBN } from "../../utils/EventDecoder";
import { BIG_NUMBER_ZERO, coinFlip, MAX_BIPS, MAX_BIPS_DELEGATIONS, randomChoice, randomInt } from "../../utils/fuzzing-utils";
import { expectErrors, reportError } from "./EndToEndFuzzingUtils";
import { EthersTransactionRunner, SignerWithAddress } from "./TransactionRunner";

export interface XAsset {
    token: AssetToken;
    ftso: Ftso;
    minter: DummyAssetMinter;
}

export interface UserEnvironment {
    users: UserAccount[];
    avoidErrors: boolean;    // no errors should happen if true
    // contracts
    flareDaemon: FlareDaemon;
    ftsoRewardManager: FtsoRewardManager;
    ftsoManager: FtsoManager;
    priceSubmiter: PriceSubmitter;
    wNat: WNat;
    ftsoWnat: Ftso;
    registry: FtsoRegistry;
    voterWhitelister: VoterWhitelister;
    // assetDict: { [name: string]: XAsset };
}

export class UserAccount {
    constructor(
        public name: string,
        public signer: SignerWithAddress,
        protected transactionRunner: EthersTransactionRunner,
        protected ftsoRewardManager: FtsoRewardManager,
    ) {
        transactionRunner.eventDecoder.addAddress(name, signer.address);
    }
    
    public address = this.signer.address;

    // must be set out of constructor, because it requires full list of users
    public environment?: UserEnvironment;

    deposit(wnat: WNat, value: BigNumber) {
        return this.transactionRunner.runMethod(wnat, (w) => w.deposit({ value: value, gasLimit: 5_000_000 }),
            { signer: this.signer, method: 'WNat.deposit' })
            .catch(e => expectErrors(e, []));
    }

    delegate(token: AssetToken | WNat, delegatee: UserAccount, bips: number) {
        return this.transactionRunner.runMethod(token, (t) => t.delegate(delegatee.address, bips, { gasLimit: 5_000_000 }),
            { signer: this.signer, method: 'VPToken.delegate', comment: `Delegating ${bips / 100}% from ${this.name} to ${delegatee.name}` })
            .catch(e => expectErrors(e, ['Max delegates exceeded', 'Max delegation bips exceeded', 'Cannot delegate to self']));
    }

    undelegateAll(token: AssetToken | WNat) {
        return this.transactionRunner.runMethod(token, (t) => t.undelegateAll({ gasLimit: 5_000_000 }),
            { signer: this.signer, method: 'VPToken.undelegateAll', comment: `Undelegating all from ${this.name}` })
            .catch(e => expectErrors(e, []));
    }
    
    transfer(token: AssetToken | WNat, to: UserAccount, amount: BigNumber | number | string) {
        return this.transactionRunner.runMethod(token, (t) => t.transfer(to.address, amount, { gasLimit: 5_000_000 }),
            { signer: this.signer, method: 'VPToken.transfer', comment: `Transferring ${formatBN(amount)} from ${this.name} to ${to.name}` })
            .catch(e => expectErrors(e, ['Cannot transfer to self', 'ERC20: transfer amount exceeds balance']));
    }

    async claimReward(rewardEpochId: number | BigNumber) {
        try {
            const tx = await this.transactionRunner.runMethod(this.ftsoRewardManager, (f) => f.claimReward(this.address, [rewardEpochId], { gasLimit: 5_000_000 }),
                { signer: this.signer, method: 'FtsoRewardManager.claimReward' });
            const claimedEvents = ethersFilterEvents(tx.allEvents, this.ftsoRewardManager, 'RewardClaimed');
            if (claimedEvents.length > 0) {
                const total = claimedEvents.reduce((a, ev) => a.add(ev.args.amount), BIG_NUMBER_ZERO);
                this.transactionRunner.comment(`Account ${this.name} claimed ${formatBN(total)} reward`);
            } else {
                this.transactionRunner.comment(`No reward for account ${this.name}`);
            }
        } catch (e) {
            reportError(e);
        }
    }

    async getBalance() {
        return await this.transactionRunner.defaultSigner.getBalance(this.address);
    }

    avoidErrors() {
        return this.environment?.avoidErrors ?? true;
    }
    
    isProvider() {
        return false;
    }

    private currentRewardEpoch: number | null = null;

    async runStep(events: BaseEvent[], startEvent: number, endEvent: number) {
        // read events
        let rewardTime = false;
        for (let ind = startEvent; ind < endEvent; ind++) {
            const event = events[ind];
            if (event.event === 'PriceEpochFinalized') {
                this.currentRewardEpoch = event.args.rewardEpochId;
            } else if (event.event === 'RewardEpochFinalized') {
                rewardTime = true;
            }
        }
        // act based on events
        if (rewardTime && this.currentRewardEpoch != null) {
            await this.claimReward(this.currentRewardEpoch);
            this.currentRewardEpoch = null;
        }

        // some other actions
        const env = this.environment;
        if (env) {
            // randomly transfer
            const transferProb = 1.5 / this.environment!.users.length;    // have avg 2 transfers per loop
            if (coinFlip(transferProb)) {
                const balance = await env.wNat.balanceOf(this.address);
                const amount = balance.mul(randomInt(10_000)).div(10_000);
                const user = randomChoice(env.users, env.avoidErrors ? this : undefined);
                await this.transfer(env.wNat, user, amount);
            }
        }
    }
}

export class DelegatorAccount extends UserAccount {
    override async runStep(events: BaseEvent[], startEvent: number, endEvent: number) {
        await super.runStep(events, startEvent, endEvent);

        const env = this.environment;
        if (env) {
            // randomly delegate
            if (coinFlip(0.1)) {
                let maxBips = MAX_BIPS;
                if (env.avoidErrors) {
                    const [delegates, bips] = await env.wNat.delegatesOf(this.address);
                    if (delegates.length >= MAX_BIPS_DELEGATIONS) {
                        maxBips = 0;    // too many delegates
                    } else {
                        maxBips -= bips.reduce((x, y) => x.add(y), BIG_NUMBER_ZERO).toNumber();
                    }
                }
                if (maxBips > 0) {
                    const bips = randomInt(maxBips + 1);
                    const providers = env.users.filter(u => u.isProvider());
                    const user = randomChoice(providers);
                    await this.delegate(env.wNat, user, bips);
                }
            }
            // randomly undelegate all
            const undelegateAllProb = 0.1 / this.environment!.users.length;    // have avg 1 undelegateAll per 10 loops
            if (coinFlip(undelegateAllProb)) {
                await this.undelegateAll(env.wNat);
            }
        }
    }
}
