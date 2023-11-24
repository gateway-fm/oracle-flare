# Songbird change log

## Inflation updates - September 2023
### Background: [STP.05 | Flare Governance Proposals](https://proposals.flare.network/STP/STP_5.html)

#### Upgraded contract: **Inflation**
Functionality is aligned with Flare network:
  * 30 days time slots.
  * Inflatable balance is calculated only from all claimed and not from all recognized inflation.
  * Inflation cap is added.
Additionally, inflation logic was updated to apply across all time slots, instead of separately per time slot. With this change, unclaimed rewards from previous time slots accrue and no rewards become inaccessible.

#### Upgraded contract: **InflationAllocation**
Functionality is not modified, but the code is aligned with the one on the Flare network (up to the renaming of "annum" into "time slot").

#### Upgraded contract: **Supply**
The upgrade adds support for updating circulating supply on a daily basis by monitoring two burn addresses and Flare Foundation addresses.


## Update FTSO price pairs - June 2023
### Background: [STP.04 | Flare Governance Proposals](https://proposals.flare.network/STP/STP_4.html)

Price pairs provided by the FTSO system were updated:
  *  `BCH` and `DGB` were removed.
  *  `ARB`, `AVAX`, `BNB`, `MATIC`, `SOL`, `USDC`, `USDT` and `XDC` were added.

The list of supported price pairs is: `ADA`, `ALGO`, `ARB`, `AVAX`, `BNB`, `BTC`, `DOGE`, `ETH`, `FIL`, `LTC`, `MATIC`, `SGB`, `SOL`, `USDC`, `USDT`, `XDC`, `XLM` and `XRP`.

## Align Songbird contracts - April 2023
### Background: [SIP.01 | Flare Governance Proposals](https://proposals.flare.network/SIP/SIP_1.html)

#### Upgraded contract: **FtsoRewardManager**
The upgrade adds support for claim-and-wrap and autoclaim.
The change also burns expired rewards instead of redistributing them in the following epochs.

#### Upgraded contract: **CleanupBlockNumberManager**
Functionality is not modified, but the code is aligned with the one on the Flare network.

#### New contract: **ClaimSetupManager**
This contract is part of the autoclaiming setup.
Enables public executors to register themselves. Enables token holders to define claim executors and claim recipients. See [the flare documentation](https://docs.flare.network/user/personal-delegation-account/) for more details.

#### New contract: **DelegationAccount**
Enables a user to set a personal delegation account. See [the flare documentation](https://docs.flare.network/user/personal-delegation-account/) for more details.

## FTSO polling - March 2023
### Background: [STP.03 | Flare Governance Proposals](https://proposals.flare.network/STP/STP_3.html)

#### Upgraded contract: **VoterWhitelister**
The upgraded contract now has governance APIs to enable chilling of FTSO providers and to view chilling data.
 - A chilled data provider cannot be whitelisted or submit prices.
 - The data provider can whitelist itself again after the chill period is over.
 - There is one new method `chilledUntilRewardEpoch(address)` that can be used to check when chill periods are over for a specific address.

#### New contract: **PollingFtso**
The voting contract for the FTSO management group. Each member of the group can submit a chilling proposal and vote on active chilling proposals. See more in STP.03.
