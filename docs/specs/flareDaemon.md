
# Flare Daemon


#### A Blockchain system trigger

## Background

The Flare Daemon is a novel system added to the Flare network block chain. It serves as a special system trigger that can be used by a limited set of registered contracts. Some computations on Flare dedicated smart contracts are either too pricey (gas) to compute or have very specific time constraints. Any of these contracts can be registered to the [Flare Daemon] by a governance address, and will be triggered per block. The trigger will have very high gas limits and will enable compute intensive code to be executed at “system expense”.

## Validator side

The [Flare Daemon] contract will be loaded to the chain in the Genesis block and will have a fixed constant address set by the validator - same as done with pre-compiled contracts. Per state transition, the validator will trigger a defined function on the daemon contract. This call will have a high gas allocation; the number will be fine tuned later on.

### Safety

The call to the [Flare Daemon] `trigger()` method is protected with a high, but configurable gas limit, settable by block. This parameter is hardcoded within the validator codebase contained within Flare repo, file `fba-avalanche/coreth/core/state_connector.go`.

## Smart contract side

Each contract that needs a daemon trigger will implement the [Flare Daemon Interface]. Per a call from the validator right before state transition, the daemon contract will iterate all registered contracts and trigger each of them. If any of these contracts revert, the daemon will save revert error data and continue to the next daemonized contract.

[Flare Daemon]: ../../contracts/genesis/implementation/FlareDaemon.sol "Flare Daemon"
[Flare Interface]: ../../contracts/genesis/interface/IFlareDaemonize.sol "Flare Daemon interface"

### Safety

Each daemonized contract can be configured with gas limit to protect against endless loops or excessive gas utilization due to unexpected bugs. This is important since daemonized contracts are triggered every block, just before state transition. Unlimited daemonized contract execution could hang the chain.

Finally, a deployment parameter `flareDaemonGasExceededHoldoffBlocks` can be configured such that when any given daemonized contract exceeds its gas limit, execution will be deferred for the configured number of blocks.
