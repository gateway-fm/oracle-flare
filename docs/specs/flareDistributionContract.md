# Flare distribution contract

## Background
- Native token tokens were airdropped on XRP holders.
- Each xrp holder had to submit a public key in secp256k1 format (Etheruem format) for signaling his request to participate in Flare airdrop.
- Each registered XRP address will receive its native token balance onto its registered public key.
- The planned airdrop steps:
   - 15% of the total airdrop value will be dropped on network launch.
   - During next months, per 1 month (30 days) 3% of the total airdrop value will be unlocked for claiming.
   - Each user can claim unlocked funds whenever he wishes to. There is no expiration date for claiming.
- If a user wishes to opt-out of the airdrop at any point, a dedicated API will enable him to withdraw his remaining claim rights.   
- if any user doesn't claim unlocked funds for a few months, he will receive the full unlocked value on his next claim. Ex: he didn't claim for 3 months, he will receive 9% of his full airdrop in his next claim.

## Distribution steps

### Pre-launch
- Validator genesis file holds a list of addresses and balances (15% of airdrop per address)
- Genesis Distribution Smart contract with the airdrop scheme:
    - Time frames for unlocking distribution percentages
    - Claim API
- Distribution contract balance set to 85% of full airdrop value.

### Step 0: network launch
- Validator initializes 15% of the final balance to each address in the distribution list.
- Smart contract deployed as a genesis contract with the airdrop unlock scheme.
- Validator mints 85% of the total distribution balance to the smart contract.

### Step 1: setting up the contract
- Addresses and expected balances are uploaded to the smart contract in batches. This is done by the deployer address.
- Smart contract totals airdrop value and makes sure it matches contract balance.
- Governance renounced from deployer’s address to the Flare Foundation’s address.

### Step 2: 1 - x months from launch
- Each month, another 3% of total value is unlocked for claiming.
- People can claim any unlocked funds using API: claimUnlockedAirdrop
- Per call to claimUnlockedAirdrop:
    - Send the user the relative airdrop amount that has been unlocked and not yet claimed.
- Month = 30 days


### Opt out option
Each user can opt out of the airdrop by calling 'optOut' API.
Once opt out is called, the funds will be allocated to one of the incentive pools
The opt out operation can not be undone.

