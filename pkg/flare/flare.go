package flare

import (
	"fmt"
	"math/big"

	"github.com/ethereum/go-ethereum/ethclient"

	"oracle-flare/config"
	"oracle-flare/pkg/flare/contracts"
	"oracle-flare/pkg/flare/contracts/flareChain"
	"oracle-flare/pkg/flare/contracts/songbirdChain"
)

// IFlare is a flare smart-contracts service interface. It aggregates all needed methods in one interface and is used
// as an entrypoint for the flare service interactions
type IFlare interface {
	// GetCurrentPriceEpochData is used to get current price epoch data. New price epoch data is set each 3 minutes
	GetCurrentPriceEpochData() (*contracts.PriceEpochData, error)
	// CommitPrices is used to commit prices for given epoch id
	CommitPrices(epochID *big.Int, indices []contracts.TokenID, prices []*big.Int, random *big.Int) error
	// RevealPrices is used to reveal committed prices for given epoch id. Should be revealed before the epoch
	// reveal end timestamp
	RevealPrices(epochID *big.Int, indices []contracts.TokenID, prices []*big.Int, random *big.Int) error
	// Close is used to close the flare service
	Close()
}

// flare is a flare-service struct implementing IFlare interface
type flare struct {
	conf     *config.Flare
	provider *ethclient.Client

	// used flare smart-contracts

	priceSubmitter contracts.IPriceSubmitter
	ftsoManager    contracts.IFTSOManager
	ftsoRegistry   contracts.IFTSORegistry
	register       *registerContract
}

// NewFlare is used to get new flare instance
func NewFlare(conf *config.Flare) IFlare {
	f := &flare{
		conf: conf,
	}

	f.init()

	return f
}

// init is used to init flare service and all its dependencies
func (f *flare) init() {
	logInfo("new flare pkg init...", "Init")

	// parse chain ID

	id := ChainIDFromInt(f.conf.ChainID)

	if id == UnknownChain {
		logFatal(fmt.Sprintf("chain id: %v not supported", f.conf.ChainID), "Init")
	}

	// init rpc provider

	if f.conf.RpcURL == "" {
		logFatal("no rpc provider url found in the config", "Init")
	}

	rpc, err := ethclient.Dial(f.conf.RpcURL)
	if err != nil {
		logFatal(fmt.Sprintf("err dial provider %s: %s", f.conf.RpcURL, err.Error()), "Init")
	}

	f.provider = rpc

	// init all smart-contracts. Only the registry smart-contract address is given in the config, all other
	// smart-contract addresses are fetched from the blockchain

	if f.conf.RegistryContractAddress == "" {
		logFatal("no registry priceSubmitter found in the config", "Init")
	}

	f.register = newRegisterContract(f.provider, f.conf.RegistryContractAddress)

	submitterAddress, err := f.register.getContractAddress("PriceSubmitter")
	if err != nil {
		logFatal(fmt.Sprintln("get submitter address error:", err.Error()), "Init")
	}

	managerAddress, err := f.register.getContractAddress("FtsoManager")
	if err != nil {
		logFatal(fmt.Sprintln("get ftsoManager address error:", err.Error()), "Init")
	}

	registryAddress, err := f.register.getContractAddress("FtsoRegistry")
	if err != nil {
		logFatal(fmt.Sprintln("get ftsoRegistry address error:", err.Error()), "Init")
	}

	// For different chain IDs different smart contracts (addresses and ABIs) are used.
	// Each smart contract implements the contracts.IContracts interfaces

	switch id {
	case FlareChain:
		f.priceSubmitter = flareChain.NewPriceSubmitter(f.provider, *submitterAddress)
		f.ftsoManager = flareChain.NewFTSOManager(f.provider, *managerAddress)
		f.ftsoRegistry = flareChain.NewFTSORegistry(f.provider, *registryAddress)

		if err := f.fillTokenIDs(); err != nil {
			logFatal(fmt.Sprintln("fill chain ids error:", err.Error()), "Init")
		}

	case SongBirdChain:
		f.priceSubmitter = songbirdChain.NewPriceSubmitter(f.provider, *submitterAddress)
		f.ftsoManager = songbirdChain.NewFTSOManager(f.provider, *managerAddress)
		f.ftsoRegistry = songbirdChain.NewFTSORegistry(f.provider, *registryAddress)

		if err := f.fillTokenIDs(); err != nil {
			logFatal(fmt.Sprintln("fill chain ids error:", err.Error()), "Init")
		}
	}
}

// fillTokenIDs is used to fill token ids with the onchain data
func (f *flare) fillTokenIDs() error {
	data, err := f.ftsoRegistry.GetSupportedIndicesAndSymbols()
	if err != nil {
		return err
	}

	contracts.FillTokenIDs(data)

	return nil
}

func (f *flare) CommitPrices(epochID *big.Int, indices []contracts.TokenID, prices []*big.Int, random *big.Int) error {
	return f.priceSubmitter.CommitPrices(epochID, indices, prices, random)
}

func (f *flare) RevealPrices(epochID *big.Int, indices []contracts.TokenID, prices []*big.Int, random *big.Int) error {
	return f.priceSubmitter.RevealPrices(epochID, indices, prices, random)
}

func (f *flare) GetCurrentPriceEpochData() (*contracts.PriceEpochData, error) {
	return f.ftsoManager.GetCurrentPriceEpochData()
}

func (f *flare) Close() {
	logInfo("close rpc provider connection...", "Close")
	if f.provider != nil {
		f.provider.Close()
	}
}
