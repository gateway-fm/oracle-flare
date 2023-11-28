package flare

import (
	"fmt"
	"math/big"

	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"

	"oracle-flare/config"
	"oracle-flare/pkg/flare/contracts"
	"oracle-flare/pkg/flare/contracts/flareChain"
	"oracle-flare/pkg/flare/contracts/songbirdChain"
)

// IFlare is a flare smart-contracts service interface. It aggregates all needed methods in one interface and is used
// as an entrypoint for the flare service interactions
type IFlare interface {
	// RequestWhitelistingVoter is used to whitelist given address for given token ID
	RequestWhitelistingVoter(address common.Address, index contracts.TokenID) error
	// GetFtsoWhitelistedPriceProviders is used to get all whitelisted providers for given token ID
	GetFtsoWhitelistedPriceProviders(index contracts.TokenID) ([]common.Address, error)
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
	signer   *bind.TransactOpts

	// used flare smart-contracts

	whitLister     contracts.IVoterWhiteLister
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

	// get signer

	if f.conf.SignerPK == "" {
		logFatal("no pk in the configs", "Init")
	}

	pk, err := crypto.HexToECDSA(f.conf.SignerPK)
	if err != nil {
		logFatal(fmt.Sprintln("err get PK:", err.Error()), "Init")
	}

	if f.signer, err = bind.NewKeyedTransactorWithChainID(pk, big.NewInt(int64(id.ID()))); err != nil {
		logFatal(fmt.Sprintln("err get signer:", err.Error()), "Init")
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

	voterAddress, err := f.register.getContractAddress("VoterWhitelister")
	if err != nil {
		logFatal(fmt.Sprintln("get voterWhitelister address error:", err.Error()), "Init")
	}

	// For different chain IDs different smart contracts (addresses and ABIs) are used.
	// Each smart contract implements the contracts.IContracts interfaces

	switch id {
	case FlareChain:
		f.priceSubmitter = flareChain.NewPriceSubmitter(f.provider, *submitterAddress, f.signer)
		f.ftsoManager = flareChain.NewFTSOManager(f.provider, *managerAddress)
		f.ftsoRegistry = flareChain.NewFTSORegistry(f.provider, *registryAddress)
		f.whitLister = flareChain.NewVoterWhiteLister(f.provider, *voterAddress, f.signer)

		if err := f.fillTokenIDs(); err != nil {
			logFatal(fmt.Sprintln("fill token ids error:", err.Error()), "Init")
		}

		// Same ABI as for Flare main-net for methods that are used in this service
	case Coston2Chain:
		f.priceSubmitter = flareChain.NewPriceSubmitter(f.provider, *submitterAddress, f.signer)
		f.ftsoManager = flareChain.NewFTSOManager(f.provider, *managerAddress)
		f.ftsoRegistry = flareChain.NewFTSORegistry(f.provider, *registryAddress)
		f.whitLister = flareChain.NewVoterWhiteLister(f.provider, *voterAddress, f.signer)

		if err := f.fillTokenIDs(); err != nil {
			logFatal(fmt.Sprintln("fill token ids error:", err.Error()), "Init")
		}

	case SongBirdChain:
		f.priceSubmitter = songbirdChain.NewPriceSubmitter(f.provider, *submitterAddress)
		f.ftsoManager = songbirdChain.NewFTSOManager(f.provider, *managerAddress)
		f.ftsoRegistry = songbirdChain.NewFTSORegistry(f.provider, *registryAddress)

		if err := f.fillTokenIDs(); err != nil {
			logFatal(fmt.Sprintln("fill token ids error:", err.Error()), "Init")
		}
	}
}

// fillTokenIDs is used to fill token ids with the onchain data and token symbols string values
func (f *flare) fillTokenIDs() error {
	data, err := f.ftsoRegistry.GetSupportedIndicesAndSymbols()
	if err != nil {
		return err
	}

	contracts.FillTokenIDAndNames(data, f.conf.ChainID == Coston2Chain.ID())

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

func (f *flare) RequestWhitelistingVoter(address common.Address, index contracts.TokenID) error {
	return f.whitLister.RequestWhitelistingVoter(address, index)
}

func (f *flare) GetFtsoWhitelistedPriceProviders(index contracts.TokenID) ([]common.Address, error) {
	return f.whitLister.GetFtsoWhitelistedPriceProviders(index)
}

func (f *flare) Close() {
	logInfo("close rpc provider connection...", "Close")
	if f.provider != nil {
		f.provider.Close()
	}
}
