package songbirdChain

import (
	"log"
	"math/big"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/ethclient"

	songbird_abi "oracle-flare/abis/songbird"
	"oracle-flare/pkg/flare/contracts"
	"oracle-flare/pkg/logger"
	"oracle-flare/utils/contractUtils"
)

// ftsoRegistry is a FtsoRegistry songbird-net smart-contract struct, implementing contracts.IFTSORegistry interface
type ftsoRegistry struct {
	address  common.Address
	abi      *abi.ABI
	contract *bind.BoundContract
	provider *ethclient.Client
}

// NewFTSORegistry is used to get new ftsoRegistry instance
func NewFTSORegistry(provider *ethclient.Client, address common.Address) contracts.IFTSORegistry {
	c := &ftsoRegistry{
		provider: provider,
		address:  address,
	}

	c.init()

	return c
}

// init is used to create new smart-contract instance
func (c *ftsoRegistry) init() {
	abiI, contract, err := contractUtils.GetContract(songbird_abi.IFtsoRegistry, c.address, c.provider, c.provider)
	if err != nil {
		logger.Log().WithField("layer", "FTSO-Init").Fatalln("err get contract:", err.Error())
	}

	c.abi = abiI
	c.contract = contract
}

// GetSupportedIndicesAndSymbols is used to get supported indices and symbols
func (c *ftsoRegistry) GetSupportedIndicesAndSymbols() (*contracts.IndicesAndSymbols, error) {
	out := []interface{}{}

	if err := c.contract.Call(&bind.CallOpts{}, &out, "getSupportedIndicesAndSymbols"); err != nil {
		return nil, err
	}

	p := &contracts.IndicesAndSymbols{}

	log.Println(out)

	p.Indices = *abi.ConvertType(out[0], new([]*big.Int)).(*[]*big.Int)
	p.Symbols = *abi.ConvertType(out[1], new([]string)).(*[]string)

	return p, nil
}
