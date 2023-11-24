# How to compile contracts and include them in the Flare genesis block

## Tools used in this guide:
- Visual Studio
- Visual Studio extension "solidity" by Juan Blanco

## Steps:
1) Open up a solidity smart contract file (*.sol) from this folder in Visual Studio.
2) With the *.sol file open, right-click, and then select "Solidity: Change workspace compiler version (Remote)".
3) Select the compiler version listed at the top of your smart contract, for example select "0.7.6" if the top of your contract states `pragma solidity 0.7.6;`.
4) Press F5 to compile your contract.
5) Your compiled contract will be saved to flare/bin/contracts.
6) Open up flare/bin/contracts/YOUR_CONTRACT_NAME.json
7) Copy the bytes value to the right of `deployedBytecode` to your clipboard.
8) Open the file: flare/fba-avalanche/avalanchego/genesis/genesis_scdev.go
9) Navigate to the JSON value of `SCDevGenesis`.
10) This JSON contains the genesis config file for the scdev testnet. Addresses can be allocated with both a balance and code deployed at that address, for example:
```
"1000000000000000000000000000000000000002": {
    "balance": "0x0",
    "code": "0x608060405234801561001057600080fd5b50600436106100365760003560e01c80637fec8d381461003b5780638be2fb8614610059575b600080fd5b610043610077565b6040516100509190610154565b60405180910390f35b6100616100ca565b60405161006e919061018f565b60405180910390f35b6000805443116100bc576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016100b39061016f565b60405180910390fd5b436000819055506001905090565b60005481565b6100d9816101bb565b82525050565b60006100ec6025836101aa565b91507f626c6f636b2e6e756d626572203c3d2073797374656d4c61737454726967676560008301527f72656441740000000000000000000000000000000000000000000000000000006020830152604082019050919050565b61014e816101c7565b82525050565b600060208201905061016960008301846100d0565b92915050565b60006020820190508181036000830152610188816100df565b9050919050565b60006020820190506101a46000830184610145565b92915050565b600082825260208201905092915050565b60008115159050919050565b600081905091905056fea264697066735822122027763a81724f350e677ad02735ad09a2664074ff366eee639087afaba88b66f464736f6c63430007030033"
    },
```
11) Take the value of `deployedByteCode` that you copied in step 7 and paste it as the value for `"code"` of your desired allocated address, ensuring to append `0x` to the bytes value here.
12) In particular, and at present, we need the FlareDaemon.sol contract in the genesis block at address `0x1000000000000000000000000000000000000002`.