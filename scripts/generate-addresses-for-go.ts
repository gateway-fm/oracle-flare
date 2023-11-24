function hexToUintArray(hexString: string) {
    return new Uint8Array(hexString.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
}

function toHexString(byteArray: Buffer) {
    return Array.from(byteArray, function (byte) {
        return ('0' + (byte & 0xFF).toString(16)).slice(-2);
    }).join('')
}

function generateAddressesForGo() {
    const fs = require('fs');
    const Wallet = require('ethereumjs-wallet').default;


    let wallets = [...JSON.parse(fs.readFileSync('test-1020-accounts.json'))].map(acc => new Wallet(Buffer.from(acc.privateKey.slice(2), "hex")))
    // .map(acc => new Wallet(acc.privateKey))
    let entries = []
    for (let wallet of wallets) {
        entries.push(
`              "${'0x' + toHexString(wallet.getAddress())}": {
                   "balance": "0x314dc6448d9338c15B0a00000000"
               }`)
    }
    let entriesInsert = entries.join(",\n");
    let res = fs.readFileSync('scripts/local-flare-chain-vm/files/genesis_coston_template.go', 'utf8').replace("<INSERT_HERE>", entriesInsert);
    fs.writeFileSync("scripts/local-flare-chain-vm/files/genesis_coston.go", res, "utf8");
}

generateAddressesForGo();