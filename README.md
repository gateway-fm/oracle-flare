# Oracle-Flare Readme

## Overview

Oracle-Flare is a project designed to read exchange rates data from the Index-deamon 
app using a WebSocket (WS) connection and send this data to the Flare blockchain as a 
data provider. It currently supports Flare main-net (Chain ID 14) and Flare Coston2 
test-net (Chain ID 114).

## Configuration

To start the service, set the `FLARE_SIGNERPK` environment variable to the 
data-provider (signer) wallet's private key. Additionally, you can configure other 
parameters using environment variables:

- `WS_URL`: Index-deamon WS service URL (Default: wss://oracle.gateway.fm).
- `FLARE_CHAINID`: Flare blockchain net ID (Default: 114 for Coston2 test-net).
- `FLARE_RPCURL`: RPC provider for the selected net 
- (Default: https://flare-coston2.eu-north-2.gateway.fm/ext/bc/C/rpc).
- `FLARE_REGISTRYCONTRACTADDRESS`: Registry contract address 
- (Default: 0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019).
- `FLARE_SIGNERPK`: Signer's private key (Required).

## Running the Service

### Using Makefile
For common commands, use the Makefile. To run the service, execute:

```shell
make run
```

### Using Docker
Compile and run the Dockerfile with the given `FLARE_SIGNERPK` environment value:

```shell
docker build -t oracle-flare .
docker run -e FLARE_SIGNERPK=<your_private_key> oracle-flare
```

## Service Commands

### Serve Command
Running the serve command establishes a connection to the WS service, sends a subscribe request, and automatically 
restores the service if the connection is lost. The service fetches epoch data from the blockchain every 3 minutes, 
sending committed data about exchange prices. After each epoch, it sends reveal data to the blockchain.

```shell
go run ./cmd/oracle-flare.go serve
```

### Whitelist Command
Before starting, run the whitelist command for each exchange symbol (e.g., ETH or testETH). If the address is 
whitelisted, the command logs a warning without returning an error.

```shell
go run ./cmd/oracle-flare.go whitelist --address <signer_public_address> --token <token_symbol>
```

Example:

`go run ./cmd/oracle-flare.go whitelist --address 0x8382Be7cc5C2Cd8b14F44108444ced6745c5feCb --token testETH`

