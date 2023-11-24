import * as fs from 'fs';

export function writeError(err: any) {
    if (err) {
        console.log(err);
        throw err;
    }
}

export function isBaseTenNumber(x:string):boolean {
    return /^\d+$/.test(x)
}

export function logMessage(logFile:string, message:string, quiet: boolean = false) {
    if(!quiet) console.log(message)
    fs.appendFileSync(logFile, message + "\n"); 
}


export async function sleep(ms: number) {
    await new Promise((resolve: any) => { setTimeout(() => { resolve() }, Math.floor(ms)) })
}