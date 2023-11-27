package flare

import (
	"fmt"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/ethclient"

	"oracle-flare/utils/contractUtils"
)

// registerContract is a register smart-contract. It has the same ABI and address for all flare chains
type registerContract struct {
	address  common.Address
	abi      *abi.ABI
	contract *bind.BoundContract
	provider *ethclient.Client
}

// newRegisterContract is used to get new registerContract instance
func newRegisterContract(provider *ethclient.Client, address string) *registerContract {
	c := &registerContract{
		provider: provider,
		address:  common.HexToAddress(address),
	}

	c.init()

	return c
}

// getContractAddress is used to get contract address by given contract name
func (c *registerContract) getContractAddress(name string) (*common.Address, error) {
	out := []interface{}{}

	if err := c.contract.Call(&bind.CallOpts{}, &out, "getContractAddressByName", name); err != nil {
		return nil, err
	}

	out0 := *abi.ConvertType(out[0], new(common.Address)).(*common.Address)

	return &out0, nil
}

// init is used to init the registerContract
func (c *registerContract) init() {
	abiI, contract, err := contractUtils.GetContract("./abis/IFlareContractRegistry.abi", c.address, c.provider, c.provider)
	if err != nil {
		logFatal(fmt.Sprintln("err get contract register:", err.Error()), "Init")
	}

	c.abi = abiI
	c.contract = contract
}
