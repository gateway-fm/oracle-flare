
function generateAccounts() {
    const fs = require('fs');
    const Wallet = require('ethereumjs-wallet').default;

    let accountsCount = process.argv[2] || 100;
    let balance = "100000000000000000000000000000000"

    let accounts = [];
    for (let i = 0; i < accountsCount; i++) {
        let wallet = Wallet.generate();
        accounts.push({ privateKey: wallet.getPrivateKeyString(), balance });
        // console.log(wallet.address)
        if(i % 1000 == 0) {
            console.log(i);
        }
    }
    let fname = process.argv[3] || "accounts.json";
    fs.writeFileSync(fname, JSON.stringify(accounts));
    console.log(`${ accountsCount } accounts generated`);
}

generateAccounts();