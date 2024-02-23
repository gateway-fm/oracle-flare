package service

import (
	"fmt"

	"oracle-flare/pkg/flare"
	"oracle-flare/pkg/flare/contracts"
	"oracle-flare/pkg/wsClient"
)

// IService is a service layer interface
type IService interface {
	// WhiteListAddress is used to add address to the smart-contract whitelist with given tokens
	WhiteListAddress(addressS string, indicesS []string) ([]bool, error)
	// ListenAndSendAverageCoinPrice is
	ListenAndSendAverageCoinPrice(tokens []string)
	// Close is used to stop the service
	Close()
}

// service is a service-layer struct implementing IService interface
type service struct {
	flare    flare.IFlare
	wsClient wsClient.IWSClient

	nextID          int
	avgPriceSenders []*coinAveragePriceSender
	resubscribe     chan struct{}
}

// NewService is used to get new service instance
func NewService(ws wsClient.IWSClient, flare flare.IFlare) IService {
	logInfo("creating new service...", "Init")
	c := &service{
		avgPriceSenders: make([]*coinAveragePriceSender, 0),
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

func (s *service) ListenAndSendAverageCoinPrice(tokens []string) {
	parsedTokens := []contracts.TokenID{}

	for _, t := range tokens {
		parsedToken := contracts.GetTokenIDFromName(t)
		if parsedToken == contracts.UnknownToken {
			logWarn(fmt.Sprintln("received unknown token:", t), "SendCoinAveragePrice")
		} else {
			parsedTokens = append(parsedTokens, parsedToken)
		}
	}

	if len(parsedTokens) == 0 {
		logErr("all tokens are invalid", "SendCoinAveragePrice")
		return
	}

	sender := newCoinAveragePriceSender(s.nextID, s.flare, s.wsClient, parsedTokens)
	s.avgPriceSenders = append(s.avgPriceSenders, sender)

	s.nextID++

	go sender.runWriter()
	go sender.runSender()
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
