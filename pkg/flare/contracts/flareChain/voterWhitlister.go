package flareChain

import (
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/ethclient"

	"oracle-flare/pkg/flare/contracts"
	"oracle-flare/pkg/logger"
	"oracle-flare/utils/contractUtils"
)

// voterWhiteLister is a VoterWhiteLister flare-net smart-contract struct, implementing contracts.IVoterWhiteLister interface
type voterWhiteLister struct {
	address  common.Address
	signer   *bind.TransactOpts
	abi      *abi.ABI
	contract *bind.BoundContract
	provider *ethclient.Client
}

// NewVoterWhiteLister is used to get new voterWhiteLister instance
func NewVoterWhiteLister(provider *ethclient.Client, address common.Address, signer *bind.TransactOpts) contracts.IVoterWhiteLister {
	c := &voterWhiteLister{
		provider: provider,
		address:  address,
		signer:   signer,
	}

	c.init()

	return c
}

// init is used to create new smart-contract instance
func (c *voterWhiteLister) init() {
	abiI, contract, err := contractUtils.GetContract("./abis/flare/IVoterWhiteLister.abi", c.address, c.provider, c.provider)
	if err != nil {
		logger.Log().WithField("layer", "VoterWhiteLister-Init").Fatalln("err get contract:", err.Error())
	}

	c.abi = abiI
	c.contract = contract
}

func (c *voterWhiteLister) RequestWhitelistingVoter(address common.Address, index contracts.TokenID) error {
	tx, err := c.contract.Transact(c.signer, "requestWhitelistingVoter", address, index.Index())
	if err != nil {
		logger.Log().WithField("layer", "VoterWhiteLister-RequestWhitelistingVoter").Errorln("err tx:", err.Error())
		return err
	}

	logger.Log().WithField("layer", "VoterWhiteLister-RequestWhitelistingVoter").Infoln("requestWhitelistingVoter tx time:", tx.Time())

	return nil
}

func (c *voterWhiteLister) GetFtsoWhitelistedPriceProviders(index contracts.TokenID) ([]common.Address, error) {
	out := []interface{}{}

	if err := c.contract.Call(&bind.CallOpts{}, &out, "getFtsoWhitelistedPriceProviders", index.Index()); err != nil {
		logger.Log().WithField("layer", "VoterWhiteLister-RequestWhitelistingVoter").Errorln("err tx:", err.Error())
		return nil, err
	}

	addresses := *abi.ConvertType(out[0], new([]common.Address)).(*[]common.Address)

	return addresses, nil
}
