# Usage of Tenderly

Tenderly is an online tool that allows for debugging and gas profiling of transactions.
One can use a trial version of Tenderly PRO for 14 days.
[`https://dashboard.tenderly.co`](https://dashboard.tenderly.co)

## Usage

As project is already configured, each user has to set their personal account specific settings.
- Login into your account at  [`https://dashboard.tenderly.co`](https://dashboard.tenderly.co). 
- Create a project with exact name `flare`. If the project is already created, proceed.
- Make sure you have installed `tenderly-cli`. Use instructions [here](https://github.com/Tenderly/tenderly-cli).
- If you are not logged-in in terminal use `tenderly login`. As above, you may use API key.
- Provide `TENDERLY_USERNAME` in `.env` that corresponds to your personal account. 
- When debugging/profiling with Tenderly, make sure to have the following entry in `.env`:
```
TENDERLY=true
```
NOTE: Due to current bug in `tenderly-cli` parsing `hardhat.config.ts`, it is not possible due to too many accounts. The setting above truncates the number of used accounts to 150. The code you are testing should not use more than 150 accounts.

Tenderly can be used in deployment scripts or tests. The procedure is similar. 
When using with tests, integration is usually temporary just to debug/profile code and when this is done, the added code is usually deleted.
To use Tenderly within a particular test do the following:
- We assume truffle wrappers are used.
- Be sure to run only one test (use `.only`).
- Add on the top of the test file the following require `const hre = require("hardhat");`.
- At any point after deployment (e.g. `let contract = ContractName.new(...)`), add the following code
```
await hre.tenderly.persistArtifacts({
    name: "ContractName",
    address: contract.address
});
```
This creates a metadata file `ContractName.json` in `deployments/localhost_5777`. Metadata files contains contract code, ABI, deployment address, etc. These data are later uploaded to Tenderly server into your account, if needed for debugging of transactions.

- By using `persistArtifacts` call, store the metadata of any/every contract used in relevant transaction to be debugged/profiled, including contracts accessed through external calls.  
- For particular transaction that one wants to debug/profile, store the transaction receipt in a variable and print out the transaction hash. For example:
```
let transaction = await contract.doSometing(x, y)
console.log("TX HASH:", transaction.tx)
```
- If you are debugging/profiling the test code, run the test specific network. Below is the example for standalone hardhat network (`local`):
```
yarn hardhat test --network local path/to/test_file.ts
```
- If you are debuging/profiling the code in a script, see the example below.
- After test is done, metadata files are generated and transaction's `<hash>` is printed out.
- Export the transaction by:
```
tenderly export <hash>
```
Exporting means sending transaction and contract (meta)data to Tenderly server for debugging/profiling.
On successful export, the export printout should indicate, that the contract metadata for `ContractName` with relevant address was used, and provide the link to Tenderly dashboard where transaction debugging/profiling can be carried out.

## Example: using Tenderly in script

See the example in `scripts/tenderly-test.ts`. Here we have a single contract, which is an upgrade of an ERC20 token. We deploy it and call one method (`approve()`)

- Run `yarn hardhat node` in a separate terminal.
- Run the script in other terminal:
```
yarn hardhat run --network local ./scripts/tenderly-test.ts 
```
- At the end of script the following printout appears (with other, specific TX hash, of course)
```
Transfer approved! TX hash: 0xd59b8c849ddc69a089862d3e4edbfb4ab5c4b6804061bbf7efe62fed85584705
```
- Then run (using the printed out hash)
```
tenderly export 0xd59b8c849ddc69a089862d3e4edbfb4ab5c4b6804061bbf7efe62fed85584705
```
- If the export is successful, the names of the contracts used are printed out toghether with the link to Tenderly dashboard. Use the link to analyse/debug/profile transaction.


NOTE: Tenderly currently does not support using metadata for different instances of the same contract.

# Initial configuration for a new project

NOTE: These instructions describe how the project has been configured. If you just want to use Tenderly, skip this section, as the project has already been configured for use, as described above.

## Instalation of Tenderly

- Official instructions: [Source](https://blog.tenderly.co/level-up-your-smart-contract-productivity-using-hardhat-and-tenderly/)
- Add tenderly package:
```
yarn add @tenderly/hardhat-tenderly
```
- Install  `tenderly-cli`. Use instructions [here](https://github.com/Tenderly/tenderly-cli)
Alternative is to have golang installed and clone the above github repo. Then run `go build` which builds the executable.
- The current version of `tenderly-cli`can be checked as follows (should be `v1.1.1` or higher):
```
tenderly version
``` 

## Configuring the project

- Add `import "@tenderly/hardhat-tenderly"` into `hardhat.config.ts`
- Go to `https://dashboard.tenderly.co/account`, select `Authorization tab` generate access token.
- Run `tenderly login` in terminal. Provide username and API key. 
- Add the following configuration to `hardhat.config.ts`
```
tenderly: {
    username: process.env.TENDERLY_USERNAME || "undefined",
    project: "flare"
}
```
- Provide `TENDERLY_USERNAME` in `.env` that corresponds to your personal account. Note that you should have the project `flare` defined there. Otherwise create a project under your account using [`https://dashboard.tenderly.co`](https://dashboard.tenderly.co).
- You have to have a local network defined in `hardhat.config.ts` like this:
```
    local: {
      url: 'http://127.0.0.1:8545',
      chainId: 31337
    }
```
- Initialize the project by `tenderly init --force` (it does not work without `--force`). Select the project `flare`
- Run a standalone hardhat node in a separate terminal: 
```
yarn hardhat node
```
- Run `tenderly export init`. Use the following parameters:
  - network: `local`, 
  - project: 'flare`
  - confirm rpc `localhost:8545`, 
  - choose `None`
