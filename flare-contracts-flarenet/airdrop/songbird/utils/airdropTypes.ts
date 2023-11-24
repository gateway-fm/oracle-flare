import BigNumber from "bignumber.js";

export interface LineItem {
    XRPAddress: string,
    FlareAddress: string,
    XRPBalance: string,
    FlareBalance: string
}
export interface ProcessedAccount {
    NativeAddress: string,
    NativeBalance: string
}

export interface validateRes {
    validAccounts: boolean[],
    validAccountsLen: number,
    invalidAccountsLen: number,
    totalXRPBalance: BigNumber,
    invalidXRPBalance: BigNumber,
    totalFLRBalance: BigNumber,
    invalidFLRBalance: BigNumber,
    lineErrors: number
}

export interface airdropGenesisRes {
    processedAccounts: ProcessedAccount[],
    processedAccountsLen: number,
    processedWei: BigNumber,
    accountsDistribution: number[]
}

export interface unsignedTransaction{
    from: string,
    to: string,
    gas: string,
    gasPrice: string,
    value: string,
    nonce: number,
    chainId: number
}

export interface signedTransaction{
    raw: string,
}

export interface generateTransactionRes {
    transactions: unsignedTransaction[]
    totalGasPrice: string;
}

export interface ProcessedLineItem {
    NativeAddress: string,
    totalNativeBalance: BN,
    initialAirdropBalance: BN,
    distributionMonthlyBalance: BN,
    totalDistributionBalance: BN, 
}