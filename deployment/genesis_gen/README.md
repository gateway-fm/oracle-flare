# Genesis JSON file configuration

## Preparing Flare node

The Flare node is available at https://github.com/flare-foundation/flare
Follow the requirements and instructions for compiling the node.

## Generation of genesis JSON

Genesis JSON file contains a genesis configuration of a network in which C-chain genesis configuration is 
embedded as a serialized JSON under the key `cChainGenesis`. For example, see `deployment/genesis_gen/generated/scdev.json`.
This tool makes generation of such a file a bit easier. The input to generator are two files representing the toplevel JSON and 
non-serialized C-chain genesis configuration. The tool takes the two files and the deployedBytecode from `artifacts` folder of the compiled genesis contracts and builds the relevant final configuration.

## Preparing configurations

- Set this repo to the branch on which you have the state of contracts that you want to test.
- Run `yarn` and `yarn c` to compile the contracts.
- Check the relevant configurations in `deployment/genesis_gen/configs/<network_label>`.
- `yarn genesis_json -n <network_label>`. Default network label is `scdev`.

The JSON file for genesis will be generated as `deployment/genesis_gen/generated/<network_label>.json`.

## Configs for specific networks

Configs for each (labeled) network are in the folders `deployment/genesis_gen/configs/<network_label>`. Each folder contains two files:
- `cChainGenesis.json` - C-chain genesis configuration (JSON). Here are the majority of the settings, including funded accounts and genesis contracts
- `template.json` - top level JSON for genesis configuration.

## Running Flare node with specific configs

Below is an example for running custom JSON genesis config for the network `scdev`.

- Build the node on `flare` repo. This is required only once. Different genesis configuration JSON files are then passed as parameters.
- Copy `deployment/genesis_gen/misc/launch_local_scdev.sh` from this repo to `scripts/launch_local_scdev.sh` in `flare` repo.
- Copy the generated file `deployment/genesis_gen/generated/scdev.json` file into the root of the `flare` repo.
- Grant executable privileges on the script file `chmod +x scripts/launch_local_scdev.sh`
- run `./scripts/launch_local_scdev.sh` to set up 5-node network with given genesis

## Troubleshooting

- Take care that upon changing the genesis config file the chain databases for nodes are deleted. The databases are usually in `db` folder on the toplevel in the local `flare` repo folder.
- Take care of killing the hanging node processes before running the network. Check the processes with `ps aux | grep build/flare`. You can also check if processes are runing on port by using `lsof -i :9650`
- When nodes are running, check the health of the first node by using `curl http://127.0.0.1:9650/ext/health`
- One can test genesis contract for example as follows (for `scdev` network):
  - first run `yarn hardhat console --network scdev`,
  - then run the following code snippets:
```
const FlareDaemon = artifacts.require("FlareDaemon");
let flareDaemon = await FlareDaemon.at("0x1000000000000000000000000000000000000002");
const PriceSubmitter = artifacts.require("PriceSubmitter");
let priceSubmitter = await PriceSubmitter.at("0x1000000000000000000000000000000000000003")

// Should be 0x000...
await flareDaemon.governance()

// Should be 0x000...
await priceSubmitter.getFtsoManager()
```

