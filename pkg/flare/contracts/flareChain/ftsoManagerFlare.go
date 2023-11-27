package flareChain

import (
	"math/big"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/ethclient"

	"oracle-flare/pkg/flare/contracts"
	"oracle-flare/pkg/logger"
	"oracle-flare/utils/contractUtils"
)

// ftsoManager is a FtsoManager flare-net smart-contract struct, implementing contracts.IFTSOManager interface
type ftsoManger struct {
	address  common.Address
	abi      *abi.ABI
	contract *bind.BoundContract
	provider *ethclient.Client
}

// NewFTSOManager is used to get new ftsoManager instance
func NewFTSOManager(provider *ethclient.Client, address common.Address) contracts.IFTSOManager {
	c := &ftsoManger{
		provider: provider,
		address:  address,
	}

	c.init()

	return c
}

// init is used to create new smart-contract instance
func (c *ftsoManger) init() {
	abiI, contract, err := contractUtils.GetContract("./abis/flare/IFtsoManager.abi", c.address, c.provider, c.provider)
	if err != nil {
		logger.Log().WithField("layer", "FTSO-Init").Fatalln("err get contract:", err.Error())
	}

	c.abi = abiI
	c.contract = contract
}

// GetCurrentPriceEpochData is used to get and parse current epoch data
func (c *ftsoManger) GetCurrentPriceEpochData() (*contracts.PriceEpochData, error) {
	out := []interface{}{}

	if err := c.contract.Call(&bind.CallOpts{}, &out, "getCurrentPriceEpochData"); err != nil {
		return nil, err
	}

	p := &contracts.PriceEpochData{}

	p.EpochID = abi.ConvertType(out[0], new(big.Int)).(*big.Int)
	p.StartTimestamp = abi.ConvertType(out[1], new(big.Int)).(*big.Int)
	p.EndTimestamp = abi.ConvertType(out[2], new(big.Int)).(*big.Int)
	p.RevealEndTimestamp = abi.ConvertType(out[3], new(big.Int)).(*big.Int)
	p.CurrentTimestamp = abi.ConvertType(out[4], new(big.Int)).(*big.Int)

	return p, nil
}
