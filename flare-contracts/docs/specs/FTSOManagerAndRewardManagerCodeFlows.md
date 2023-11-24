
# Introduction

[FTSO manager] contract manages the following aspects of the FTSO system.

- Maintains the list of rewarded FTSOs.
- Is being triggered by the Daemon contract.
- Accepts calls from governance contract to update the FTSO list
- Accepts calls from governance contract to change FTSO governance parameters,
- Sets FTSO governance parameters to FTSOs at appropriate time;
- Sets vote power blocks to FTSOs at appropriate times;
- Manages the definition and life cycle of reward epochs, including initialization, finalizations and the definitions of vote power blocks.
- Manages the definition and life cycle of price epochs, which include:
   - initialize price epoch data structures at beginning of each price epoch
   - FTSO finalizations
   - determination of reward eligibility
   - triggering reward distribution in Reward manager

[FTSO Reward manager] contract manages the following aspects of FTSO system.

- Maintains the reward balances of data providers.
- Enables data providers to be able to claim the rewards (transfer them to their accounts).
- enables delegators to data providers to claim thier respective part of data provider rewards
- enables data providers to define fee percentage to take from vote power delegated to them.

**Reward period** is an interval on block numbers defined by *start block number* and ending just before the start block of the next reward period. Each reward period is initialized by defining its start block number and the randomly chosen *vote power block* from the previous reward period. Records of the sequence of pairs `(startBlock, votePowerBlock)` are maintained in a list on the FTSO manager contract. The first reward period is initialized separately and typically `startBlock == votePowerBlock`. Duration of the reward period is defined by a parameter `rewardEpochDurationSeconds` on the FTSO manager contract. First epoch starts at `rewardEpochsStartTs`. Immediately after the reward period expires, daemon contract triggers reward epoch finalization on FTSO contract, which initializes next reward epoch (`currentRewardEpoch`) and chooses a new `votePowerBlock` from the past. Vote power block is used to determine weights (vote power) per address, then used in the weighted median calculation. Reward epochs are finalized based on times in `block.timestamp` but are defined in block numbers.

**Price period** is a time interval in which prices to oracles are submitted as hashes of price and random number. Duration of the price period is defined by the parameter `priceEpochDurationSeconds` on the [FTSO manager contract]. Count of price periods starts at timestamp `firstPriceEpochStartTs`. Each price period has a unique id, which is its position in the sequence of price periods starting from `firstPriceEpochStartTs`, where id of the first price period is 0. At the start of the next price period, the last one is finalized and the new epoch is started. The finalization of the price period is triggered on all awarded FTSO contracts by the FTSO manager (which in turn is triggered by the Daemon contract). Finalization calculates weighted median prices of all rewarded FTSOs. In addition FTSO manager randomly chooses the single rewarded FTSO for the finalized price epoch and obtains rewarded data provider addresses (and weights). Those are passed to the Reward manager contract through `distributeRewards` to actually trigger distribution of the rewards. Results of a price period for each FTSO are stored on corresponding FTSO contracts. Each particular price epoch instance object holds a result of price epoch finalization for the corresponding price epoch id. The price epoch instance for an epoch is initialized at the beginning of the price epoch, that is during finalization of the previous price epoch. The duration of the price periods is usually much shorter than the duration of reward periods. 

**Reveal period** is an interval on blocks that starts immediately after the corresponding price period, hence at the same time as the next price period. Reveal period has its own id which matches the just expired price period's id. In the reveal period the prices are revealed matching the hashes of prices committed in the corresponding (just expired) price period. Each price revealed by a data provider is added to the linked list of price votes. On reveal, vote power of a data provider in regard to the vote power block of the current reward epoch is calculated and stored into the Vote structure. Vote structures are maintained in the linked list, while pointers to the first and last Vote are maintained in the price epoch instance object. The duration of the reveal period is usually much shorter than the duration of the price period. Reveal periods are contained in price periods, where the start of a reveal period matches the start of the next price period.

# Initialization sequence
note: note fully updated.
See [deployment script](../../scripts/deploy-app.ts) for more details

- `Daemon` contract is already deployed on the blockchain.
- First, `FTSORewardManager` is deployed.
- Then `FtsoManager` contract is deployed, initialized by the address fo the `FTSORewardManager` contract in the constructor.
- Then API `setFTSOManager(ftsoManagerAddress)` is called to fully link `FTSOManager` contract with `FTSORewardManager` contract.
- Then the reward manager is activated.
- Then, before adding any FTSO, governance must at least once initialize governance parameters for FTSOs by calling API `setGovernanceParameters(...)`.
- Typically then FTSO contracts are deployed and Asset can be added to single asset FTSO by calling `setFtsoAsset(xAsset)` or a list of FTSOs can be added to multi asset FTSO by calling `setFtsoAssetFtsos(xAssetFtsos)`.
- Then FTSO contracts are added to `FTSOManager` contract by calling API `addFtso(ftso)`.
- Then everything is ready to activate `FTSOManager` contract by calling API `activate()`. This starts applying triggering to `FTSOManager` contract by `Daemon` contract.
- Later new FTSO contracts can be deployed and added to `FTSOManager` contract. Some can be also removed by calling API `removeFtso(ftso)`)

# Operations

[FTSO manager] contract can be deactivated by calling API `deactivate()`. This stops periodic reward epochs finalizations, price epoch finalizations and initializations of price epoch instance objects. WARNING: the mechanism of how the system behaves after that is not yet fully defined.

`FTSORewardManager` contract can also be deactivated, which basically means that claiming awards is blocked. It is again possible, when the contract is activated (`activate()`). Deactivated `FTSORewardManager` contract still accepts calls to `distributeRewards(...)` API and distributes the rewards. 

[FTSO manager]: ../../contracts/ftso/implementation/FTSOManager.sol "FTSO Manager"
[FTSO Reward manager]: ../../contracts/ftso/implementation/FTSORewarwdManager.sol "FTSO Reward Manager"
