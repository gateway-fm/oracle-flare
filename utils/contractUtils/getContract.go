package contractUtils

import (
	"io"
	"log"
	"os"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/ethclient"
)

// GetContract is a utils that is used to get abi and contract instances from given config data
func GetContract(abiPath string, address common.Address, reader *ethclient.Client, writer *ethclient.Client) (
	*abi.ABI, *bind.BoundContract, error,
) {
	abiFile, err := os.Open(abiPath)
	if err != nil {
		return nil, nil, err
	}
	defer func() {
		if err := abiFile.Close(); err != nil {
			log.Println("close abi file error:", err.Error())
		}
	}()

	b, err := io.ReadAll(abiFile)
	if err != nil {
		return nil, nil, err
	}

	meta := &bind.MetaData{ABI: string(b)}

	a, err := meta.GetAbi()
	if err != nil {
		return nil, nil, err
	}

	return a, bind.NewBoundContract(address, *a, reader, writer, reader), nil
}
