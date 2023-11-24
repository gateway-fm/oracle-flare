package flareChain

import (
	"github.com/ethereum/go-ethereum/ethclient"
	"oracle-flare/pkg/flare"
)

type Contact struct {
	provider *ethclient.Client
}

func NewContract(provider *ethclient.Client) flare.IContract {
	c := &Contact{
		provider: provider,
	}

	c.init()

	return c
}

func (c *Contact) init() {

}
