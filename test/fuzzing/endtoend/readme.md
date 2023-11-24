# End-to-end fuzzing

Run end-to-end fuzzing with command

    yarn test_fuzzing_endtoend
    
Parameters can be passed via environment variables (tests cannot take command line args, so this was simplest), e.g.

    LOOPS=1000 yarn test_fuzzing_endtoend
    
## Parameters

- `LOOPS` - the number of iterations. In each iteration all user accounts react to events and perform their tasks (e.g. provide prices, claim rewards etc.).
    After every iteration, fuzzer's internal state is checked against the triggered events for consistency (e.g. that the claimed rewards match the given rewards).
    
    The typical real time used by fuzzer is around 1 second per loop (on Hardhat network, it's more on scdev). The average network time per loop is around 10s without big time jumps (e.g. with only time jumps that don't miss any price epoch). 
    
    Large `LOOP` values take a lot of time and a lot of memory - 20000 loops (needed for 1 year of network time with big time jumps of 1 day every 50 iterations) takes around 10 hours of real time and requires 20GB RAM.
    
- `N_PROVIDERS` - the number of price providers. Default is 15. When increasing to more than ~50, price epoch duration should also be increased.

- `N_DELEGATORS` - the number of delegators. Default is 5. Every account active in fuzzing is either price provider or delegator.

- `RESERVED_ACCOUNTS` - the number of reserved accounts (governance, deployer). 5 (default) is always enough.
    
- `MAX_PRICE_JUMP` - max relative change of randomly generated prices per 1 price epoch. Default is 1.1.

- `RUN_PARALLEL` - when `true` (default), try to simulate parallel price submission / reward claiming from multiple users.

- `BIG_JUMP_SECONDS` - there are two types of time jumps - small ones are always performed automatically and are calculated so that no price submission/reveal is ever skipped.
    Big ones happen only occasionally (configured by `BIG_JUMP_EVERY` or `BIG_JUMP_ON`) and skip `BIG_JUMP_SECONDS` seconds.

- `BIG_JUMP_EVERY` - if provided, big jumps will be executed every `BIG_JUMP_EVERY` loops. Default is no big jumps.

- `BIG_JUMP_ON` - if provided, it's comma separated list of loop numbers for when to perform big jump. Default is no big jumps.

- `AVOID_ERRORS` - if true (default), there will be very few erroneous network calls. If false, there will be a lot of errors generated (prices too large, delegations over 100%, etc.)

- `RUN_CHECKERS` - if true (default), events and fuzzer state are checked for consistency after every loop.

- `AUTO_RUN_TRIGGER` - on hardhat, `FlareDaemon.trigger()` is not run automatically, so it's run by the fuzzer every `AUTO_RUN_TRIGGER` transactions (not loops). Default is 10.

- `MINING_BATCH_SIZE` - when not provided, hardhat automining is used - each transaction is mined separately and has timestamp increased by 1s. When this is a positive number, this many transactions will be mined as 1 block. Mind that there are limits how many transactions can be mined in a block, so something like 10-20 is a sensible value.

- `CHAIN_CONFIG` - end-to-end fuzzer uses standard deploy script with parameter file `fuzzing-chain-config.json`. However, one or more parameters can be overriden by providing an inline JSON value in this parameter, e.g. `CHAIN_CONFIG='{"defaultVoterWhitelistSize":10}'`.

The parameters are defined at the beginning of `EndToEndFuzzing.ts`.

## File explanation

The files in this directory are

- `EndToEndFuzzing.ts` - main fuzzer loop.
- `TransactionRunner.ts` - executes transactions with catching and logging errors and events. Also supports automatic or batch mining and automatic runnning of FlareDaemon trigger.
- `UserAccount.ts` - generic user account class and delegator account class. Does delegation and reward claiming.
- `PriceProvider.ts` - price provider class, inherits UserAccount.
- `StateChecker.ts` - checks all event parameters agains fuzzer internal state and detects inconsistencies.
- `EndToEndFuzzingUtils.ts` - utility methods.
- `EpochTimes.ts` - utility classes to retrieve price / reward epoch durations.
- `Experiments.ts` - add experimental tests here (only run manually).
- `fuzzing-chain-config.json` - deploy parameters for fuzzing on hardhat. More or less equal to `scdev.json` in `chain-config` directory.
