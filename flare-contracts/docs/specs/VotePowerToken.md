# Vote power token specification
#### Vote power and delegation on flare
Please see the online docs for a version which is better adopted for external users. in specific this [Delegtion details](https://docs.flare.network/en/tutorials/delegation/delegation-in-details).
## Background

The vote power token will be the base contract for [WNAT] (wrapped native token) and later for xAssets (wrapped assets) on flare.

This token contract is built to enable voting and delegation of vote power without locking the holder’s token. This works by adding the vote power and delegation functions to the token contract. Basically, balance represents vote power; with this code, a holder can delegate a percentage of his vote power to another address and still use their tokens freely. The transfer / mint / burn functions will immediately update the actual vote power being held by the delegator and the vote power of the address it delegates to.

This model will enable any token holder to delegate his vote power and continue using the token for any need, without locking it for votes.

All vote power data is being checkpointed by block. Meaning, for any vote power update due to delegate, transfer, or otherwise, a checkpoint is added. For anyone familiar with the [MiniMe token](https://github.com/Giveth/minime), the checkpoint mechanism is similar,  while being different since more data is being checkpointed.

When a voting campaign occurs, a past block will be randomly chosen and all vote power data will be taken from this block. This would actually work like taking a vote power snapshot for a specific block and using that for all addresses voting in the campaign. The random process of choosing a block is designed to mitigate attacks such as flash-loan or short term loans. 

This token will be named [VPToken] (vote power token).

## VPToken APIs

*   ERC20 APIs.
*   BalanceOfAt(address, block), totalSupplyAt(block)  as in minime token.
*   Delegation and vote power interaces are described in [IIVPToken] interface file.
*   Mint and burn APIs will be handled in the inheriting contracts. [WNAT] and later xAsset.

## Delegation

Delegation enables a user to keep holding their balance (tokens) while delegating the vote power this balance represents. Two delegation methods are supported. The basic (normal) delegation is **delegation by percentage**, the other being **explicit delegation**.

With percentage delegation, any address can delegate a percentage of its holding; this is limited to x addresses (3 as of now). Example: Alice has 20 tokens and delegates 50% to Bob, Bob will have additional vote power of 10 on top of his own balance (own vote power). This means any transfer of tokens to Alice will update 50% of the delegated vote power to Bob. If Alice delegates to two other addresses, each token transfer to Alice will update the vote power of those other 3 addresses. This in turn will cause higher gas costs for transfer functions. To cap those extra costs, this delegation option has a limited number of delegation destinations. In the case that an address (user or contract) wishes to delegate vote power to more than 3 other addresses, they have the option of the **explicit delegation method**.

With **explicit delegation**, an explicit amount of vote power is delegated. While useful, this does create more complications for the user since delegated vote power can’t be transferred. For example, if Alice has 20 tokens and explicitly delegates vote power of 20 to Bob, the delegated balance is actually locked. Alice can’t send out these tokens unless the 20 vote power is explicitly undelegated. Another complication here is that for each new token received, a new delegate operation has to be performed; vote power will not be automatically delegated upon token recieval. 

The explicit delegation method is mostly built for contracts holding a large number of tokens for different users. Imagine a collateral contract holding many wNat for many users. Each user depositing tokens might want to delegate to a different set of price providers. Explicit delegation will enable this contract to update the explicit delegation per user deposit and un delegate every time a user wishes to withdraw his funds.

Only one of the delegation methods can be used per address. Furthermore, an address can never change its delegation method. For example, if a user called delegate-explicit once from his address, he will never be able to do a percentage delegation with the same address.

The delegation system will support:
*   Delegation of vote power to several addresses
*   Several addresses delegating to a single address
*   1 level delegation. If Alice delegates to Bob and Bob delegates to Charlie, Charlie will only get the delegated balance of Bob, and will not be affected by the delegation Alice did.

Delegation units are the same as balance units.

### Check pointing historical data

Token data regarding vote power, delegation, balance and supply is all checkpointed to allow the reading of historical values. Per change in any value, a checkpoint is added which includes the updated value and a block number. When trying to read historical data, a binary search is performed on this array. With this, the data retrieval cost grows on a logarithmic scale.  

### Vote power data
The above delegation scheme creates a mapping from balance to vote power for each address. The vote power of each address reflects its own balance plus any delegated vote power from other addresses. Vote power should never be double-spended:  if vote power is delegated, the delegating address should not have this vote power under its own account.

### Voting campaigns using vote power token
Voting campaigns that don’t involve token locks should be able to use a vote power snapshot. For this, all vote power data is checkpointed when updated. Any voting campaign in flare will use a randomly chosen block number from the past. This means when any address casts its vote for a specific campaign, its vote power would be taken from a specific past block that was chosen for this campaign. The address vote power for this campaign will not reflect its present balance and delegation. This design allows for a usable (non-locked) token and a single voter power snapshot of token holdings. Voting campaigns are a generic concept; in flare oracle, (FTSO) price feeds will use the vote power data to choose the “correct price”. Meaning each price submission will be weighted according to the vote power scheme described here.

## Vote power caching and the revoke feature

Due to reward distribution constraints that will be described in the reward manager specification, the same vote power block will be used for a rather long period of time. This time frame will be named a “reward epoch” which will include many short price epochs. Meaning, FTSO price feeds commencing over a period of a few days will continuously derive vote power from the same vote power block in the past.

Usage of the same vote power block for many campaigns calls for a caching mechanism. The caching mechanism will cache vote power per address per block if done through a dedicated caching function. For example,the normal vote power query function is `votePowerOfAt(address, block)`. This will have a matching cache query: `votePowerOfAtCache(address, block)` which will also cache the data on its first usage for a specific address and block. Later calls to both of these functions will use the cached value if that exists.

### Revoke 

Due to the substantial length of time one past vote power block is used for price submissions, a revoke feature was added. This feature can be used in case any specific price provider is found trying to attack and skew the reported price of the FTSO (flare oracle). In this situation, we imagine an off chain process (e.g. twitter storm) calling users to revoke vote power from a specific price provider. The revoke will update the cached value of vote power for the specific block which is being used for this reward epoch. So if a user revokes his vote power on a specific block, checkpoints for vote power will not be updated, but rather only cached vote power values.


### Vote power delegation and rewarding delegators

A large part of the native token inflation will be distributed to participants in the FTSO price submission process. The reward will be shared between the price provider and the vote power delegators to the price provider (more on that in the FTSO and reward manager docs).  The VP token will expose APIs that will enable delegators to show how much vote power was delegated to a price provider in any past block. To allow this, the delegation percentage data will be checkpointed after every change. Using the combination of delegation percentage and historical balance, each user can accurately see and show how much vote power they delegated to any address in the past.

This API will later be used by the reward manager, when the reward sharing is calculated.

For explicit delegation, historical data will be limited. It would be quite costly to continuously update a list of independent explicit delegations. That being said, when rewards are claimed for addresses that used explicit delegation, the delegator must already know which data providers it delegated vote power to in the relevant block. 

To recap, historical delegation APIs exist. For percentage delegations, each address can determine the full list of addresses it delegated to in any block in history. For explicit delegations, a user must use their own methods to build the list of addresses it delegated to at what time. After building this list, one can query how much vote power was delegated to each address. Two options for building this list would be:
1. Saving this data in real time while delegating.
2. Reading past delegation events for this address.

## VP token architecture and risk mitigation
A token contract naturally holds a lot of user balance, thus requires good risk mitigations. For this the basic token contract that holds user balance and supports all ERC20 APIs was detached from the vote power token. This way, if the vote power implenentation ever has an issue / bug that blocks any normal token operations like transfer / withdraw etc, it can be disconnected from the base token contract. 

Since the vote power token is being used regularly by the FTSO, a switch over of vote power implementation has a read token address which is separate from write token address. A switch over between two vote power implementations will happen in two phases. We assume on start up read and write token addresses point to the same contract. meaning any vote power update is done to this token contract and any vote power data is being read from this token contract. 

#### Switch over in phases:
Phase 1 - the write token which is suspected of being buggy is disconnected. i.e. write token address in base token contract is set to 0. All read operations will continue to be performed from the disconnected write token. The vote power data in this token contract will actually be frozen, but the FTSO contract can continue to read this data.
Phase 2 - a new write token contract is implemented and connected to base vote power token contract. Users are asked to repeat any delegation operation since "old" delegations are all in the replaced contract.
Phase 3 - Read token address will be pointed to the new token contract. the new delegations will be reflected and also reflect the any current user balance.

## Checkpoints cleanup
Checkpoints create a lot of on-chain data. This data is required for a limited time frame and later expires. Clean up can serve two purposes:
 - reducing state size of the EVM
 - gas refunds

 Setting expired data block will be done from the FTSO reward manager, which actually is the main consumer for historical data.
 Cleanup of expired data will be done using two methods:
 - during normal operations (trasnfer, delegate) when new checkpoints are created, some expired checkpoints will be removed. note that this will create a gas refund and cause the transaction to be slightly cheaper gas wise.
 - An external clean up contract can be connected that will enable any user to "use" gas refunds as parts of his transaction. How the external clean up contract will be used is still not defined.

[WNAT]: ../../contracts/token/implementation/WNat.sol "WNat"
[VPToken]: ../../contracts/token/implementation/VPToken.sol "VPToken"
[IIVPToken]: ../../contracts/token/interface/IIVPToken.sol "IIVPToken"
