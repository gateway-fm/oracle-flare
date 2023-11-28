package service

import (
	"fmt"
	"time"

	"github.com/ethereum/go-ethereum/common"

	"oracle-flare/pkg/flare/contracts"
)

func (s *service) WhiteListAddress(addressS string, indexS string) (bool, error) {
	if addressS == "" {
		return false, fmt.Errorf("no address given")
	}

	if indexS == "" {
		return false, fmt.Errorf("no index given")
	}

	address := common.HexToAddress(addressS)
	index := contracts.GetTokenIDFromSymbol(indexS)

	isWhitListed, err := s.isAddressWhitelisted(index, address)
	if err != nil {
		return false, err
	}

	if isWhitListed {
		logInfo("address already whitelisted", "WhiteListAddress")
		return true, nil
	}

	if err := s.flare.RequestWhitelistingVoter(address, index); err != nil {
		return false, nil
	}

	// wait for the tx
	time.Sleep(time.Second * 3)

	return s.isAddressWhitelisted(index, address)
}

func (s *service) isAddressWhitelisted(index contracts.TokenID, target common.Address) (bool, error) {
	addresses, err := s.flare.GetFtsoWhitelistedPriceProviders(index)
	if err != nil {
		return false, err
	}

	for _, a := range addresses {
		if a.Hex() == target.Hex() {
			return true, nil
		}
	}

	return false, nil
}
