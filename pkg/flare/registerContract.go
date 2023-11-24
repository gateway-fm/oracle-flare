package flare

import (
	"fmt"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/ethclient"

	"oracle-flare/utils/contractUtils"
)

type registerContract struct {
	address  common.Address
	abi      *abi.ABI
	contract *bind.BoundContract
	provider *ethclient.Client
}

func newRegisterContract(provider *ethclient.Client, address string) *registerContract {
	c := &registerContract{
		provider: provider,
		address:  common.HexToAddress(address),
	}

	c.init()

	return c
}

func (c *registerContract) getContractAddress(name string) (*common.Address, error) {
	out := []interface{}{}

	if err := c.contract.Call(&bind.CallOpts{}, &out, "getContractAddressByName", name); err != nil {
		return nil, err
	}

	out0 := *abi.ConvertType(out[0], new(common.Address)).(*common.Address)

	return &out0, nil
}

func (c *registerContract) init() {
	abiI, contract, err := contractUtils.GetContract("./abis/IFlareContractRegistry.abi", c.address, c.provider, c.provider)
	if err != nil {
		logFatal(fmt.Sprintln("err get registry priceSubmitter:", err.Error()), "Init")
	}

	c.abi = abiI
	c.contract = contract
}
