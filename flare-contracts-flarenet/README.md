![coverage](https://gitlab.com/flarenetwork/flare-smart-contracts/badges/master/coverage.svg?job=coverage:on-schedule)
![pipeline](https://gitlab.com/flarenetwork/flare-smart-contracts/badges/master/pipeline.svg)

![licence](https://img.shields.io/badge/Licence-MIT-green?style=plastic)

# Testing report
![Slither_badge](https://img.shields.io/endpoint?url=https%3A%2F%2Fbadges.aflabs.org%2Fapi%2F0%2Fbadges%2Fgetlatest%3Fbadge_name%3DFlareSCSlither)
![Linter_badge](https://img.shields.io/endpoint?url=https%3A%2F%2Fbadges.aflabs.org%2Fapi%2F0%2Fbadges%2Fgetlatest%3Fbadge_name%3DFlareSCSolhint)
![Fuzzer_token](https://img.shields.io/endpoint?url=https%3A%2F%2Fbadges.aflabs.org%2Fapi%2F0%2Fbadges%2Fgetlatest%3Fbadge_name%3DFlareSCFuzzerToken)
![Fuzzer_e2e](https://img.shields.io/endpoint?url=https%3A%2F%2Fbadges.aflabs.org%2Fapi%2F0%2Fbadges%2Fgetlatest%3Fbadge_name%3DFlareSCE2EFuzzer)

## Deployed contracts per chain
Smart Contracts from this repository are deployed on 4 different chains. Per chain, contract versions are slightly different. Use the links below to view the deployed contracts source code and addresses.
- [Flare branch](https://gitlab.com/flarenetwork/flare-smart-contracts/-/tree/flare_network_deployed_code), [Flare Addresses](https://gitlab.com/flarenetwork/flare-smart-contracts/-/blob/flare_network_deployed_code/deployment/deploys/flare.json)
- [Songbird branch](https://gitlab.com/flarenetwork/flare-smart-contracts/-/tree/songbird_network_deployed_code), [Songbird addresses](https://gitlab.com/flarenetwork/flare-smart-contracts/-/blob/songbird_network_deployed_code/deployment/deploys/songbird.json)
- [Coston branch](https://gitlab.com/flarenetwork/flare-smart-contracts/-/tree/coston_network_deployed_code), [Coston addresses](https://gitlab.com/flarenetwork/flare-smart-contracts/-/blob/coston_network_deployed_code/deployment/deploys/coston.json)
- [Coston 2 branch](https://gitlab.com/flarenetwork/flare-smart-contracts/-/tree/coston2_network_deployed_code), [Coston 2 addresses](https://gitlab.com/flarenetwork/flare-smart-contracts/-/blob/coston2_network_deployed_code/deployment/deploys/coston2.json)

# Flare Network smart contracts repository

Contracts cover the following *Flare network* building blocks:
- [Token](contracts/token/implementation) contracts.
- [FTSO](contracts/ftso/implementation/Ftso.sol) (Flare time series oracle).
- [FTSO Manager](contracts/ftso/implementation/FtsoManager.sol).
- Token pools for reward and distribution.
   - [FTSO Reward manager](contracts/tokenPools/implementation/FtsoRewardManager.sol).
   - [Distribution contract](contracts/tokenPools/Distribution.sol)
- [Flare Daemon](contracts/genesis/implementation/FlareDaemon.sol), a special system trigger contract.
- [Flare Inflation](contracts/inflation/implementation/Inflation.sol) tracking and [allocation](contracts/inflation/implementation/InflationAllocation.sol).
- [Supply accounting system](contracts/inflation/implementation/Supply.sol) of FLR tokens.

## Token contracts

Are used for wrapped native tokens ([WNAT](contracts/token/implementation/WNat.sol)) and [xAssets](contracts/token/implementation/VPToken.sol) minted on *Flare network*. These tokens expose delegate API and query votePower API. Vote power is checkpointed, meaning votePower for previous blocks can be queried.

## FTSO system

Enables price providers to supply USD prices for a list of assets. The FTSO determines the vote power (weight) of each address by calling vote power API on the token contract. Each asset price feed is handled by a separate FTSO contract. All FTSO contracts are managed by FTSO Manager contract. See further information for details [here](docs/specs/FTSOManagerAndRewardManagerCodeFlows.md).

## Reward contracts

Enable claiming of native token rewards.
Users will be eligible to claim tokens through the following methods:
- by supplying FTSO price feeds ([FTSO Reward manager](contract/tokenPools/implementation/FtsoRewardManager.sol)),
- Providing external chain data (data availability proofs)

## Inflation

Native token inflation will be distributed according to decisions made by governance. A large part of the inflation will flow to FTSO price providers who provide "good" price feeds. Inflation will be awarded per price epoch. Inflation will be minted on demand subject to preceeding approvals.

## Supply accounting

The supply accounting system monitors circulating native token supply. During the first period after launch, much of the native tokens will be locked in pools such as the incentive pool. Native token distribution is done in phases, and native tokens that have been earned are considered locked until they are distributed. The Supply keeps track of these amounts.

## xAsset

These contract(s) will handle both the process of minting and the redemption of assets, checking collateral levels and liquidating (auctioning) defaulting agents with lower collateral levels. Will be implemented in a separate repository.

## Distribution contracts

The air dropped native tokens will be distributed gradually through a dedicated contract(s).

## Getting started

1. Clone this repo.
2. Run `yarn`.
3. Compile the solidity code: `yarn c`.
4. Run basic tests `yarn testHH`.

## Testing

Note: be sure to compile (`yarn c`) after any solidity code changes or if starting a clean project as Typescript stubs need to be generated as part of the compilation.

Then one can run different types of tests.

- `yarn testHH` - all tests in hardhat environment (includes next three types of tests).
- `yarn test_unit_hh` - only unit tests in hardhat environment.
- `yarn test_performance_hh` - only performance tests in hardhat environment.
- `test_integration_hh` - only integration tests in hardhat environment.

Each of these calls can have additional parameters, namely paths to specific files with tests. Glob expressions can be used, but note that glob expressions are expanded in `bash` to a sequence of space separated paths. Keep in mind that glob expressions in bash containing `/**/` do not by default expand to all files, so one can switch on full expansion by setting `shopt -s globstar`, and if needed, later switch it off with `shopt -u globstar`.

Some parts of the code can only be tested against a "real" Flare block chain which adds some special features on top of the regular EVM. Any test below that has `HH` in the script name will run against an auto-launched hardhat chain. Some tests can only run against a Flare chain.
A few options exist for running a Flare chain, with the simplest one described above.

To check test coverage run `yarn cov`.

## Running with Flare local chain

For running tests against a local Flare chain.
- clone [Flare repository](https://gitlab.com/flarenetwork/flare)
- choose one of the following launch scripts:
   - `scdev1.sh` - Recommended; smart contract dev chain, 1 validator node.
   - `scdev.sh` - smart contract dev chain, 4 validator nodes.
   - others are less relevant.

## Deployment of smart contracts on `scdev` network

see [deployment](deployment/README.md)


