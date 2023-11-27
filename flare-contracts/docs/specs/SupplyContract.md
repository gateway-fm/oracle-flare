# Native token supply contract

## Background
The Supply Contract has two major roles:
- Track inflatable supply
- Track circulating supply

To accomplish this, the contract has to collect data from other contracts.

## Definitions

### Inflatable supply:
The total supply of native tokens that is used to compute recognized inflation for a time slot. Inflatable supply will be initialized with the genesis amount of 100 billion native tokens (Flare) or 15 billion (Songbird). Inflatable supply will then be defined as:

>`genesis amount of native token + total claimed tokens - undistributed excluded supply - total locked tokens`

Excluded supply includes funds in distribution treasury and funds in team escrow (foundation funds on Songbird). Undistributed excluded supply is defined as

>`total excluded supply - total excluded distributed supply`


### Token pool:
A few types of token pools exist:
1. Pools topped up by inflation and utilized for rewarding on chain activities. Ex: providing prices to the FTSO system.
1. pre allocated tokens that will be used to incentivize holding xAssets.
1. Air drop tokens that will be distributed gradually after mainnet launch.
Each token pool is also a service that allocates these tokens for later claiming by eligible addresses. The undistributed token pool supply for a service is defined as:

>`locked funds + total inflation authorized - distributed total for a service`


### Circulating supply
The total amount of native tokens in general circulation. Circulating supply is defined as:

>`inflatable supply - burned native tokens`


## APIs
- Register token pool contracts
- Report foundation tokens added to supply (example: vested tokens)
- Daily update trigger


## Init
- set governance address
- set inflation address
- set a single number for initial genesis amount (100 or 15 billion)
- set total excluded supply
- set known token pools

## Register token pools
The supply contract contains a method called `addTokenPool` that identifies a token pool contract. This contract must implement the function `getTokenPoolSupplyData()` (returns locked funds, total inflation authorized and total distributed amount) through the interface IITokenPool.

## Report excluded tokens added to supply
If the foundation ever adds any tokens to supply - like releasing vested tokens not through a contract (not through a pool). Report with this API: `decreaseDistributedSupply`.

## Daily checkup (called from inflation contract)
- Call all relevant contracts.
- Update total inflation authorized.
- Add to the circulating supply.
- Read burned tokens from the burn address and update values.

## Governance updates
- Register a new token pool. Token pool is deployed and the balance is updated. Done through API call: `addTokenPool`
    - Set token pool address
    - Set the balance to be reduced from excluded supply.
- Foundation reports some tokens were unlocked (team members tokens were released, for example). Done through the API call: `decreaseDistributedSupply`
