# Flare Network Price Provider | Kick-off package

This Kick-off package contains Flare interface files and some mock FTSO (Flare Time Series Oracle) contracts that can be used by a price provider to test their code for feeding prices. The mock contracts will exhibit nearly the same behavior as a full FTSO.

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

Mock implementation implements `submitPriceHashes` and `revealPrices` as faithfully as possible compared to production network, namely:
  
- It checks that price provider is allowed to submit price hash to provided FTSO indices and reverts in the same way as a production version would.
- It checks that price provider is allowed to participate in price reveal period.
- It checks that the revealed prices are correct with regard to submitted hashes.
- It checks that the price is submitted with the correct epoch id.
- It checks that the price is submitted at most once per epoch.
- It checks that the reveal was done in the correct time interval _and_ in the correct reveal epoch.
- The emitted events are the same as on production network.
- The revert conditions are the same as on production network.

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

`FTSO` is the Flare Time Series Oracle. Ftso provides access to specific asset information and price epoch data (submit/reveal perdios len, first epoch start time.

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

Example hashes for submission of prices: `[0, 1, 2, 3, 5, 10, 50, 100, 101, 10**5 + 1, 10**20]` from specified address and with specified random.

```
Address: 0xD7de703D9BBC4602242D0f3149E5fFCD30Eb3ADF

    Random: 0
        0x18a7093b69446c2f791628e05953f190c6c361a8ea815a662e48770d2e00fffc,0x77f0df47c28a076802a9c87db1c501de54ff0fbce8fc4522f30d26c7b381e928,0x7af9ba1a04b07eb2d8d8a22cf5dd67c4fa4bcaabf4d0a2ac405c7a67bc55906a,0x413528a782d0a336058232a42d9f284555f5931c9407114b80608193bff27dc0,0x4600f72b58ceb7e68fa825d3fb9ac49021c1477fd568dc35b2c9a68b6720de77,0x9ea4bc675a23e3e12bf10a805d995342a636fd8f61c9e4b394ca6fbfad625140,0xe78de78872fa0f96307a8a1a5ced208670cb576796d42688e234f26d9b3d7e95,0x684b26803784b2e3a435d01a40d3b533359f646582c1b5b678dcfb9a82ec9568,0xc7a2b5d09d467130035c41886557eb161a14df2a194b3d5afe12a9a7a7654be0,0x9c0491874239118acc6e2ac695c7b67c12d27ea39773949901c8d34448b556d0,0x6f4211f0c7f2245930817bd83b7bc84c95940f8a0825f9a6d5e3a2084cfe6d0a

    Random: 1
        0xe980e37764f5fa5afa76ee475b314d480b0cd31ba9b5a6c63cec90bb56acce3a,0x3434a6047d2a359f685ae6baba5920d16ed990739ea3422d1ef30a556a17f955,0x4c1a2150ec9c8c21b51c967a8c81ba655f4dcdec7ffc9289ff8bca02606fdb85,0xb6280b8de63e88d600639201826433f9fa5cec7b0067f6d79c97c8d92a28d5f3,0x88ea99faa23ddc0d0641eb27adbb85f63d3afe98e2eccddbc7def52c21fd615d,0xd0fec56bb6f5e5ce510749ae9226c1b5b42cdf4d19e815d69070b07aea731b51,0x6fa7d2c5bdbc1c3a79d9421efc68525f286c772ef3deee1e7ea174a99201e787,0x5c55bcd3bca54e8a56ea74847e1b1dc93bd656ad347ac6e272e493e2b67deeb7,0xbe81e776029fd0331f6a4a5b797067118a009050cc35a6d5f61069b04a7031a3,0x1948c75fbf3ef1136d5c489750649005038a1233ae06cc754cda07426b6438fa,0x4a54bd657e1cccb4e5a39ca2124addb367f968d9b7f8e76a715c597111e0fb99

    Random: 100
        0x91fd41ef9b837ddc39db65e3cc394b85e78b391e55bae90171d4fd51371caabf,0x68dd4f1f3b860b2fc46c97982f5a6a328b37604393ce0b6c0ba1e312e739f88f,0x0b805954e4b9e938df019681e89de5113a96a3b602ac092c9da437bd8c4488a8,0xba0897d119501eee9bc78d1dc5099f6f2dae95144a4063c39accaeda64f46cdf,0xb689377610c6a0744766dedc5d662103547e1017842632ed91923f561cb0e785,0x7c391baf9e73a37c93deca46df4f458a4a04bc0df26f4898e5aa4a9a73ef2116,0xc35dab8417b248361be0185f5e825e262d1141ee9e13193cf8330d1fb72c3ad0,0xb9f0649aecb05eb3c7a5e44a29945079d56f0b784cedd709930a39701b2a70e8,0x3f4e81a90a9a661526eb8165d2b1d10607141f7f60d68e32e65780caf958ddbb,0x28f9c816221fd0946531d2c679ffabd0ee8f6d3092d3ee4e91dbed2ea06d75cb,0x0e08a8c4ab561bba3fd8a5fc2f5a39ca73633dc82957259ff7738ae9abb5b318

    Random: 101
        0xb2ac2dcf7300e245e8c91b66ca560aa44f1db7fbfa2a4f3a0b13785511d3f800,0xd87f5e42f3a651d0af5238cc774ba135ef12fa5ff2e3157a86849d653921c942,0x5f49d6d99e5200f71d13869a6652035ec0fd6be7eed31a2b51aa21d9d1ab6807,0x2c458b7456f5dce8371cb30b4e1a98dba6749c261e15209694ed48132a2e52fd,0x5a918d1d37ff2ccbbf7f71d80148c8c502d417b7410713d7621e9e5bdd7966a4,0x55937aaa7daf30b2a3caec27bdb0e5f781a5ca6020f5f2550b13b034e428acd0,0x41f3e72506227a21629d2756d5e874eb1536f968377037688d3e4c9f6938fb4d,0x81736a2174a1625350d46793c65cb315ad34ae4d84e0aaca065d04c28536cebc,0x5451ccc6bf2bb8c70c0a85b39b70138e98e5d444df4112bacff014f908b93be8,0x9171b094b666e79b4bfc860b947ec176d9e5bc8b523f9953f570ea19357701fc,0x710f74e017e11b9a35ebc10f3dabf2fbbeba7c051c3ece685bd50226d44e458d

    Random: 100000000000000000000
        0x79bcc29047be7f9d7e62cee0ba0de1e1437dfd8bb8373dc507e12f8371489502,0xb5e766fdeeef0016674a44c2a2c0b8d7732174f65d164e85a064ad4958a9771b,0x546b273ba53602f82352fe31904a90bf109df720060491362497b1461bf45a7c,0xc8fc729ec1af9e7977be09e1f146107072e6a3b8a804e5cf876043b726a25c8a,0x2b92216c26c60a32013892b109036755e0a86ce39e6ea142895bae2d7c51b325,0xa554d9b262dfe15befd490481b9bd132478ad921a993203427b5bce65787a2d7,0xe5fbe5f6f1b37e7c9a1037c0a11d7b8cf4353b38eb44d4e6615d1b21926a1b1e,0x3d2f4d5b457b5ba3d93ffd1a447bef040fca023b264042107158cc66c753d4cc,0x2c81755e76dd74b3bc19c14bd78cd8d3ecf2c85639802f7c8fea39fa4519d55b,0xb1d3b5fc89626ead2fc78b0685c2c73e3554a13f7c6b0c1421bacef06e40084e,0xc96136b35776f0c572ce1f501d3a35c404a25cdcf023830e7f3d4dcde7f9d6e0

Address: 0xEa960515F8b4C237730F028cBAcF0a28E7F45dE0

    Random: 0
        0x07d90f5fb73a61d24923e5d68760ccb9f6712733dffdbf3afa2a6b9f6f6bdbf2,0x830ba5c1c12175a60616c2558cd6244088b2066e6afbddc1a9b50d74768fafcc,0xd8ef07d83d9f79dfbc87cfb066c0f03351b29187c54c62cd5242a6c4909bdf0f,0x43d2ffe96669ec6788fb24e04f8c0a318fc84ba817b85440bafa11d991ecd7af,0x059825a61956987686459549271938b2955594829129c4a744df44b01fda7f22,0xdbc7bc066701b03ea849e24e59c7241bb6aab4f71e20f08a4c1218bccefe2985,0xe5f9f5cff508143d242be8bbdd5c2381cd48f89efebd50b7ffe7df7f7f010b28,0x142c705bfbb22feca1fab556eb03ae170c02fd9f9e8f9236ebd33b875bb4a01f,0xc46da8e36ca6b9064c14481b75620ed2da6b89b4988e9b845f97e3ff6e863279,0xd148c8785cfaf6c9b954681cd09afa84e50e8d04ca0bed60da4b165e56182912,0x8c5b8360823f208941209e4b3d9d94f3f8d6c8f7606a8e3693aa2f9062fc20d3

Address: 0x3d91185a02774C70287F6c74Dd26d13DFB58ff16

    Random: 0
        0x423723f6a59d8474d5732c6b10fdbb2002241bb013ed80bc8805a98df376f2ac,0x1eb46c0830ee2b40c60e0ebb5a79b31ad82f37ffb32c2f15e61e383ca9142556,0xcf075b24b3f0dddfb053a5e409e56ca862d8ead133d6b3c882edb3333b3541c8,0x5d943d8e3af39cbd57bb7f0bd6de863c78d44a70e47ccb36756c9ac07c461af6,0xd5e90c897f328df62f9cbc8985b02b2dc090227ab7c9774c80f6d33a43fc8c46,0xd86ddca711572e76a14a9f7e76e7a113d357f46bf3c7fdb5a32c2d0b2b7515bd,0x5a61e7744065d907c2e28a7795ce7577bda3ea18bf334dc821ad58872fd8106d,0xea733a95a9918190009d119dfbd245cc1acaa716f500cce6525ab1e70849221e,0x0b36f60a7ccdf345d0e764e5f2ff1b9e65351ebe48178415b9bf21bfac218aad,0x9d7ae8848eddc52dc2794b48805dbb3982d4b12d30fe6508550c23857200d088,0x18378795b22a1c68466d4cf1f57e146c930b2f4b9b977402ff241d9774984eed
```

More can be generated with unittest "Should output sample hashes".
