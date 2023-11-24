

# FTSO rewards and Flare inflation

## Background

The native token token will launch with planned time slot inflation of 10%. A large part of that inflation will be awarded to native token holders providing “Good” price feeds to the FTSO (Flare Time Series Oracle). Native token holders can participate by either providing prices themselves or by delegating vote power to other price providers. Per price epoch, all good price provider addresses from a single FTSO are awarded a portion of that inflation. The reward system will enable any holder that delegated his vote power to a “good” price provider to claim part of the rewards this provider earned. Each delegator's share of the rewards will be proportional to the vote power they delegated to a winning price provider.

## Handling Inflation 

Inflation will be handled in two separate flows: one involves rewarding inflation amounts, and the other minting native token when those rewards are claimed. 

*   The FTSO Reward manager will allocate portions of the inflation to “good” price providers per price epoch. Each price epoch, the allocated portions will be divided between winning addresses and added to each address account in the reward contract. This process can be seen as time driven - or price epoch driven.
*   Another system will handle minting new tokens. This process is claim driven; i.e., many native token can be awarded to different addresses, but if no claim is done, minting will not occur. Once claims are done, new minting will occur with time locks in place to address possible risks of holding large native token balances to facilitated the claim process.

The above flow is detailed in the [inflation] documentation.

## Reward epochs

Price epochs are rather rapid, and rewarding involves many addresses. That being said, a mass claiming of rewards per price epoch (every few minutes) will create a huge amount of claim transactions. This in turn could create extra burden for users and the chain itself. For this reason, **rewards epochs** that span a few days are defined. All price epochs inside a reward epoch will be combined and claimed in a single claim operation.

The aggregation will be done by using the same vote power block for all price epochs inside a reward epoch.

Because reward epoch length may change, it is advised to use API `getCurrentRewardEpoch` from [Ftso Manager](../../contracts/Ftso/implementation/FtsoManager.sol) contract for fetching the current reward epoch index. For fetching start and end timestamps of the current reward epoch it is advised to use APIs `rewardEpochs(currentRewardEpochId)` and `currentRewardEpochEnds` (from [Ftso Manager](../../contracts/Ftso/implementation/FtsoManager.sol) contract) respectively.

# Rewarding
The FTSO rewarding process is implemented in the [Ftso Reward Manager] contract.

### Distributing rewards per price epoch

At the end of the price reveal period, the FTSO manager will loop all FTSOs and trigger the finalization process. One of those FTSOs will be asked to return a list of winning addresses and the native token vote power of those addresses. These addresses will be rewarded proportional to the native token weight (vote power) they had for this epoch.

## Reward sharing

Each price provider will define a fee percentage for its delegators; if a price provider doesn’t, a default fee percentage will be used. Say a price provider defines a 20% fee percentage, and assume a user delegated vote power of 100 to this price provider. If vote power is entitled to receive 10 reward units. Because of the fee percentage, the price provider will get 2 of those reward units and the delegator will get the other 8. Per reward epoch, the reward manager will enable the price provider to claim the reward value that reflects its own vote power and the fee percentage it defines. Consider the following data for a specific epoch:

*   Price provider balance: 1000 (1:1 correlation to vote power)
*   Price provider vote power: 20000
    * 1000 vote power stems from its own balance
    * 19000 vote power delegated to it
*   Provider rewards for this epoch: 1000
*   fee percentage 20%.

From the above, 20000 vote power are entitled for 1000 reward units thus each vote power unit is entitled to 0.05 reward units.

The price provider is entitled to 0.05 * 1000, which is 50 reward units for its own balance of 1000. The rest of the reward (950 units) should be split between delegators and the provider. Out of 950 units, the provider takes 20% and the rest is split between all delegators according to the vote power they delegated to this provider in this epoch.

## Updating fee percentage by the price provider

From a delegator’s perspective, two factors can be used to predict its APY when delegating to a price provider: their past performance and their fee percentage. To enable delegates to make smart decisions, any fee percentage updates will have some time lock constraints. Meaning, when a price provider updates its fee percentage, it will only take effect in a future reward epoch.


## Reward expiration

When distributing rewards, the Flare daemon will accredit each address balance automatically, so users will only have to call the claim function every once in a while. Unclaimed rewards will have an expiration time, set in the reward manager.

[inflation]: ./Inflation.md "Inflation"
[Ftso Reward Manager]: ../../contracts/tokenPools/implementation/FtsoRewardManager.sol "Ftso Reward Manager"