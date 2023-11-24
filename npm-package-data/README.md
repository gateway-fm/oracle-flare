# Flare Network Price Provider | Kick-off package

This Kick-off package contains Flare interface files and some mock FTSO (Flare Time Series Oracle) contracts that can be used by a price provider to test their code for feeding prices. The mock contracts will exhibit nearly the same behavior as a full FTSO.

If you want to immidietly start testing. Please skip to section *custom Testing*.

## Prerequisites for using the package

For using this package you should be familiar with the following:

- [Hardhat](https://hardhat.org/) enables running a local block chain and playing with it.
- [Remix](https://remix.ethereum.org/) which enables deploying contract to any EVM network
- [MetaMask](https://metamask.io/)
- Writing JavaScript code
- Experience using [web3](https://web3js.readthedocs.io/en/v1.4.0/) or [ethers](https://docs.ethers.io/v5/) libraries to communicate with an EVM (Ethereum-like) blockchain.

## Use this package to...

Test your price provider bot.
This package will have almost the same behavior as the FTSO that will be deployed, with regards to:

1. price provider white listing
2. price submit
3. price reveal
4. FTSO registry interactions

_The above will differ in gas consumption from the real deployed FTSO contracts._

The package **doesn't** cover the following aspects of being a price provider:

- gaining enough vote power to be able to list yourself
- sharing rewards
- running weighted median algorithm and choosing the addresses (prices) to be rewarded

### Package Contents

This package contains core methods, logic and mock contracts for whitelisting a price provider, price submission and reveal.
The package does _not_ contain any reward, median calculation, or vote power delegation.
All calculations related to voting power are removed and replaced with mock calculations.
Calculations related to price epoch finalization and reward distribution are not included.

## Getting Started

1. Install `npm` and `npx`.
1. Initialize project in empty directory `npm init -y`.
1. Install the package: `npm i @flarenetwork/ftso_price_provider_kick_off_package --save-dev`.
1. Run `npx flare-cli` which overwrites current package with flare package data and contracts.
1. Run: `yarn`.
1. Compile the Solidity code: `yarn c`.
1. Run basic tests: `yarn test`.

## Package Structure

- User facing interfaces in [contracts/userInterfaces/](contracts/userInterfaces/).
- Mock implementation of provided contracts in [ftso/priceProviderMockContracts/](ftso/priceProviderMockContracts/).
- Unit tests that showcase basic price provider workflow in [test/unit/ftso/priceProviderMockContracts/priceProviderMockContracts.ts](test/unit/ftso/priceProviderMockContracts/priceProviderMockContracts.ts).
- Additional documentation about price provider pipeline and general overview in production network in [docs/specs/PriceProvider.md](docs/specs/PriceProvider.md)
- Pseudocode for price provider pipeline in [docs/specs/PriceProviderPseudoCode.txt](docs/specs/PriceProviderPseudoCode.txt).

## Interfaces

Folder [userInterfaces](contracts/userInterfaces/) contains user facing interfaces for price provider usage. Interfaces are exactly the same as in production and the live testing (Songbird) network. Important interface files are:

### [IPriceSubmitter.sol](contracts/userInterfaces/IPriceSubmitter.sol)

This is the main entry point contract for price providers.
In the production network, the real contract will be deployed to a fixed address in a genesis block.
User facing interface provides access to all contracts needed by the price providers: `VoterWhitelister` and `FtsoRegistry`.
The Price Submitter contracts is the main point of contact for price providers as it provides the method for price submission and reveal.

Mock implementation `MockPriceSubmitter` deploys all needed mock contracts for price provider example and a list of 10 FTSOs for testing purposes.
Deployed mock contracts are accessible through methods in user interface.

Mock implementation implements `submitHash` and `revealPrices` as faithfully as possible compared to production network, namely:
  
- It checks that price provider is allowed to submit price hash to provided FTSO indices and reverts in the same way as a production version would.
- It checks that price provider is allowed to participate in price reveal period.
- It checks that the revealed prices are correct with regard to submitted hashes.
- It checks that the price is submitted with the correct epoch id.
- It checks that the price is submitted at most once per epoch.
- It checks that the reveal was done in the correct time interval _and_ in the correct reveal epoch.
- The emitted events are the same as on production network.
- The revert conditions are the same as on production network.
- It checks that ftso indices are submitted in the correct order.

Price hash submission and reveal is done through FTSO indices provided by `FtsoRegistry`.

*Methods unavailable in mock setting*: `getFtsoManager` does not work as `FtsoManager` is not part of the mock package. All other methods available in public interface are working.

Prices are submitted as `uint256` values and correspond to the price of asset agains USD.
The actual USD asset price is `submitted_price / 10^number_of_decimals`.
Number of decimals is fxed at `5`.
For example, to submit that an asset has a price of `299792.458` usd, submit an `uint256` integer with a value of `29979245800`.

### [IVoterWhitelister.sol](contracts/userInterfaces/IVoterWhitelister.sol)

The `VoterWhitelister` contract facilitates voter whitelisting.
Price providers can request to be whitelisted for a specific asset index using `requestWhitelistingVoter()` or request whitelisting for all assets at once `requestFullVoterWhitelisting()`.

The `VoterWhitelister` contract is in charge of allowing/disallowing price submissions.
For each FTSO, a whitelist of up to `N` allowed voters is kept.
The number of voters per asset can vary and is settable by Governance.
When a price provider tries to whitelist himself, his power is calculated as sum of normalized xAsset and Wnat power for that FTSO whitelist.
Normalization is done with respect to all power currently in the whitelist (_the same way as median is calculated_) and not the full vote power per asset.
The prerequisite for a price provider is explicit whitelisting.
Each user can require any address to be whitelisted by the `VoterWhitelister` contract.
The request calculates the requesting user's power and conditionally adds that address to the whitelist.
If the whitelist is not full, the price provider is added immediately.
If the list is full, the user with minimal voter power is found and replaced with the requesting user only if the new user's power is strictly greater.
When the number of voter slots is lowered, the voters get removed from whitelist one by one by removing the one with minimal power on each step.
Events are fired to notify voters about the change of voter status on the whitelist.

The mock implementation allows only one user per asset to be listed and does not calculates vote power. The whitelisting request always succeeds and removes previous user from the whitelist.

*Methods unavailable in mock setting*: `defaultMaxVotersForFtso` and `maxVotersForFtso` are available, but ther result (always 0) is irrelevant as exactly one voter is allowed per ftso. All other methods available in public interface are working.

### [IFtsoRegistry.sol](contracts/userInterfaces/IFtsoRegistry.sol)

`FtsoRegistry` provides access to available FTSOs, corresponding currency symbols, and convenience methods for interactions.
To get FTSO index for a `XRP` use `ftsoRegistry.getFtsoIndex("XRP")`. This index can be used to act as a price provider for `XRP`.

*Methods unavailable in mock setting*: All methods available in `IFtsoRegistry` are working in mock setting.

### [IFtso.sol](contracts/userInterfaces/IFtso.sol)

`FTSO` is the Flare Time Series Oracle. Ftso provides access to specific asset information and price epoch data (submit/reveal periods len, first epoch start timestamp).

*Methods unavailable in mock setting*: `getCurrentPrice`, `getCurrentRandom`. Since no finalization and price calculation is done, calculated prices and randoms are not available. All other methods available in public interface are working.

**FTSO index for a symbol is FIXED and it will NEVER change.**

If the FTSO index for `XRP` is `1` at any time, then price submission for `XRP` would always happen at FTSO with index `1` and no other symbol can have index `1`.
Underlying `FTSO` contract for this symbol might be upgraded with new functionality and security updates... but it will still correspond to the same FTSO index.

## Basic Tests

Unit tests that showcase basic price provider workflow and possible errors are located in [test/unit/ftso/priceProviderMockContracts/priceProviderMockContracts.ts](test/unit/ftso/priceProviderMockContracts/priceProviderMockContracts.ts).
Unit tests can be run with `yarn test`.

Unit tests test a few simple scenarios:

- Price submission failure when not whitelisted
- Emmittance of events on success
- Failures when revealing a price outside the reveal range

The successful submit and reveal test also showcases basic price provider pipeline.
Price provider must first request whitelisting, then submit the price hash, wait until the price submission epoch passes and reveal the price inside the reveal period.

## Custom testing

### Local Hardhat node

Running `yarn hh_node` spins up a [Hardhat] node on localhost and deploys the mock contracts.
The setup outputs the address of deployed `PriceSubmitter` contract and keeps the node alive.
Hardhat console can then be used to connect to the localhost network and interact with deployed contracts locally in real time.

A simple price provider script is also available to show price provider in use. Script is available in `deployments/scripts/mock-price-provider.ts`.
It acts as a simple price provider and goes through whole process.

- Get contracts deployed on local node
- Whitelist current address
- Submit and reveal prices in a loop

Script can be run using `yarn starter`.
Currently the submitted prices are acquired randomly, but you are welcome to change
`getPrice` function and implement more complicated logic.

Be careful local hardhat node can experience "time drift" relative to the computer local time.

### Testing on [Remix]

<!-- under construction Mock contracts in [contracts/ftso/priceProviderMockContracts/priceProviderMockFtso.sol](contracts/ftso/priceProviderMockContracts/priceProviderMockFtso.sol) can be flattened with `yarn flatten_mock_scripts`. -->
Flattened contract in [flattened/contracts/ftso/priceProviderMockContracts/PriceProviderMockContracts.sol](flattened/contracts/ftso/priceProviderMockContracts/PriceProviderMockContracts.sol) can be deployed on Remix, or similar service, and tested.
<!-- For testing on Remix enable optimization and remove multiple `pragma abicoder v2;` commands. -->

### Hash examples

File `scripts/python_hashes.py` contains an example python script that produces submission hases.

Example hashes for submission of prices: `[0, 1, 2, 3, 5, 10, 50, 100, 101, 10**5 + 1, 10**8]` from specified address and with specified random.

```
Address: 0xD7de703D9BBC4602242D0f3149E5fFCD30Eb3ADF
  Random: 0
    hash: 0x91000538dcc6ede199de3820e38ccaf48ee73663f45054510b19dfdfb241eb15
  Random: 1
    hash: 0x26f9b2915cb0ecc13aa3448f186bdffe9781100d6c387de8a7653a66d9122f54
  Random: 100
    hash: 0x55fe08226f212f2815cd2249b1dd1194b79c09dc31b659707ce291596c86deeb
  Random: 101
    hash: 0xde60191d848a03c14184b27426037e5ef092df0e0f41945564d50bc6d71072b2
  Random: 100000000000000000000
    hash: 0xeb55789aae05143d1ecd880e594de3aab682a98962a19fc4a7376ccd0cff8adb

Address: 0xEa960515F8b4C237730F028cBAcF0a28E7F45dE0
  Random: 0
    hash: 0x42b9ad2aa7d3ecb03e69b79570ac0f7dcc8327316058042b2447c1e66f500df8
  Random: 1
    hash: 0x23752e45a5cffaf2ce746926a614c1ae50e84abc198192c8c6325351970e1ba4
  Random: 100
    hash: 0x6d84e8425b93524e592a15d6eb0104505a4a3b77d5c4ecbefdc237c6eca4e684
  Random: 101
    hash: 0xa0def4dc9b585df6fc3b840c84f4bf59efabb9c6705f0e9aa5a500c67779d072
  Random: 100000000000000000000
    hash: 0xb69ebaeebf9e80e31f89ef9c0aa0f8a639ab805c9879c9e59178930eb80961d0

Address: 0x3d91185a02774C70287F6c74Dd26d13DFB58ff16
  Random: 0
    hash: 0x1976d32b036311b46a1e51dd585fd0e63c38e43a12c7e7669daca92c06aa2fe2
  Random: 1
    hash: 0xa350f93b03c0a3c5c5df18d0ee008262da48142f77e5336ddae30454161d2c1b
  Random: 100
    hash: 0xa88f04ea5617043548b96817fa1bb9363fb5ce3483d92b274e31f1277a9e936b
  Random: 101
    hash: 0x349cfd79ec68cc820a46c37e97291da970bb5855425469ec4708b10b5087cfec
  Random: 100000000000000000000
    hash: 0xe22869b0868440f5eb537126c67a1d14298bbf392d5dc1565a828a2d0c912dda
```

More can be generated with unittest "Should output sample hashes".
