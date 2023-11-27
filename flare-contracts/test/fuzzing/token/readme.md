# VPToken fuzzing

Run VPToken fuzzing witch command

    yarn test_fuzzing_token
    
Parameters can be passed via environment variables (tests cannot take command line args, so this was simplest), e.g.

    REPLAY=true yarn test_fuzzing_token
    
(replays the last test run) or

    LENGTH=30000 yarn test_fuzzing_token
    
(sets the test run length i.e. the number of actions to run).

The parameters are defined at the beginning of `VPTokenFuzzing.ts` (between `// PARAMETERS` and `// END PARAMETERS`).

## File explanation

The files in this directory are

- `VPTokenFuzzing.ts` - main fuzzing test file. Executes tests randomly or replays previously saved test run.
- `FuzzingUtils.ts` - various functions for conversion for `BN` (big number) conversions and JSON serialization and some random generator wrappers for use in simulations (not crypto random).
- `SparseMatrix.ts` - matrix (`SparseMatrix`) and array (`SparseArray`) that have addresses as row/col keys (used for state tracking of balance and vote power, to reproduce the Solidity behavior).
- `VPTokenState.ts` - class `VPTokenState` contains simulated full state of VPToken (at a given block; no history) and methods that emulate state changing methods on real VPToken.
- `VPTokenChecker.ts` - class for checking the validity of VPToken data at some step of the simulation. Can check values at any block number. There are two types of checking methods - some check that invariants hold (e.g. *vote power equals balance minus delegations from plus delegations to*) and the others compare VPToken state with simulated state.
- `VPTokenSimulator.ts` - contains two classes: 
    - `VPTokenHistory` - contains the history of all actions (t.i. state changing method calls); this history is saved to json (`cache/history.json`) and later reproduced (for deterministic unit tests or to simplify bug search). Also contains last VPToken state and snapshots of state at several 'checkpoints' (to simulate history actions like revoke).
    - `VPTokenSimulator` - executes methods on `VPTokenHistory`.
