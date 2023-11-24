# Hardhat console

Hardhat console is an interactive shell that enables interactive web3/truffle/ethers calls to a chain. Identical code as used with tests can be used for interactive querying or sending transactions and inspecting results. Possible use cases include:
- test deployment of contracts,
- reading on-chain values.

## Getting started

Several networks are defined in `hardhat.config.ts`, among which are `scdev` and `local`. 
To work with `scdev` network, use nodes from [Flare repository](https://gitlab.com/flarenetwork/flare). Local network is hardhat network, that can be started by calling 
```
yarn hardhat node
```
While these networks are considered as "external" (ran as local or remote standalone processes to which we can connect), there is also `hardhat` network which is "internal" (in-memory).

Before running hardhat console connecting to external network, be sure that the relevant external network is running on relevant RPC.
To run the hardhat console type (example for `scdev` network):
```
yarn hardhat console --network scdev
```
An interactive command line will get started. If network is not provided internal `hardhat` network is assumed.

Additional field called `c` (contracts) is injected into hardhat environment (`hre.c = await hre.getContractsMap()`). It contains contracts from `deployment/deploys/<network>.json`.

To connect to contracts defined in some other file (e.g. `deployment/deploys/songbird_fix.json`) use
```
let contracts = await getContractsMap("deployment/deploys/songbird_fix.json");
```

All functions defined in `scripts/console-scripts/console-helpers.ts` are also injected into hardhat environment and can be used in console directly.

## Examples

To get current XRP price from FTSO contract use `await hre.c.ftsoXrp.getCurrentPrice()`.

For more examples see [`console-examples.js`](./console-examples.js)
