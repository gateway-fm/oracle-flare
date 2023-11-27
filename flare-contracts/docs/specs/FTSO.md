# FTSO specification
## High level background
On chain FTSO prices will be updated every few minutes. Any user (address) can provide prices (data) by reading prices from any chosen source and submitting them to a dedicated API on the FTSO contract. Any native token holder can participate by submitting prices or delegating their vote power to another address (price provider) that submits prices. Good price feeds will be rewarded with part of the native token inflation, in the form of native tokens on the network. An address must have some minimum vote power in order to submit prices.
## FTSO overview

The FTSO or ‘Flare Time Series Oracle’ is a service to gather price (and data) signals of off-chain assets for consumption by other smart contracts on the Flare blockchain. The system is designed to encourage native token holders to submit accurate prices to the FTSO contracts. Users will submit prices in epochs of a few minutes. For every price epoch, a weighted median algorithm will aggregate all price submissions to find the median price, which will become the current FTSO price. Good price submissions will be rewarded with newly minted native tokens (native token inflation).

Price submissions are considered good if they are within the interquartile range (within 25% of either side) of the submissions around the weighted median price. The rewards will be distributed between good submissions according to the relative weight (balance / vote power) of each address. It is advised to read the [VP Token] specification, for better understanding of vote power aspects.

An FTSO contract will be deployed for any new data signal supported by the Flare network, as determined by governance. The Flare Foundation currently plans to deploy contracts that will provide USD prices of NAT, XRP, LTC, XLM, DOGE, ADA, Algo, BCH, Digi and more to come.

More detail about the FTSO can be found here: [https://blog.flare.xyz/ftso-a-breakdown/](https://blog.flare.xyz/ftso-a-breakdown/)

# xAsset and the FTSO
An xAsset system (which is not yet implemented) will enable asset holders of integrated block chains to mint a wrapped version of the asset onto the Flare Network. For example: XRP, LTC, ADA and more. The wrapped asset will be minted against native token collateral. The FTSO is a crucial component that will enable this minting to occur backed by fairly priced collateral.

Any block chain integrated with flare will have a dedicated xAsset minting system connected to an FTSO feeding asset/$ price signals. The FTSO price signals will be used to maintain safe collateral ratios in the xAsset system. The price signals will also be open for usage by any on-chain consumer.
# Design aspects
## Price submission 
Price submission works in a commit and reveal scheme. The commit period is the price epoch period (every few minutes) immediately followed by the reveal period. More on this scheme can be found [here](https://en.wikipedia.org/wiki/Commitment_scheme). This scheme is designed to stop individuals from submitting prices based on other price proposals. Within the commit period, all submissions are secret. After the commit period passes, individuals will no longer be able to change their submissions. During the reveal period, individuals must mandatorily reveal their prices to be considered by the FTSO. At this point, changes can not be made, and prices become public record.  

Together with price data, any price provider must add a random number to their price submissions. This helps seed the source of randomness on the Flare chain for FTSO operations that require randomization. See below for further details on how this randomness is used.

## Price epochs - timings
The FTSO will operate in time constrained price epochs, each timed to be a few minutes. Price epoch time is not configurable, so if we want to go back n number of epochs, we know exactly which time stamp it will be. Any FTSO contract deployed on Flare will share the same start / end times for price epochs. In other words, commit and reveal timing will be the same across FTSO contracts.

## Weight (vote power) per price submission
Each xAsset (wrapped asset) will have a related FTSO contract which will supply asset/$ prices. Example: XRP/$, LTC/$ and so forth. Any price provider can submit prices to any FTSO contract. The submitted price will be weighted according to the vote power of the provider address.
Vote power per FTSO contract is divided between WNAT holders and the holders of the specific xAsset related to this FTSO. Example: For XRP/$, vote power is divided between WNAT and fXRP holders. Note that those two “sides” could be seen as having conflicting interests regarding the price. So when a price provider submits a price to the XRP/$ FTSO, the weight of his vote (price data) will be weighted by using his native token vote power and fXRP vote power. Note each provider address could potentially have WNAT vote power or xAsset vote power or both.

## Minimum turnout for creating a price
A minimum of x% of the total circulating native token (not wNAT) supply should participate in order to create a decentralized price result. More on total circulating supply data will be provided in the accounting specification. If minimum turnout for a specific price epoch is not achieved, a fall back mechanism will be used to create a price value.

## Participation thresholds, Min / Max vote power
To avoid spam submissions, addresses are required to have a minimum vote power in order to submit a price. Each address will have to hold 1/x of the total vote power for wNAT or xAsset. X is planned to be in the range of 50 to 500, and will be determined from live network runs. To avoid one address holding too much vote power, each address is capped to a max percentage of vote power. Any address holding above the max will be considered as having max vote power, meaning it would receive fewer rewards than its vote power would indicate for the price submission. Note that wNAT total supply is considered the total vote power available, meaning non-wrapped native token are not accounted for.

## xAsset vs wNAT weight
Since xAsset holders and wNAT holders could be seen as having conflicting interests regarding the price, the FTSO aims to provide each of those groups equal vote power. To avoid a situation where a few minted xAssets get too much vote power, the weighting between the two groups will have a linear scale correlated to the minted $ value of xAssets. For Example, if only 100K $ of fXRP are minted, the group of fXRP holders will get a 5% weight against wNAT holders. The 2nd factor by which the xAsset group will be weighted is the turnout ratio. In general terms, this means that if an xAsset has a high $ mint value and high turnout in a specific price epoch, the xAsset holders group will have a 50% weight when determining the asset price. 

Regarding xAsset vote power, note that each xAsset holder has vote power in a different FTSO. fXRP holders have vote power in XRP/$ FTSO fLTC holders have voting power in the LTC/$ FTSO etc.

Example: 100 million $ of fLTC are minted and turnout of fLTC holders for a price submission is 80%, the group of fLTC holders will receive 50% of vote power which will be divided equally between all fLTC vote power as reflected in the votes. The other 50% of weight will be divided equally between wNAT votes. Of course this example is very theoretical, in essence, the same provider address might have both wNAT and xAsset vote power. Calculating the weighting between wNAT and xAsset is done in two steps:
1. xAsset issuance value in $, will create the base xAsset weight.
2. xAsset voter turnout will factor the base weight to create a total weight for xAsset holders group.

#### Base xAsset weight

*   If minted_value_$ = low_xasset_threshold_dollars → 5% weight vs wNAT
*   If minted_value_$ >= high_xasset_threshold_dollars → 50% weight vs wNAT
*   Create a linear function from min to max. Where max weight should be 50%
#### xAsset turnout weighting
*   Xasset_high_turnout_threshold: when xAsset voters turnout is higher than this value, give this group its full potential weight as calculated in base xAsset weight.
#### Example:
high_xasset_threshold_dollars = $50M
low_xasset_threshold_dollars = $10M
Actual minted xAsset = $30M → base_xasset_weight = 27.5%
Xasset_high_turnout_threshold: 50%
Participating vote power: 40% → effect: ~80%
xAsset weight 27.5 * 80 / 100 = 22%
So 22 % is the weight of xAsset against wNAT in this vote.

Voters = holders who have voted

### Price granularity
A fixed number of 5 decimals is used to reflect the xAsset $ price
### Note

Once we know both total vote power for xAsset and for wNAT and the weight balance between wNAT and xAsset, we can define how to normalize vote power for one of the two. Thus actual vote power per address can only be calculated once the reveal period is finalised.

## Weights (vote power) for ‘NAT/$’ FTSO

When an FTSO is used for asset/$ calculations, ex: XRP/$, fXRP and wNAT holders will have the vote power to submit prices. However, determining weights for the FTSO that gives NAT/$ (native token/$) pricing is a little more involved. Because NAT/$ price affects collateral ratio calculations for all xAssets, every asset should have some say (be weighted) in the NAT/$ price calculation. In order to avoid unnecessary gas expenses, only a partial list of xAssets will be defined. That is to say, not every xAsset will have weight in all NAT/$ calculations. The list will include top minted xAssets with the highest aggregate minted values. The vote power calculation for each price submission will take into account any vote power derived from wNAT, and any vote power derived from xAssets on this list. Once this calculation is made, the FTSO code will adopt the calculated vote power values per address.

[![](https://mermaid.ink/img/eyJjb2RlIjoiZ3JhcGggTFJcbiAgICBBW1ZQIGRlbGVnYXRlZCBmcm9tIHVzZXJzXS0tPiBCW0NhbGN1bGF0ZWQgVlAgcGVyIGFkZHJlc3NdXG4gICAgQ1t3RkxSIGhlbGQgYnkgYWRkcmVzc10gLS0-IEJbQ2FsY3VsYXRlZCBWUCBwZXIgYWRkcmVzc11cbiAgICBEW1ZQIGZyb20gbGlzdGVkIGZBc3NldHNdLS0-IEJbQ2FsY3VsYXRlZCBWUCBwZXIgYWRkcmVzc11cbiAgICBCIC0tPiBFW1ZQIGFnZ3JlZ2F0ZSB1c2VkIGJ5IEZMUi8kIEZUU09dIiwibWVybWFpZCI6eyJ0aGVtZSI6ImRlZmF1bHQifSwidXBkYXRlRWRpdG9yIjpmYWxzZSwiYXV0b1N5bmMiOnRydWUsInVwZGF0ZURpYWdyYW0iOmZhbHNlfQ)](https://mermaid-js.github.io/mermaid-live-editor/edit/##eyJjb2RlIjoiZ3JhcGggTFJcbiAgICBBW1ZQIGRlbGVnYXRlZCBmcm9tIHVzZXJzXS0tPiBCW0NhbGN1bGF0ZWQgVlAgcGVyIGFkZHJlc3NdXG4gICAgQ1t3RkxSIGhlbGQgYnkgYWRkcmVzc10gLS0-IEJbQ2FsY3VsYXRlZCBWUCBwZXIgYWRkcmVzc11cbiAgICBEW1ZQIGZyb20gbGlzdGVkIGZBc3NldHNdLS0-IEJbQ2FsY3VsYXRlZCBWUCBwZXIgYWRkcmVzc11cbiAgICBCIC0tPiBFW1ZQIGFnZ3JlZ2F0ZSB1c2VkIGJ5IEZMUi8kRlRTT10iLCJtZXJtYWlkIjoie1xuICBcInRoZW1lXCI6IFwiZGVmYXVsdFwiXG59IiwidXBkYXRlRWRpdG9yIjpmYWxzZSwiYXV0b1N5bmMiOnRydWUsInVwZGF0ZURpYWdyYW0iOmZhbHNlfQ)

## Data transparency
The price data of each provider will be transparent. Therefore, any external contract can use any data from any provider. Mapping (address => mapping (uint256 => uint256)); /// dataProvider -> epoch → submission

## Randomness in FTSO
With each price submission, the data provider must also submit a random number which is used to compute the random number `R` associated with the FTSO for that submission/reveal period. The random number `R` is computed as the sum of the hashes of the pairs (random, price) `keccak256(abi.encode(random, price))` over all the revealed votes. At the end of the reveal period, the random number `R` for the particular FTSO and period is fixed. This random number `R` is used to determine which FTSO will receive the rewards and also, which price submissions that are on the edge of the bottom and top quartiles get rewarded.

### Choice of the FTSO for rewards
When finalizing a reward epoch, FtsoManager sums up the random values across all the FTSOs, adds the current block timestamp, hashes the result and reduces it modulo the number of submitting FTSOs to determine which FTSO is considered for the reward.

### Handling edge cases in price submission
In a collusion attack, where a majority (based on weight) of submitters agree on a price and submit that same price, the weighted median is determined by these submitters. In addition, if we reward all the submissions that have the same price as the already rewarded submissions that are strictly within the 25% of the median, all such submitters are automatically rewarded. This would create the incentive to just submit the same price as everyone else and participating in the collusion brings guaranteed reward. In addition, any deviation from the agreed upon price practically guarantees that such a submission would not be rewarded.

To prevent this collusion attack, we need to treat the edge price cases differently. An edge case is when a specific submission has exactly the price of the first or the third quartile. In the example below, the first quartile price is 2 and the third quartile price is 5, so the edge submissions are the second (2, 2), the third (2, 1) and the seventh (5, 5).
For each edge case, the current random number for the FTSO is hashed together with the submitter's address and the result is computed modulo 2. If the resulting number is odd (equals 1 modulo 2), the submission is rewarded, otherwise not.
Because of this randomization, the submitters have an incentive to not submit the same price: if everybody submits the same price, then every submission is treated as an edge case and it could happen that no one is rewarded. If everybody submits a different price and there are enough submissions (for example, more than 100), then on average, about 50% of the submissions will get rewarded as there should only be about 1-2% of the edge cases.

# FTSO Manager
[FTSO Manager] contract will have a single running instance in the system. As its name implies, it will manage many FTSO operations such as:

*   Adding a new FTSO to the system
*   Setting FTSO parameters. Note that most parameters are shared by all FTSO contracts
*   Trigger FTSO on certain events, such as reveal period ended (see more below)
*   Choose which FTSO should be rewarded per price epoch (See more below)
*   Update reward manager with list of “winning” addresses for a price epoch

### Finalizing a price epoch

By the end of the reveal period, a weighted median algorithm will analyze the submitted prices and choose a median price. Due to the design constraints defined above, the median calculation will be rather “heavy” or costly in EVM terms. Thus a special trigger from the validators will be used to run this calculation. Here, Flare benefits from having control over the block chain and being able to add extra mechanisms to support the smart contracts. More on this mechanism will be defined in the Flare Daemon document. 

The weighted median code will iterate all submitted prices, find the weighted median, and set it as the current price. 
### Triggering Finalization

As described above, a dedicated trigger executed by the [Flare Daemon] will activate the price finalization code. It is not user triggered, and thus it differs from classic smart contract design patterns. The trigger is initiated by the validator, enters into [Flare Daemon], and is dispatched to the [FTSO Manager] contract. [Ftso Manager] will calculate the weighted median and for one FTSO, sending a list of eligible address to the [FTSO Reward Manager], which handles the [rewarding] process.

### FTSO manager redeploy

If there is a need to redeploy FTSO manager, also all FTSO contracts must be redeployed. In order to keep the same FTSO indices they are replaced in FTSO registry, but they should not be added to VoterWhitelister again as it would revert.

## Price submitter contract
FTSO price submission might create a lot of on-chain traffic. To reduce traffic, a [price submitter contract] will enable a price provider to submit all prices in one batch. This contract will receive a list of destination address and submission data and send it over to the target contracts. 

### Example: weighted median and rewarding
Assume below submissions with notation: (price, votePower).
(1, 2), (2, 2), (2, 1), (3, 2), (3, 2), (4, 1), (5, 5) \
Total power: 15
Median is 3 and falls in 5th submission.

Example reward flow (this assumes that all the edge cases are selected, i.e. for all the submissions whose price is exactly equal to the first or the third quartile, see
[FTSOMedian] for details about how the submissions on the edges are selected):
*   4th submission (same price) 
*   So far rewarded 4 out of 15. Needs to reward 3.5 more of the vote power to add up to 7.5.
*   Reward adjacent submissions, 6th and 3rd.
*   Since the 2nd submission is the same price as the 3rd, reward it as well.
*   Result is total reward for 8 voter power out of 15 which is bigger then 50%
*   Note each voter with the same price data should have the same relative reward, no matter what the internal ordering of list items is.

In this particular case, the last point above means we will give rewards to 50% of submitted weight or more if required.

[FTSO Reward Manager]: ../../contracts/tokenPools/implementation/FtsoRewardManager.sol "FTSO Reward Manager"
[FTSO contract]: ../../contracts/ftso/implementation/Ftso.sol "FTSO"
[FTSO Manager]: ../../contracts/ftso/implementation/FtsoManager.sol "FTSO Manager"
[Flare Daemon]: ./flareDaemon.md "flare daemon"
[rewarding]: ./FTSORewardManager.md "rewarding"
[price submitter contract]: ../../contracts/genesis/implementation/PriceSubmitter.sol "price submitter contract"
[FTSOMedian]: ./FTSOMedian.md "Formal definition of median price and rewarded votes"
