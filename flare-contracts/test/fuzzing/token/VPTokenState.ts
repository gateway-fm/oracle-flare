import { constants } from "@openzeppelin/test-helpers";
import { BN_ZERO, MAX_BIPS, saveJson } from "../../utils/fuzzing-utils";
import { SparseArray, SparseMatrix } from "../../utils/SparseMatrix";

export enum DelegationMode {
    NOTSET = 0,
    PERCENTAGE = 1,
    AMOUNT = 2,
}

export class VPTokenState {
    constructor(
        public readonly balances = new SparseArray(),
        public readonly bipsDelegations = new SparseMatrix(),
        public readonly amountDelegations = new SparseMatrix(),
        public readonly revocations = new SparseArray(),
        public readonly governanceBipsDelegations = new SparseMatrix() // can be only 0% or 100%
    ) { }

    votePower(account: string) {
        return this.balances.get(account)
            .add(this.delegatedVPTo(account))
            .sub(this.delegatedVPFrom(account));
    }

    undelegatedVotePower(account: string) {
        return this.balances.get(account)
            .sub(this.delegatedVPFrom(account));
    }
    
    revokedVotePower(account: string) {
        return this.revocations.get(account);
    }

    governanceVotePower(account: string) {
        if (Array.from(this.governanceBipsDelegations.rowMap(account).keys())[0] == constants.ZERO_ADDRESS) {
            return this.balances.get(account)
            .add(this.delegatedGovernanceVPTo(account))
        }
        else {
            return this.balances.get(account)
            .add(this.delegatedGovernanceVPTo(account))
            .sub(this.delegatedGovernanceVPFrom(account));
        }
    }

    private delegatedVPFrom(account: string) {
        let res = BN_ZERO;
        const balance = this.balances.get(account);
        for (const bips of this.bipsDelegations.rowMap(account).values()) {
            res = res.add(bips.mul(balance).divn(MAX_BIPS)); // delegations from account
        }
        for (const amount of this.amountDelegations.rowMap(account).values()) {
            res = res.add(amount); // delegations from account
        }
        // Revocations are only removed from delegatee not added back to the delegator.
        // However, in the simulated state, the value is removed from delegation matrix,
        // which affects both delegatee and delegator. Therefore we add the revoked
        // value back to the total delegated value of the delegator.
        res = res.add(this.revocations.get(account));
        return res;
    }

    private delegatedVPTo(account: string) {
        let res = BN_ZERO;
        for (const [from, bips] of this.bipsDelegations.colMap(account)) {
            res = res.add(bips.mul(this.balances.get(from)).divn(MAX_BIPS)); // delegations to account
        }
        for (const amount of this.amountDelegations.colMap(account).values()) {
            res = res.add(amount); // delegations to account
        }
        return res;
    }

    private delegatedGovernanceVPFrom(account: string) {
        let res = BN_ZERO;
        const balance = this.balances.get(account);
        for (const bips of this.governanceBipsDelegations.rowMap(account).values()) { // should be only one element
            res = res.add(bips.mul(balance).divn(MAX_BIPS)); // delegations from account
        }
        return res;
    }

    private delegatedGovernanceVPTo(account: string) {
        let res = BN_ZERO;
        for (const [from, bips] of this.governanceBipsDelegations.colMap(account)) {
            res = res.add(bips.mul(this.balances.get(from)).divn(MAX_BIPS)); // delegations to account
        }
        return res;
    }

    undelegateAll(from: string) {
        const list = Array.from(this.bipsDelegations.rowMap(from).keys());
        for (const to of list) {
            this.bipsDelegations.set(from, to, BN_ZERO);
        }
    }

    undelegateAllExplicit(from: string, toList: string[]) {
        for (const to of toList) {
            this.amountDelegations.set(from, to, BN_ZERO);
        }
    }

    undelegateGovernance(from: string) {
        const list = Array.from(this.governanceBipsDelegations.rowMap(from).keys()); 
        for (const to of list) { // should be only one element
            this.governanceBipsDelegations.set(from, to, BN_ZERO);
        }
    }
    
    revokeDelegation(from: string, to: string) {
        const bips = this.bipsDelegations.get(from, to)
        if (!bips.isZero()) {
            const revocation = bips.mul(this.balances.get(from)).divn(MAX_BIPS);
            this.revocations.set(from, this.revocations.get(from).add(revocation));
            this.bipsDelegations.set(from, to, BN_ZERO);
        }
        const amount = this.amountDelegations.get(from, to);
        if (!amount.isZero()) {
            this.revocations.set(from, this.revocations.get(from).add(amount));
            this.amountDelegations.set(from, to, BN_ZERO);
        }
    }

    votePowerFromTo(from: string, to: string) {
        const bips = this.bipsDelegations.get(from, to);
        if (!bips.isZero()) {
            return bips.mul(this.balances.get(from)).divn(MAX_BIPS);
        }
        return this.amountDelegations.get(from, to);    // if missing, zero will be returned anyway
    }

    governanceVotePowerFromTo(from: string, to: string) {
        const bips = this.governanceBipsDelegations.get(from, to);
        if (!bips.isZero()) {
            return bips.mul(this.balances.get(from)).divn(MAX_BIPS);
        }
        return this.governanceBipsDelegations.get(from, to);    // if missing, zero will be returned anyway
    }
    
    // to simulate vpcontract replacement
    clearAllDelegations() {
        this.bipsDelegations.clear();
        this.amountDelegations.clear();
        this.revocations.clear();
    }
    
    save(file: string, indent?: string | number) {
        const obj = {
            balances: this.balances.toObject(),
            bipsDelegations: this.bipsDelegations.toObject(),
            amountDelegations: this.amountDelegations.toObject(),
            revocations: this.revocations.toObject(),
            governanceDelegations: this.governanceBipsDelegations.toObject(),
        };
        saveJson(file, obj, indent);
    }
    
    delegationModeOf(account: string) {
        if (this.bipsDelegations.hasRow(account)) return DelegationMode.PERCENTAGE;
        if (this.amountDelegations.hasRow(account)) return DelegationMode.AMOUNT;
        return DelegationMode.NOTSET;
    }
    
    delegatorsOf(account: string) {
        return Array.from(this.bipsDelegations.colMap(account).keys())
            .concat(Array.from(this.amountDelegations.colMap(account).keys()));
    }

    delegateesOf(account: string) {
        return this.bipsDelegateesOf(account).concat(this.amountDelegateesOf(account));
    }

    bipsDelegateesOf(account: string) {
        return Array.from(this.bipsDelegations.rowMap(account).keys());
    }

    amountDelegateesOf(account: string) {
        return Array.from(this.amountDelegations.rowMap(account).keys());
    }

    clone(): VPTokenState {
        return new VPTokenState(
            this.balances.clone(),
            this.bipsDelegations.clone(),
            this.amountDelegations.clone(),
            this.revocations.clone(),
            this.governanceBipsDelegations.clone());
    }
}
