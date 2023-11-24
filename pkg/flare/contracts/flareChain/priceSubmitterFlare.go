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

type priceSubmitter struct {
	address  common.Address
	abi      *abi.ABI
	contract *bind.BoundContract
	provider *ethclient.Client
}

func NewPriceSubmitter(provider *ethclient.Client, address common.Address) contracts.IPriceSubmitter {
	c := &priceSubmitter{
		provider: provider,
		address:  address,
	}

	c.init()

	return c
}

func (c *priceSubmitter) init() {
	abiI, contract, err := contractUtils.GetContract("./abis/flare/IPriceSubmitter.abi", c.address, c.provider, c.provider)
	if err != nil {
		logger.Log().WithField("layer", "PriceSubmitter-Init").Fatalln("err get contract:", err.Error())
	}

	c.abi = abiI
	c.contract = contract
}

func (c *priceSubmitter) CommitPrices(epochID *big.Int, indices []*big.Int, prices []*big.Int, random *big.Int) error {
	//TODO: implement
	return nil
}

func (c *priceSubmitter) RevealPrices(epochID *big.Int, indices []*big.Int, prices []*big.Int, random *big.Int) error {
	//TODO: implement
	return nil
}
