# Generating genesis C-chain config for Flare

## Setting up the configuration

Based on the distribution of funds to the accounts on protected spreadsheet the configuration file 
`deployment/genesis/flare/flare-genesis-accounts-definitions.ts` should be set up.

## Generate account info

```
yarn generate_genesis_flare
```

The result will appear `deployment/genesis/flare/outputs`

You can use `flare.csv`, open it in Excel (import it and set delimiter to comma) and paste blocks of data into relevant fields of the spreadsheet.
- Use relevant columns for block-copy-paste of columns (C,D) -> (D, E), from CSV to the spreadsheet.
- To check for matching addresses, use Column I, Address check

## Generate genesis config

```
yarn genesis_json_flare
```

The result will appear in `deployment/genesis_gen/generated/flare.json`.

Use the `cChainGenesis` key and put the value in the `genesis_flare.go` in the validator repo.

Beside `flare.json` additional files are generated:
- `deployment/genesis_gen/generated/flare-staging.json` - includes additional accounts from `test-1020-accounts.json`
- `deployment/genesis_gen/generated/flare-cChainGenesis.json` - pretty print of `cChainGenesis` key of `flare.json`
- `deployment/genesis_gen/generated/flare-staging-cChainGenesis.json` - pretty print of `cChainGenesis` key of `flare-staging.json`

