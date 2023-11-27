#!/bin/bash

# inputs
echo "by default ftso median does 1 iteration"
echo "for 100 iterations use 'yarn test_fuzzing_hh FTSORND_RUNS=100'"
echo "for configuring token fuzzer see test/fuzzing/token/readme.md"
for ARGUMENT in "$@"
do
    KEY=$(echo $ARGUMENT | cut -f1 -d=)
    VALUE=$(echo $ARGUMENT | cut -f2 -d=)
    case "$KEY" in
            FTSORND_RUNS)       p_FTSORND_RUNS=${VALUE};;
            *)
    esac
done

echo "FTSO median fuzzing"
env FTSORND_RUNS=$p_FTSORND_RUNS yarn hardhat test --network hardhat test/performance/implementations/FTSOMedian.ts

echo "VPToken fuzzing"
yarn hardhat test --network hardhat test/fuzzing/token/VPTokenFuzzing.ts
