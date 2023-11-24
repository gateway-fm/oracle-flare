// For use with hardhat console
// Run hardhat console with:
// yarn hardhat console --network staging

// Helper functions

async function generateContracts(factory, n, ...args) {
    let contracts = []
    for (let i = 0; i < n; i++) {
        console.log(i);
        let res = await factory.new(...args, { gasPrice: "5000000000000", gas: "2000000" });
        contracts.push(res);
        console.log(i, "Done")
    }
    return contracts;
}

// Contract has to have push(n) function
async function gasUsage(contract, weights = [0, 1, 2, 3, 4, 5, 10, 20, 30, 50]) {
    console.log("{")
    for (let weight of weights) {
        let gas = (await contract.push(weight)).receipt.gasUsed;
        console.log(weight + ":" + Math.round(gas / 1000) + ",");
    }
    console.log("}");
}


// Tester.sol
let Tester = artifacts.require("GasConsumer");
let tester = await Tester.new({ gasPrice: "500000000000", gas: "2000000" });
let tx = tester.push(1);
let contracts = await generateContracts(Tester, 100)
contracts.map(contract => contract.address)

// Tester2.sol
let Tester2 = artifacts.require("GasConsumer2");
let tester2 = await Tester2.new(100000, { gasPrice: "500000000000", gas: "2000000" });
let tx = tester2.push(1);
await tester2.length()


let contracts2 = await generateContracts(Tester2, 5, 100000)
contracts2.map(x => x.address)

async function checkLengths(contracts) {
    for (let contract of contracts) {
        console.log((await contract.length()).toString())
    }
}


let testerNew = await Tester2.new(100000, { gasPrice: "5000000000000", gas: "2000000" });
let testerDegraded = await Tester2.at("0xc83f505957dA2Bda8a5e190c13689387616E9768")

// Tester3.sol

let Tester3 = artifacts.require("GasConsumer3");
let tester3 = await Tester3.new({ gasPrice: "5000000000000", gas: "2000000" });

async function gasUsage3() {
    let weights = [2, 5, 10, 15, 20, 30, 35, 45, 60, 70];
    console.log("{")
    for (let weight of weights) {
        let gas = (await tester3.push(weight)).receipt.gasUsed;
        console.log(weight + ":" + gas + ",");
    }
    console.log("}");
}

let contracts3 = await generateContracts(Tester3, 5)
contracts3.map(x => x.address)

// Tester4.sol
let Tester4 = artifacts.require("GasConsumer4");
let tester4 = await Tester4.new({ gasPrice: "5000000000000", gas: "2000000" });

let contracts4 = await generateContracts(Tester4, 10)
contracts4.map(x => x.address)

// Tester5.sol
let Tester5 = artifacts.require("GasConsumer5");
let tester5 = await Tester5.new(2000000, { gasPrice: "5000000000000", gas: "2000000" });

let contracts5 = await generateContracts(Tester5, 10, 2000000)
contracts5.map(contract => contract.address)

// Tester6.sol
let Tester6 = artifacts.require("GasConsumer6");
let tester6 = await Tester6.new(100, { gasPrice: "5000000000000", gas: "2000000" });

let contracts6 = await generateContracts(Tester6, 10, 100)
contracts6.map(contract => contract.address)

// Tester7.sol
let Tester7 = artifacts.require("GasConsumer7");
let tester7 = await Tester7.new({ gasPrice: "5000000000000", gas: "2000000" });
