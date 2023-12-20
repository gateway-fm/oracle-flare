package service

import (
	"fmt"
	"time"

	"github.com/ethereum/go-ethereum/common"

	"oracle-flare/pkg/flare/contracts"
)

func (s *service) WhiteListAddress(addressS string, indicesS []string) ([]bool, error) {
	if addressS == "" {
		return nil, fmt.Errorf("no address given")
	}

	if len(indicesS) == 0 {
		return nil, fmt.Errorf("no indices given")
	}

	address := common.HexToAddress(addressS)

	res := []bool{}
	for _, i := range indicesS {
		logInfo(fmt.Sprintln("whitelisting for:", i), "WhiteListAddress")

		index := contracts.GetTokenIDFromName(i)

		if index == contracts.UnknownToken {
			logWarn("unknown token", "WhiteListAddress")
			res = append(res, false)
			continue
		}

		isWhitListed, err := s.isAddressWhitelisted(index, address)
		if err != nil {
			logErr(fmt.Sprintln("err isAddressWhitelisted:", err.Error()), "WhiteListAddress")
			res = append(res, false)
			continue
		}

		if isWhitListed {
			if err != nil {
				logErr("address already whitelisted", "WhiteListAddress")
				res = append(res, true)
				continue
			}
		}

		if err := s.flare.RequestWhitelistingVoter(address, index); err != nil {
			logErr(fmt.Sprintln("err RequestWhitelistingVoter:", err.Error()), "WhiteListAddress")
			res = append(res, false)
			continue
		}

		// wait for the tx
		time.Sleep(time.Second * 3)

		isWhitListed, err = s.isAddressWhitelisted(index, address)
		if err != nil {
			logErr(fmt.Sprintln("err isAddressWhitelisted:", err.Error()), "WhiteListAddress")
			res = append(res, false)
			continue
		}

		if isWhitListed {
			logInfo("token whitelisted", "WhiteListAddress")
			res = append(res, true)
		} else {
			logWarn("token not whitelisted", "WhiteListAddress")
			res = append(res, false)
		}
	}

	return res, nil
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
