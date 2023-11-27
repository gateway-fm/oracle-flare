# Airdrop process

This process is run by:
`yarn flare_airdrop` 
## Step 1: export.csv from Flare Foundation

Towo labs provides into Flare SC repo into `airdrop/flare/data/` folder:
- valid export.csv
- digital signature file

## Step2: validate export.csv signature

Airdrop deployer has to validate Towo labs'es  signature

## Step3: Airdrop verification initial tests

Run the pre-transaction verification script. With this we check
- Digital signature of export.csv is valid
- Genesis block hash is valid

Run the test script with 
`yarn test_initial_airdrop_state_mainnet`

## Step4: create unsigned transactions

Make sure .env file has all parameters you will need
```
DEPLOYER_PRIVATE_KEY=<DeployerPrivateKey>
DEPLOYER_PUBLIC_KEY=<DeployerPublicKey>
WEB3_PROVIDER_URL=<link to web3 rpc endpoint>
```

Run `yarn create_airdrop_transactions_mainnet` script

```
Options:
      --help               Show help                                   [boolean]
      --version            Show version number                         [boolean]
  -f, --snapshot-file      Path to snapshot file             [string] [required]
  -h, --header             Flag that tells us if input csv file has header
                                                       [boolean] [default: true]
  -t, --transaction-file   Unsigned transaction data file for output (.json)
                                                             [string] [required]
  -o, --override           if provided genesis data file will override the one
                           at provided destination if there is one
  -l, --log-path           log data path
                                 [string] [default: "airdrop/flare/files/logs/"]
  -g, --gas                gas per transaction     [string] [default: "2000000"]
  -p, --gas-price          gas price per transaction
                                              [string] [default: "255000000000"]
  -i, --chain-id           chain id for network              [number] [required]
  -d, --deployment-name    Deployment file name (generated to
                           deployment/deploys/ folder)       [string] [required]
  -a, --deployment-config  Deployment file name (generated to
                           deployment/chain-config/ folder)  [string] [required]
  -q, --quiet              quiet                    [boolean] [default: "false"]
```

### What does script do

Script does multiple things 

1. it generates unsigned transactions file 
2. Does a bunch of health-checks (using validate functions)

In order to do that we do the following computations and checkups:

For each line of airdrop file we do the following computation:
```
FLR to distribute = XRP balance * conversion factor

```
In order to generate transactions connecting accounts and its founds
```
    {
	    "account": "ff50eF6F4b0568493175defa3655b10d68Bf41FB": 
	    "balance": "0x314dc6448d9338c15B0a00000000"
    },
```

Doing so we:
1. Check validity of each XPR address
2. Check validity of each Flare address
3. Check that each balance is of an expected format
4. Maintain the amount of lines read (valid and invalid lines)
5. Check that there are no duplicate XPR addresses in input file
6. Join the duplicate Flare addresses and their balances into one balance (assuming they came from two separate XPR addresses)
7. Maintain the total XPR read from input file 
8. Maintain the total air-dropped wei


IMPORTANT
1. There is a cap for RippleWork account to "only" receive 1Bn balance from the airdrop.
2. There are some account that have bigger balance
    1. `line 60231 rJb5KsHsDHF1YS5B5DU6QCkH5NsPaKQTcy,0xF977814e90dA44bFA03b6295A0616a897441aceC,2201544281505647,2217615554760638223100000000` Binance claim that is valid

When you run the script:
1. A log file will be generated
2. A command window will display the log of the script runtime

You will see important balance parameters
Script should end with:
Successfully generated transactions

Be sure to save log file!!!

## Step5 Signing the transactions

This step requires the knowing the deployers address private key
Its recommended to do this on a secure machine


do this by running
`yarn sign_airdrop_transactions_mainnet`

```
Options:
  --help                   Show help                                   [boolean]
  --version                Show version number                         [boolean]
  -f, --transactions-file  Path to transactions file         [string] [required]
  -o, --output-file        Path to output raw transactions file
                                                             [string] [required]
  -l, --log-path           log data path
                                       [string] [default: "airdrop/files/logs/"]
  -q, --quiet              quiet                    [boolean] [default: "false"]
```

Save log file!!!

## Step6: Send transactions

in .env there should be
```
WEB3_PROVIDER_URL=<link to web3 rpc endpoint>
```

do this by running
`yarn send_airdrop_transactions_mainnet`

## Step7: Airdrop verification final tests

We run the verification script to check:

- target nonce for sender address matches the number of transactions
- airdrop distribution address balance is 0 at the end
- all accounts have the balance they should
- JP Exchanges balance is what is expected


this is done with
`yarn test_final_airdrop_state_mainnet`

## In case of fail
If any step does not work, we nuke the network and start over