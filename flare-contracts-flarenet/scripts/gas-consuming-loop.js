// For use with hardhat console
// Run hardhat console with:
// yarn hardhat console --network staging
// run code below while running spammers

let Inflation = artifacts.require("Inflation");
let inflation = await Inflation.at("0xF11e5B522cDbc30b67dCcE3607C1e9796F55e9C3");

let FtsoManager = artifacts.require("FtsoManager");
let ftsoManager = await FtsoManager.at("0x2dC17ABe95C889aA4c9474eD45Dd454Ed1Ec1ec1");

let inflationGasLimit = 2000000;
let ftsoManagerGasLimit = 40000000;

let FiniteLoopMock = artifacts.require("FiniteLoopMock");
let finiteLoopMock = await FiniteLoopMock.new( {gasPrice: "5000000000000", gas: "2000000" } );
// let finiteLoopMock = await FiniteLoopMock.at("0xEBAB67ee3ef604D5c250A53b4b8fcbBC6ec3007C");

let finiteLoopMockGasLimit = 0;

let registrations = [
    { daemonizedContract: inflation.address, gasLimit: inflationGasLimit },
    { daemonizedContract: ftsoManager.address, gasLimit: ftsoManagerGasLimit },
    { daemonizedContract: finiteLoopMock.address, gasLimit: finiteLoopMockGasLimit }
  ];

const FlareDaemon = artifacts.require("FlareDaemon");
let flareDaemon = await FlareDaemon.at("0x1000000000000000000000000000000000000002");
let GOVERNANCE_GENESIS_ADDRESS = "0xeAD9C93b79Ae7C1591b1FB5323BD777E86e150d4";
await flareDaemon.registerToDaemonize(registrations, { from: GOVERNANCE_GENESIS_ADDRESS }); 
