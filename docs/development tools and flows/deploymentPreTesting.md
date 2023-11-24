# Testing before deployment

This document is intended for Flare network smart contracts developer and describes the testing workflow for making a transition from hardhat environment to "real" local network (SCdev).

## Test protocol before deployment

- Run `yarn testHH` all test should pass.
- Prepare relevant `.env` file for local hardhat deployment.
- Run `yarn test_endtoend_hardhat`, all tests should pass.
- Prepare relevant `.env` file for local scdev deployment.
- Run `scdev1.sh` network from `flare` repo and run:
  - run `yarn deploy_local_scdev` (deploys and runs some basic tests - all tests should pass, perhaps some minting tests fail sometimes, which is not critical)
  - run `yarn test_endtoend_scdev`, all tests should pass (currently last balance might not match, TODO: fix)

## Deployment to Coston private beta network

- Prepare relevant `.env` file for coston private beta deployment.


