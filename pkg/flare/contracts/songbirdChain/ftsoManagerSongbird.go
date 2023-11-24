package songbirdChain

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

type ftsoManager struct {
	address  common.Address
	abi      *abi.ABI
	contract *bind.BoundContract
	provider *ethclient.Client
}

func NewFTSOManager(provider *ethclient.Client, address common.Address) contracts.IFTSOManager {
	c := &ftsoManager{
		provider: provider,
		address:  address,
	}

	c.init()

	return c
}

func (c *ftsoManager) init() {
	abiI, contract, err := contractUtils.GetContract("./abis/songbird/IFtso.abi", c.address, c.provider, c.provider)
	if err != nil {
		logger.Log().WithField("layer", "FTSO-Init").Fatalln("err get contract:", err.Error())
	}

	c.abi = abiI
	c.contract = contract
}

func (c *ftsoManager) GetCurrentPriceEpochData() (*contracts.PriceEpochData, error) {
	//TODO: implement
	return &contracts.PriceEpochData{EpochID: big.NewInt(0), SubmitTime: big.NewInt(0), RevealTime: big.NewInt(0), VotePower: big.NewInt(0)}, nil
}
