package service

import (
	"oracle-flare/pkg/flare"
	"oracle-flare/pkg/flare/contracts"
	"oracle-flare/pkg/wsClient"
)

// IService is a service layer interface
type IService interface {
	// WhiteListAddress is used to add address to the smart-contract whitelist with given token
	WhiteListAddress(addressS string, indexS string) (bool, error)
	// SendCoinAveragePrice is used to send coin average price from the ws service to the flare smart-contracts
	SendCoinAveragePrice(tokens []contracts.TokenID)
	// Close is used to stop the service
	Close()
}

// service is a service-layer struct implementing IService interface
type service struct {
	flare    flare.IFlare
	wsClient wsClient.IWSClient

	avgPriceSenders []*coinAVGPriceSender
	resubscribe     chan struct{}
}

// NewService is used to get new service instance
func NewService(ws wsClient.IWSClient, flare flare.IFlare) IService {
	logInfo("creating new service...", "Init")
	c := &service{
		avgPriceSenders: make([]*coinAVGPriceSender, 0),
	}

	if ws != nil {
		c.wsClient = ws
		c.resubscribe = ws.Resubscribe()
	}

	if flare != nil {
		c.flare = flare
	}

	go c.listenResubscribe()

	return c
}

func (s *service) listenResubscribe() {
	for {
		select {
		case <-s.resubscribe:
			for _, v := range s.avgPriceSenders {
				v.resubscribe <- struct{}{}
			}
		}
	}
}

// Close is used to close the service and all dependencies
func (s *service) Close() {
	logInfo("service closing...", "Close")
	for _, v := range s.avgPriceSenders {
		v.close()
	}
}
