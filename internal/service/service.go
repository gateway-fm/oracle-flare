package service

import (
	"crypto/rand"
	"math/big"
	"oracle-flare/pkg/flare/contracts"

	"oracle-flare/pkg/flare"
	"oracle-flare/pkg/wsClient"
)

// IService is a service layer interface
type IService interface {
	// WhiteListAddress is used to add address to the smart-contract whitelist with given token
	WhiteListAddress(addressS string, indexS string) (bool, error)
	// SendCoinAveragePrice is used to send coin average price from the ws service to the flare smart-contracts
	SendCoinAveragePrice(token contracts.TokenID)
	// Close is used to stop the service
	Close()
}

// service is a service-layer struct implementing IService interface
type service struct {
	flare    flare.IFlare
	wsClient wsClient.IWSClient

	// random is used for current random-arg for flare contracts
	random *big.Int
	// nextID is used to store next subscription ID
	nextID int

	// stopChans is a mapping subscription id to close chan
	stopChans map[int]chan struct{}
	// stopAll is used to stop all subscriptions
	stopAll     chan struct{}
	resubscribe chan struct{}
}

// NewService is used to get new service instance
func NewService(ws wsClient.IWSClient, flare flare.IFlare) IService {
	logInfo("creating new service...", "Init")
	c := &service{
		wsClient:    ws,
		flare:       flare,
		stopAll:     make(chan struct{}),
		stopChans:   map[int]chan struct{}{},
		resubscribe: ws.Resubscribe(),
	}

	return c
}

// Close is used to close the service and all dependencies
func (s *service) Close() {
	logInfo("service closing...", "Close")
	close(s.stopAll)
}

// getNextID is used to update nextID arg and return it
func (s *service) getNextID() int {
	s.nextID++
	return s.nextID
}

// getRandom is used to update random arg and return it
func (s *service) getRandom() *big.Int {
	random, err := rand.Prime(rand.Reader, 130)
	if err != nil {
		return s.getRandom()
	}

	s.random = random

	return random
}
