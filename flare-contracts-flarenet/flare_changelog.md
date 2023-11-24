# Flare change log

## Staking Phase 2 - October 2023
### Background: [FIP.05 | Flare Governance Proposals](https://proposals.flare.network/FIP/FIP_5.html)
In the transition to the proof of stake consensus mechanism a mirroring service was developed.
The solution allows a C-chain address to receive validator rewards, FlareDrops and participate in governance using the funds staked on the P-chain address obtained from the same public key.

#### New contract: **AddressBinder**
Contract where P-chain and C-chain address pairs should be registered to enable getting rewards on C-chain for funds staked on P-chain.

#### New contract: **PChainStakeMirror**
Contract holding all mirrored balances and vote powers for each node ID.

#### New contract: **PChainStakeMirrorMultiSigVoting**
Contract that enables voting for the Merkle root per epoch with a limited number of trusted voters.

#### New contract: **PChainStakeMirrorVerifier**
Contract responsible for staking data verification at the time the user mirrors the stake.

#### New contract: **CombinedNat**
Contract combining the WNat and PChainStakeMirror balances. It enables claiming of FlareDrops for mirrored staked funds.

#### Upgraded contract: **GovernanceVotePower**
The upgrade enables voting by mirrored staked funds.


## Update FTSO price pairs - August 2023
### Background: [FIP.04 | Flare Governance Proposals](https://proposals.flare.network/FIP/FIP_4.html)

Price pairs provided by the FTSO system were updated:
  *  `BCH` and `DGB` were removed.
  *  `ARB`, `AVAX`, `BNB`, `MATIC`, `SOL`, `USDC`, `USDT` and `XDC` were added.

The list of supported price pairs is: `ADA`, `ALGO`, `ARB`, `AVAX`, `BNB`, `BTC`, `DOGE`, `ETH`, `FIL`, `LTC`, `MATIC`, `SGB`, `SOL`, `USDC`, `USDT`, `XDC`, `XLM` and `XRP`.

## FTSO secondary reward band - July 2023
### Background: [FIP.03 | Flare Governance Proposals](https://proposals.flare.network/FIP/FIP_3.html)

#### Upgraded contract: **FtsoManager**
The upgrade adds governance APIs to enable setting parameters for the secondary reward band.

#### Upgraded contract: **Ftso**
The `PriceFinalized` event was updated to include information regarding the secondary band.

## FTSO polling - April 2023
### Background: [FIP.02 | Flare Governance Proposals](https://proposals.flare.network/FIP/FIP_2.html)

#### Upgraded contract: **VoterWhitelister**
The upgraded contract now has governance APIs to enable chilling of FTSO providers and to view chilling data.
 - A chilled data provider cannot be whitelisted or submit prices.
 - The data provider can whitelist itself again after the chill period is over.
 - There is one new method `chilledUntilRewardEpoch(address)` that can be used to check when chill periods are over for a specific address.

#### New contract: **PollingFtso**
The voting contract for the FTSO management group. Each member of the group can submit a chilling proposal and vote on active chilling proposals. See more in FIP.02.