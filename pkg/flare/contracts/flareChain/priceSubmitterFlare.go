package flareChain

import (
	"math/big"
	"sort"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/ethclient"

	flare_abi "oracle-flare/abis/flare"
	"oracle-flare/pkg/flare/contracts"
	"oracle-flare/pkg/logger"
	"oracle-flare/utils/abiCoder"
	"oracle-flare/utils/contractUtils"
)

// priceSubmitter is a PriceSubmitter flare-net smart-contract struct, implementing contracts.IPriceSubmitter interface
type priceSubmitter struct {
	address  common.Address
	signer   *bind.TransactOpts
	abi      *abi.ABI
	contract *bind.BoundContract
	provider *ethclient.Client
}

// NewPriceSubmitter is used to get new priceSubmitter instance
func NewPriceSubmitter(provider *ethclient.Client, address common.Address, signer *bind.TransactOpts) contracts.IPriceSubmitter {
	c := &priceSubmitter{
		provider: provider,
		address:  address,
		signer:   signer,
	}

	c.init()

	return c
}

// init is used to create new smart-contract instance
func (c *priceSubmitter) init() {
	abiI, contract, err := contractUtils.GetContract(flare_abi.IPriceSubmitter, c.address, c.provider, c.provider)
	if err != nil {
		logger.Log().WithField("layer", "PriceSubmitter-Init").Fatalln("err get contract:", err.Error())
	}

	c.abi = abiI
	c.contract = contract
}

// CommitPrices is used to hash and commit given data
func (c *priceSubmitter) CommitPrices(epochID *big.Int, indices []contracts.TokenID, prices []*big.Int, random *big.Int) error {
	coder, err := abiCoder.NewCoder([]string{"uint256[]", "uint256[]", "uint256", "address"})
	if err != nil {
		logger.Log().WithField("layer", "PriceSubmitter-CommitPrices").Errorln("err create coder:", err.Error())
		return err
	}

	indicesBig := []*big.Int{}
	for _, i := range indices {
		indicesBig = append(indicesBig, i.Index())
	}

	sortStruct := SubmitterSort{
		Indices: indicesBig,
		Prices:  prices,
	}

	sort.Sort(sortStruct)

	hash, err := coder.KeccakHash(sortStruct.Indices, sortStruct.Prices, random, c.signer.From)
	if err != nil {
		logger.Log().WithField("layer", "PriceSubmitter-CommitPrices").Errorln("err get hash:", err.Error())
		return err
	}

	tx, err := c.contract.Transact(c.signer, "submitHash", epochID, hash)
	if err != nil {
		logger.Log().WithField("layer", "PriceSubmitter-CommitPrices").Errorln("err tx:", err.Error())
		return err
	}

	logger.Log().WithField("layer", "PriceSubmitter-CommitPrices").Infof("submitHash tx hash: %v time: %v", tx.Hash(), tx.Time())

	return nil
}

// RevealPrices is used to reveal given data
func (c *priceSubmitter) RevealPrices(epochID *big.Int, indices []contracts.TokenID, prices []*big.Int, random *big.Int) error {
	indicesBig := []*big.Int{}
	for _, i := range indices {
		indicesBig = append(indicesBig, i.Index())
	}

	sortStruct := SubmitterSort{
		Indices: indicesBig,
		Prices:  prices,
	}

	sort.Sort(sortStruct)

	tx, err := c.contract.Transact(c.signer, "revealPrices", epochID, sortStruct.Indices, sortStruct.Prices, random)
	if err != nil {
		logger.Log().WithField("layer", "PriceSubmitter-RevealPrices").Errorln("err tx:", err.Error())
		return err
	}

	logger.Log().WithField("layer", "PriceSubmitter-RevealPrices").Infof("revealPrices tx hash: %v time: %v", tx.Hash(), tx.Time())

	return nil
}
