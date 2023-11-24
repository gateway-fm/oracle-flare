// Copy of process file from flare repo (06-08-2021) (DD-MM-YYYY)

export function writeError(err: any) {
    if (err) {
        console.log(err);
        throw err;
    }
}

export function isBaseTenNumber(x:string):boolean {
    return /^\d+$/.test(x)
}

export interface LineItem {
    XRPAddress: string,
    FlareAddress: string,
    XRPBalance: string,
    FlareBalance: string
}

export interface ProcessedLineItem {
    NativeAddress: string,
    totalNativeBalance: BN,
    initialAirdropBalance: BN,
    distributionMonthlyBalance: BN,
    totalDistributionBalance: BN, 
}