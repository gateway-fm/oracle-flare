package flare

import (
	"fmt"

	"github.com/ethereum/go-ethereum/ethclient"

	"oracle-flare/config"
	"oracle-flare/pkg/flare/flareChain"
	"oracle-flare/pkg/flare/songbirdChain"
)

type IContract interface {
	//
}

type IFlare interface {
	Close()
}

type flare struct {
	contract IContract
	register *registerContract
	conf     *config.Flare
	provider *ethclient.Client
}

func NewFlare(conf *config.Flare) IFlare {
	f := &flare{
		conf: conf,
	}

	f.init()

	return f
}

func (f *flare) init() {
	id := ChainIDFromInt(f.conf.ChainID)

	if id == UnknownChain {
		logFatal(fmt.Sprintf("chain id: %v not supported", f.conf.ChainID), "Init")
	}

	if f.conf.RpcURL == "" {
		logFatal("no rpc provider url found in the config", "Init")
	}

	rpc, err := ethclient.Dial(f.conf.RpcURL)
	if err != nil {
		logFatal(fmt.Sprintf("err dial provider %s: %s", f.conf.RpcURL, err.Error()), "Init")
	}

	f.provider = rpc
	f.register = newRegisterContract(f.provider)

	switch id {
	case FlareChain:
		f.contract = flareChain.NewContract(f.provider)
	case SongBirdChain:
		f.contract = songbirdChain.NewContract(f.provider)
	}
}

func (f *flare) Close() {
	if f.provider != nil {
		f.provider.Close()
	}
}
