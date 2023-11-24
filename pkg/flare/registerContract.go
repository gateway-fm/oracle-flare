package flare

import "github.com/ethereum/go-ethereum/ethclient"

type registerContract struct {
	provider *ethclient.Client
}

func newRegisterContract(provider *ethclient.Client) *registerContract {
	c := &registerContract{
		provider: provider,
	}

	c.init()

	return c
}

func (c *registerContract) init() {

}
