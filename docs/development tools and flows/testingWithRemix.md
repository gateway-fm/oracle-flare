# Testing with Remix

Important: you must work in a browser that has *Metamask* installed and configured to the network stated above, and have the first account from `test-1020-accounts.json` configured in it. The metamask should also be connected to the relevant test network (or Coston).
Link to Remix: (https://remix.ethereum.org/)

## Configuring compiler

Choose `Solidity compiler` icon on the left (the second one) and set the following:

- Compiler: 0.7.6+commit ...
- Tick the checkboxes:
   - Autocompile
   - Enable optimization. Also set 100000 (the number should match the one in `hardhat.config.ts`) as the number of runs of the optimizer

## Configuring deployment

Choose the `Deploy & run transactions` icon on the left (the third one)
Set as `Environment`: `Injected Web3`. This will open Metamask. Select the account `Ftso MVP 0`.
The account number should appear selected in Account dropdown in Remix.

## Deploying a contract

For a particular contract, run a script. For example:

`./scripts/flatten.sh contracts/implementations/Ftso.sol`

This generates a flattened contract in the relevant subfolder of the `flattened` folder.

Choose the `File explorers` icon on the left (the first one). Load a flattened file into workspace. 
