package contractUtils

import (
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/ethclient"
)

// GetContract is a utils that is used to get abi and contract instances from given config data
func GetContract(abiS string, address common.Address, reader *ethclient.Client, writer *ethclient.Client) (
	*abi.ABI, *bind.BoundContract, error,
) {
	meta := &bind.MetaData{ABI: abiS}

	a, err := meta.GetAbi()
	if err != nil {
		return nil, nil, err
	}

	return a, bind.NewBoundContract(address, *a, reader, writer, reader), nil
}
