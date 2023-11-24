package flareChain

import (
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/ethclient"

	"oracle-flare/pkg/flare/contracts"
)

type priceSubmitter struct {
	provider *ethclient.Client
}

func NewPriceSubmitter(provider *ethclient.Client, address common.Address) contracts.IPriceSubmitter {
	c := &priceSubmitter{
		provider: provider,
	}

	c.init()

	return c
}

func (c *priceSubmitter) init() {

}
