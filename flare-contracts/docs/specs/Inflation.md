# Flare Inflation Subsystem

## Introduction

The Flare Network inflation subsystem contains a series of components that orchestrate establishment, recognition, authorization, minting, funding and finally awarding of inflation rewards for certain services performed by participants of the network. An example of one service that is rewarded through inflation is the providing of prices or delegating of vote power to price providers for the Flare Time Series Oracle (Ftso) system. Note that not all services are funded by inflation.

## Definitions

### Establishment

Establishment consists of two activities:

1. Establishing the native token time slot inflation percent.
2. Establishing inflation sharing percentage for services that are rewardable on the Flare Network via inflation. Native token time slot inflation will be shared between different services according to governance decisions.

All percentages are settable at any point by governance directive, but will come into effect at different points in time as described below.

### Recognition

Recognition is a point in time, on a time slot basis, where inflation rewards are recognized to be authorized over the coming time slot for any service rewardable via inflation. Inflation recognized on the Flare Network for a given time slot is computed by:

`(Inflatable supply * native token time slot inflation percent) / 100`

A change in time slot inflation percentage can occur at any point during the time slot but will only apply to the next (and subsequent) time slot recognition events.

Recognized inflation shall be kept for each time slot, and a total recognized inflation shall kept for all time slots, such that:

`Total recognized inflation += time slot recognized inflation`

### Authorization

Authorization is a daily point in time where a portion (one day’s worth) of recognized inflation is authorized to become awardable and thus mintable, not necessarily minted, from the pool of recognized inflation remaining. Authorization will be done in advance, on a daily basis. Authorized inflation is shared between one or more services via a sharing percentage. All sharing percentages must total to 100 percent. Daily authorized inflation for a service is then defined as:

`(Total recognized inflation - total inflation authorized) * (inflation sharing percentage for a service / 100) / number of periods remaining in current time slot`

Number of periods remaining in the current time slot will be computed as the number of days remaining at the time the authorization cycle is executed, inclusive of the current day.

Totals for inflation authorized shall be kept as follows:

`Total inflation authorized for a service within a time slot += daily authorized inflation for a service`

`Total inflation authorized = sum of all authorized inflation for services for all time slots`

Daily inflation authorized for all services will be reported each day to a supply contract for accumulation within the inflatable supply. Specification for the supply contract will be documented separately.

Note that total inflation authorized should never exceed total inflation recognized.

Updates to service sharing percentages can be made at any time, and will be applied at the next day’s authorization event.

### Minting

Minting is a daily point in time of requesting a “top-up” amount of inflation rewards in the form of native token. The validator will mint the requested rewards, resulting in new native tokens appearing on-chain. Not all authorized inflation is minted at the point of authorization, for safety reasons. There can be a significant lag between earning of awards and claiming of awards, based on how an individual service operates and the behavior of individual claimants. The inflation process by design attempts to limit attack exposure of large native token balances in any given governed contract by using formulas to keep reasonable reserves of native token available for claiming. These formulas are used to arrive at a daily "top-up" amount for each service.

Note that this limitation might result in too little reserve native tokens being available in a rewarding contract at certain points in time to satisfy all claim requests. However, the design is flexible such that governance can change the top-up formulas to strike the right balance of minimizing claim reverts due to insufficient native tokens and not keeping too many native tokens on-chain. But in any event, insufficient native tokens for claiming does not change the liability of the native tokens owed to a claimant. All claimants claims will eventually be satisfied.

The daily minting request is defined as the sum of all top-ups for each service for the day.

A top-up for a service can be calculated by one of two selectable algorithms:

1. By top-up factor (scaled by 100) of daily authorized inflation.

    The daily inflation top-up for a service is then defined as:

    `(Last daily authorized inflation for a service * top-up factor / 100) - service reward contract balance`

    Top up factor must be bigger than 100.

2. By inflation authorized.

    The daily inflation top-up for a service is then defined as:

    `Total inflation authorized for a service - total top-up requested for a service`

Totals for the service shall be kept as follows:

`Total top-up requested for a service += daily inflation topup for a service`

Total top-up requested for a service should never exceed total inflation authorized for a service.

### Funding

Funding is a daily point in time, subsequent to minting, of the transfer of minted native tokens to the target rewarding contract. The funding amount for each service should match the daily inflation top-up calculated that day for each service.

Totals for each rewarding service shall track native tokens received as follows:

`Total inflation received for a service += daily amount funded`

### Awarding

Awarding is the act of a rewarding contract allocating a reward to a recipient. Awards are not native tokens, but are pending claims against the network in the form of native tokens. Awards are typically computed in time slices called epochs. A further description of this process for Ftso rewards is defined in [FTSORewardManager.md]

For each service award, the amount awardable for a given epoch is:

`(Total authorized inflation for the service - total distributed inflation by rewarding service) / number of epochs remaining in current day`

Daily authorized inflation will be set upon each rewarding service at authorization time. It is up to the rewarding service to accumulate authorized inflation, distributed inflation and track the starting timestamp of the setting event, in order to calculate epochs remaining for a day.

## Implementation

### Establishment and Governance

Time slot inflation percentage and service sharing percentages are pre-determined by governance of the Flare Network and become part of Flare governing parameters. These percentages are maintained via the [InflationAllocation] contract. Consuming contracts access those values through providers, which form a separating abstraction between the governance process and consumers of governing parameters. [IIInflationAllocation] provides the interface through which the inflation process will obtain the time slot inflation percentage and it also provides the interface consumers can use to obtain the sharing percentages for each service.

Time slot inflation percentages can be set up to be yielded on a time slot schedule via [InflationAllocation]. The time slot schedule can be predefined as a list of percentages (in bips per annum) that can yield a different inflation percentage for each future time slot, on a declining basis - meaning that next time slot's inflation percentage must be less than or equal to the current time slot's percentage. The schedule can be replaced be governance at any time. When replaced, the next percentage yielded will apply to the next time slot recognition event (as described below). The maximum time slot inflation percentage is thus limited to the initial time slot inflation percentage. Further, this also implies that once inflation is recognized for a time slot, it cannot be adjusted.

One or more inflation sharing percentages can be associated with inflation receiver contracts. This enables inflation rewards to be sharable between different types of services performed. This list of inflation sharing percentages/inflation receiver contracts can be updated by governance at any time. At the next time slot inflation recognition event, the current list of sharing percentages are used to recognize the portion of inflation that will be authorized for that new time slot. The sharing percentages (in bips) must always total 100%.

### Recognition

[![](https://mermaid.ink/img/pako:eNp9U01vwjAM_StRTpsEfyAHDggmcdiExLRTLyYxnbV8dKnLBIj_vqQdbTcYvrR57-XFdpyT1MGgVLLGzwa9xgVBGcEVXqSAhoNv3BZjt64gMmmqwLN4A0sGONygnixEXAC64K_Jld9ZYLpJrXpyjVGjZyhxHcOezK0MNk1V2cOdE17JYW0D153GhlCJ5R7jQWxt0B8dmqOvZTqdjZJXgiOVJcaHx0ELmmkPjNdV5hiByavPRAnTYnTEX16WRUQdSk9ZJbBNjn_SHnQ5eq9ke69PSpTIl8oHek5VPT76j2XXy3Zvh8LW4hwspJG4s-261YpyLamfR3zBrws8tkBvhoXB__uZhPkjJ9JhdEAmjekpU4Xkd3RYSJV-De6gsVzIwp-TNI_s5uC1VBwbnMimShd7mWqpdmDrHl0aSnfeg9gun7v30D6L8zdG_w5G?type=png)](https://mermaid-js.github.io/mermaid-live-editor/edit#pako:eNp9U01vwjAM_StRTpsEfyAHDggmcdiExLRTLyYxnbV8dKnLBIj_vqQdbTcYvrR57-XFdpyT1MGgVLLGzwa9xgVBGcEVXqSAhoNv3BZjt64gMmmqwLN4A0sGONygnixEXAC64K_Jld9ZYLpJrXpyjVGjZyhxHcOezK0MNk1V2cOdE17JYW0D153GhlCJ5R7jQWxt0B8dmqOvZTqdjZJXgiOVJcaHx0ELmmkPjNdV5hiByavPRAnTYnTEX16WRUQdSk9ZJbBNjn_SHnQ5eq9ke69PSpTIl8oHek5VPT76j2XXy3Zvh8LW4hwspJG4s-261YpyLamfR3zBrws8tkBvhoXB__uZhPkjJ9JhdEAmjekpU4Xkd3RYSJV-De6gsVzIwp-TNI_s5uC1VBwbnMimShd7mWqpdmDrHl0aSnfeg9gun7v30D6L8zdG_w5G)

After percentage ratification through governance, the process begins in [Inflation] with recognition of a time slot inflation amount for a new time slot. This is determined when the current `block.timestamp` exceeds the `endTimeStamp` of the current time slot (or after a constructor provided timestamp `_rewardEpochStartTs` if it is the first time slot). The amount to recognize is derived from the time slot inflation percentage, obtained from the percentage provider (as described above), and the inflatable balance, obtained from [Supply].

Administration of inflation time slots are performed by the [InflationTimeSlots] library. [InflationTimeSlots] holds a collection of each InflationTimeSlot, a pointer to the current time slot, and grand totals for each of the steps in the inflation process as described above. Inflation recognition is performed within the `initializeNewTimeSlot` method of [InflationTimeSlots]. A new time slot is added to the collection, the current time slot pointer is reset, and the recognized inflation amount is calculated for the new time slot. Finally, totals across all time slots are maintained. `initializeNewTimeSlot` is triggered automatically by the [FlareDaemon] contract, via the `trigger()` method, which calls the `daemonize()` method within [Inflation], at the end of every block by the validators. `Inflation.daemonize()` determines whether it is time to recognize a new time slot.

### Authorization

[![](https://mermaid.ink/img/pako:eNq1VM1qwzAMfhXj0wbtC_gwGLSDHgalhZ1yUW0lFXPszHE60tJ3n5NQJ2nash2miyPp86efWDpxaRVywUv8qtBIXBBkDvLEsCBQeWuqfIeu0wtwniQVYDz7AE0KvL3hetPgcAGYWzN1rkyqwdNN1yo6t3twZLI1OonGQ4ZrZw-kbiUS72zwG5zaojuQxPIh_QYl0uHCpq0t2DKoNdtpKz87ayOxyPn8ZVCVYN5RlqF7eu6xID0dwOO0_EYGxsAVExFMtTY64ohL-6b5e-vo2OIYtukpqHtQI5EocP6ie4Jl6Cfechj6mvV2d0VMLxRFuo6wu1Tj-w-Ipc2LKrRRNbx9GMVo_HIuMvh75XVlY-R_5cNS61jZXfhLxOl7FIHGtw19jXHuthaN6g0jReH9xxiAzcFnPEeXA6kw_KfGlXC_xxwTLsKnwhQq7ROemHOANotgWxvJhXcVznhVhKm47AouUtBltC4VhYGJRmzV927LtMvm_AOd4oSj)](https://mermaid-js.github.io/mermaid-live-editor/edit/#pako:eNq1VM1qwzAMfhXj0wbtC_gwGLSDHgalhZ1yUW0lFXPszHE60tJ3n5NQJ2nash2miyPp86efWDpxaRVywUv8qtBIXBBkDvLEsCBQeWuqfIeu0wtwniQVYDz7AE0KvL3hetPgcAGYWzN1rkyqwdNN1yo6t3twZLI1OonGQ4ZrZw-kbiUS72zwG5zaojuQxPIh_QYl0uHCpq0t2DKoNdtpKz87ayOxyPn8ZVCVYN5RlqF7eu6xID0dwOO0_EYGxsAVExFMtTY64ohL-6b5e-vo2OIYtukpqHtQI5EocP6ie4Jl6Cfechj6mvV2d0VMLxRFuo6wu1Tj-w-Ipc2LKrRRNbx9GMVo_HIuMvh75XVlY-R_5cNS61jZXfhLxOl7FIHGtw19jXHuthaN6g0jReH9xxiAzcFnPEeXA6kw_KfGlXC_xxwTLsKnwhQq7ROemHOANotgWxvJhXcVznhVhKm47AouUtBltC4VhYGJRmzV927LtMvm_AOd4oSj)

Once time slot inflation is recognized for a time slot, inflation must be authorized to become awardable and ultimately mintable for a given reward service. Authorization is performed in advance, over the passage of time, at daily intervals, via the Flare daemonize process (as described above). Daily inflation is authorized by [Inflation] by calling `authorizeDailyInflation` on [InflationRewardServices]. In order to allocate daily inflation over services that share inflation, the sharing percentages must be obtained from the provider as described in the Governance and Establishment section.

[InflationRewardServices] manage a collection of RewardService, each of which contain a reference to a rewarding contract defined through the [IIInflationReceiver] interface and associated accumulated totals for a given time slot. `authorizeDailyInflation` on [InflationRewardServices] will take in the necessary inputs to authorize the daily inflation for the day's cycle, disburse the authorized daily inflation across the reward services according to the inflation sharing percentages, and maintain the total authorized inflation for the time slot. Finally, it will set the daily authorized inflation on each rewarding contract. It is then the rewarding contracts' job to allocate that inflation across award epochs throughout the day.

### Minting
[![](https://mermaid.ink/img/pako:eNqNVM1SwjAQfpVMTjoDL9ADF8EZZ_QCjqdelmRbo21StxsUGd7dtIXSQGHcS5v9-779SXZSOY0ykTV-ebQK5wZygjK1Igh4dtaXa6TuXAGxUaYCy-INCqOB3YjpsQDCOWDp7KXxyWYFsLlpWuI3kF4hbYzCunMsnKvEYoO0FevCqc9O20jPZDqdDaATwWTyHOnu_uQLis0GGC85NjJQhlw9nUToVmd-McpVsChN4I0tKw3bk62RPn6QKq4sEcqVlWd8dZWvls0Iah5CnBVOw-jYKwKMUaJKcuQW7MHZzOSeWvU55P-SXalFcJM_cG2rEZkjUY8xRquv9isa4yHTS2i1sfk51-HMZv0qJN1kDqFxxGlfYhzl7IensBrPy1OAxrGVOVrTwfJgUaOw-MPdfgrIGKmlcYPwYDKECs0GR8rsOxV-mo-cyBKpBKPDxd01plTyO5aYyiT8aszAF5zK1O6Da3OJV1urZMLkcSJ9FYo_3nOZZBB4H7ULbUJfeiW2x5fuhWgfiv0fp75eMg?type=png)](https://mermaid-js.github.io/mermaid-live-editor/edit#pako:eNqNVM1SwjAQfpVMTjoDL9ADF8EZZ_QCjqdelmRbo21StxsUGd7dtIXSQGHcS5v9-779SXZSOY0ykTV-ebQK5wZygjK1Igh4dtaXa6TuXAGxUaYCy-INCqOB3YjpsQDCOWDp7KXxyWYFsLlpWuI3kF4hbYzCunMsnKvEYoO0FevCqc9O20jPZDqdDaATwWTyHOnu_uQLis0GGC85NjJQhlw9nUToVmd-McpVsChN4I0tKw3bk62RPn6QKq4sEcqVlWd8dZWvls0Iah5CnBVOw-jYKwKMUaJKcuQW7MHZzOSeWvU55P-SXalFcJM_cG2rEZkjUY8xRquv9isa4yHTS2i1sfk51-HMZv0qJN1kDqFxxGlfYhzl7IensBrPy1OAxrGVOVrTwfJgUaOw-MPdfgrIGKmlcYPwYDKECs0GR8rsOxV-mo-cyBKpBKPDxd01plTyO5aYyiT8aszAF5zK1O6Da3OJV1urZMLkcSJ9FYo_3nOZZBB4H7ULbUJfeiW2x5fuhWgfiv0fp75eMg)

Minting of new native tokens, if required by rewarding contracts, occurs after the daily cycle of authorizing daily inflation. In order to determine the amount of native tokens to mint, a top-up calculation must be made for each reward service. [Inflation] calls `computeTopupRequest` on [InflationRewardServices] in order to compute the daily minting request amount.

In order for [InflationRewardServices] to compute the top-up request for each reward service, `computeTopupRequest` needs to know the top-up formula defined for each [IIInflationReceiver] contract. This configuration is a governance callable API on [Inflation] via the `setTopupConfiguration` method. [InflationRewardServices] calls `getTopupConfiguration` for each [IIInflationReceiver] defined on each RewardService. Top-up configurations types and their formulas are defined in the Definitions section.

For each RewardService, [InflationRewardServices] calls `computeTopupRequest`, sending in the top-up configuration for that service. [InflationRewardServices] then sums the requested top-ups across reward services for the given time slot.

Finally, in order to make the mint request, [Inflation] takes the mint request result from `InflationRewardServices.computeTopupRequest` and calls `requestMinting` on the [FlareDaemon].

Minting is fulfilled be the [FlareDaemon] by passing on the minting request to the validator at the end of `trigger()` by returning the mint request total from the trigger method. At the end of state transition, the validator will add the requested native tokens to the [FlareDaemon] contract balance.

The process concludes with the [FlareDaemon], in the next block, recognizing and transferring added native tokens from the validator by calling `receiveMinting` on [Inflation]. The [FlareDaemon] detects arrival of the new native tokens by monitoring the contract balance every time `trigger()` is called (every block).

### Funding

[![](https://mermaid.ink/img/pako:eNp9Uj1vwjAQ_SuWp1aCP-ChE1Ri6AJVpyyHfUlPdezUOaeiiP9emwiTAOotyb33fN9Hqb1BqWSP3xGdxhVBE6CtnEgGkb2L7R7D6HcQmDR14Fh8gCUD7B9QrxYCrgBb7-7JjastMP1LbfEHgtlhGEhj_0C4mUg10nAp0HrfiXVyD2Jvvf4a0Wyl3OXyZVKfEhyoaTA8PV-1oJkGYLxvJNsETLFKIUqYM0a_OItlWdTRGQE1YxAtOSbXXPlsJcYk3HwESoSxz3ffxW6bd9XzNM1N82H6eq6aJZxnSenvB1tSF-Y2LzpzBWaOwUejvLCjLj3IH7mQLYYWyKRjPGaqkvyJLVZSpV-DNUTLlazcKUnzYe4OTkvFIeJCxi7t9nK7UtVg-4KuDaW1FxDP7tt49efjP_0BEFf-Yg?type=png)](https://mermaid-js.github.io/mermaid-live-editor/edit#pako:eNp9Uj1vwjAQ_SuWp1aCP-ChE1Ri6AJVpyyHfUlPdezUOaeiiP9emwiTAOotyb33fN9Hqb1BqWSP3xGdxhVBE6CtnEgGkb2L7R7D6HcQmDR14Fh8gCUD7B9QrxYCrgBb7-7JjastMP1LbfEHgtlhGEhj_0C4mUg10nAp0HrfiXVyD2Jvvf4a0Wyl3OXyZVKfEhyoaTA8PV-1oJkGYLxvJNsETLFKIUqYM0a_OItlWdTRGQE1YxAtOSbXXPlsJcYk3HwESoSxz3ffxW6bd9XzNM1N82H6eq6aJZxnSenvB1tSF-Y2LzpzBWaOwUejvLCjLj3IH7mQLYYWyKRjPGaqkvyJLVZSpV-DNUTLlazcKUnzYe4OTkvFIeJCxi7t9nK7UtVg-4KuDaW1FxDP7tt49efjP_0BEFf-Yg)

Once [Inflation] receives the minting top-up request from the [FlareDaemon] via a call to `receiveMinting`, [Inflation] allocates received native token to the reward services by calling `receiveTopupRequest` on [InflationRewardServices]. It sums total received and withdrawn native token top-up.

`InflationRewardServices.receiveTopupRequest` spins through each RewardService for the pending top-up request by calling `getPendingTopup` on each RewardService. Native tokens are then transferred to each associated RewardService [IIInflationReceiver] contract by calling `receiveInflation`. Totals are accumulated for the RewardService and the total top-up allocated is returned to [InflationTimeSlots] for totaling.

The funding process is complete and rewarding contracts can now satisfy claim fulfillment.

### Balancing

Contracts that hold Flare Network balances (as of this writing, [FlareDaemon] and [FtsoRewardManager]), have a `mustBalance()` modifier that is called on every invocation of native tokens entering or leaving these respective contracts. The purpose is to ensure that the actual native token balance held by the contracts matches the native tokens flow as recorded within the contract tracking totals.

[InflationAllocation]: ../../contracts/inflation/implementation/InflationAllocation.sol "InflationAllocation"
[IIInflationAllocation]: ../../contracts/inflation/interface/IIInflationAllocation.sol "IIInflationAllocation"
[Supply]: ../../contracts/accounting/implementation/Supply.sol "Supply"
[Inflation]: ../../contracts/inflation/implementation/Inflation.sol "Inflation"
[FlareDaemon]: ../../contracts/genesis/implementation/FlareDaemon.sol "FlareDaemon"
[InflationTimeSlots]: ../../contracts/inflation/lib/InflationTimeSlots.sol "InflationTimeSlots"
[InflationRewardServices]: ../../contracts/inflation/lib/InflationRewardServices.sol "InflationRewardServices"
[IIInflationReceiver]: ../../contracts/inflation/interface/IIInflationReceiver.sol "IIInflationReceiver"
[FtsoRewardManager]: ../../contracts/tokenPools/implementation/FtsoRewardManager.sol "FtsoRewardManager"
[FTSORewardManager.md]: ./FTSORewardManager.md "FTSORewardManager.md"