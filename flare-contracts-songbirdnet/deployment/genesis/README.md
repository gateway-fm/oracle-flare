# Generation of genesis files

This script is used for generation of genesis accounts that are embeded into genesis block of Songbird network and genesis code from compiled genesis contracts. 

There are three pre-deployed contracts whose code should be in genesis configuration:
- `StateConnector.sol`
- `FlareDaemon.sol`
- `PriceSubmitter.sol`

The compilation result for these contracts resides in `artifacts/contracts/genesis`. 

## Assumptions

- This repo (`flare-smart-contracts`) and Flare Network repo (`flare`) should reside in the same parent folder. This is important for reading a template and insertion of the generated `genesis_songbird.go` directly into Flare Network repo.
- Accounts and proposed balances were proposed in a relevant Google sheet spreadsheet.
- Owners of accounts are not disclosed in this repository. Instead each account has `id` that represents the row number in that table.
- Total initial supply is 15 billion SGB.
- Accounts in rows num 2 and 3 are Flare foundation accounts. Other accounts have determined values. The balance on those two accounts is devised by summing up all the balances of the other accounts, subtracting the sum from total initial supply and splitting the result in two halves.
- IMPORTANT: the `songbirdGenesisAccountDefinitions` list in the file `deployment/genesis/songbird/songbird-genesis-accounts-definitions.ts` is considered as the authoritative source. Google sheets spreadsheet should be synced with this list.

## Usage

- Have `flare-smart-contracts` repo and `flare` repo in same folder, go to correct branches, that are compatible.
- Have contracts compiled on `flare-smart-contracts` repo (`yarn c`).
- Use the list `songbirdGenesisAccountDefinitions` in `deployment/genesis/songbird/songbird-genesis-accounts-definitions.ts` to define the accounts and balances. Also `TARGET_TOTAL_SUPPLY` is defined there (15 billion SGB).
- Each account is defined by the following fields
  - `id` - row number in Google docs table (number, required).
  - `address` - address of the account, prefixed by `0x` (string, reqired).
  - `initialEntryNat` - account balance entered as integral part of SGB. Should be entered as a string. No decimals are allowed. Comma or one space as a thousands separator shuld be used to avoid errors (string, optional)
  - `initialEntryWei` - account balance entered in Wei. Should be entered as a string. Decimal point can (and should) be used if it is followed by exactly 18 digits to the end. Comma or one space as a thousands separator should be used to avoid errors (string, optional). If both `initialEntryNat` and `initialEntryWei` are given, `initialEntryWei` is used (string, optional).
- NOTE: in `songbirdGenesisAccountDefinitions` keep values `id` in increasing order and matching to line number in the Google sheets.
- Accounts with `id` 2 and 3 should not have values `initialEntryNat` nor `initialEntryWei` provided. All other accounts must have one of them provided.
- Run `yarn generate_genesis_songbird`. This prints out the account data and generates some files in `deployment/genesis/songbird/outputs` folder:
  - `songbird.txt` - formatted printout for reviewing the accounts.
  - `songbird-genesis.txt` - extract of code representing accounts with balances in genesis file.
  - `songbird.csv` - CSV file that can be opened in Excel or Google Sheets and has lines distributed according to value of `id`. This can be used to paste calculated values back to Google sheets spreadsheet.
  - `songbird-genesis.txt`- an extract of genesis code that is also inserted to target genesis file.
- In addition template for songbird genesis file from Flare Network repo (`genesis_songbird_template.go`) is read and from it generated songbird genesis file `genesis_songbird.go` and written into Flare Network repo. 

# Testing the accounts on network

- On Flare Network repo compile the node by running `./compile.sh genesis_songbird.go`
- Run the node: `./cmd/local.sh`
- Check the health by running `curl http://127.0.0.1:9650/ext/health | jq .healthy`. It should return `true` after some time (can take even 50s)
- Run the test by `yarn test_genesis_accounts_scdev`

# Miscelanious

To generate account (private key) and obtain address for test purposes use the following:
- In `flare-smart-contracts` repo open a terminal and run `yarn hardhat console`. 
- When console is started paste the following code
```
let wallet = web3.eth.accounts.create()
wallet.privateKey
wallet.address
```
This will create a private key and print out both private key and corresponding address.
In case private key is known, one can get wallet as follows
```
let wallet2 = web3.eth.accounts.privateKeyToAccount('0xf4370f5df466f6688edfcd512477e405815e3ea88014294543fcf24138a7730e');
wallet2.address
```
Note that this is not intended for secure key generation procedures, but rather only for testing purposes.
