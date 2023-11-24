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


// GasConsumer.sol
let GasConsumer = artifacts.require("GasConsumer");
let gasConsumer = await GasConsumer.new({ gasPrice: "500000000000", gas: "2000000" });
let tx = gasConsumer.push(1);
let contracts = await generateContracts(GasConsumer, 100)
contracts.map(contract => contract.address)

// GasConsumer2.sol
let GasConsumer2 = artifacts.require("GasConsumer2");
let gasConsumer2 = await GasConsumer2.new(100000, { gasPrice: "500000000000", gas: "2000000" });
let tx = gasConsumer2.push(1);
await gasConsumer2.length()

let contracts2 = await generateContracts(GasConsumer2, 5, 100000)
contracts2.map(x => x.address)

async function checkLengths(contracts) {
  for (let contract of contracts) {
      console.log((await contract.length()).toString())
  }
}

let gasConsumerNew = await GasConsumer2.new(100000, { gasPrice: "5000000000000", gas: "2000000" });
// let gasConsumerDegraded = await GasConsumer2.at("0xc83f505957dA2Bda8a5e190c13689387616E9768")

// GasConsumer3.sol
let GasConsumer3 = artifacts.require("GasConsumer3");
let gasConsumer3 = await GasConsumer3.new({ gasPrice: "5000000000000", gas: "2000000" });

async function gasUsage3() {
  let weights = [2, 5, 10, 15, 20, 30, 35, 45, 60, 70];
  console.log("{")
  for (let weight of weights) {
      let gas = (await tester3.push(weight)).receipt.gasUsed;
      console.log(weight + ":" + gas + ",");
  }
  console.log("}");
}

let contracts3 = await generateContracts(GasConsumer3, 5)
contracts3.map(x => x.address)

// GasConsumer4.sol
let GasConsumer4 = artifacts.require("GasConsumer4");
let tester4 = await GasConsumer4.new({ gasPrice: "5000000000000", gas: "2000000" });

let contracts4 = await generateContracts(GasConsumer4, 10)
contracts4.map(x => x.address)

// GasConsumer5.sol
let GasConsumer5 = artifacts.require("GasConsumer5");
let gasConsumer5 = await GasConsumer5.new(2000000, { gasPrice: "5000000000000", gas: "2000000" });

let contracts5 = await generateContracts(GasConsumer5, 10, 2000000)
contracts5.map(contract => contract.address)

// GasConsumer6.sol
let GasConsumer6 = artifacts.require("GasConsumer6");
let gasConsumer6 = await GasConsumer6.new(100, { gasPrice: "5000000000000", gas: "2000000" });

let contracts6 = await generateContracts(GasConsumer6, 10, 100)
contracts6.map(contract => contract.address)

// GasConsumer7.sol
let GasConsumer7 = artifacts.require("GasConsumer7");
let gasConsumer7 = await GasConsumer7.new({ gasPrice: "5000000000000", gas: "2000000" });

let contract6Addresses = contracts6.map(contract => contract.address);
await gasConsumer7.setContracts(contract6Addresses);
await gasConsumer7.gasConsumers6Contracts(0); // test
gasConsumer7.address;