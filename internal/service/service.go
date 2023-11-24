package service

import (
	"math/big"
	"math/rand"
	"oracle-flare/pkg/flare"
	"oracle-flare/pkg/wsClient"
)

type IService interface {
	SendCoinAveragePrice()
	Close()
}

type service struct {
	flare     flare.IFlare
	wsClient  wsClient.IWSClient
	random    *big.Int
	nextID    int
	stopChans map[int]chan struct{}
	stopAll   chan struct{}
}

func NewService(ws wsClient.IWSClient, flare flare.IFlare) IService {
	logInfo("creating new service...", "Init")
	c := &service{
		wsClient:  ws,
		flare:     flare,
		stopAll:   make(chan struct{}),
		stopChans: map[int]chan struct{}{},
	}

	c.generateRandom()

	return c
}

func (s *service) Close() {
	close(s.stopAll)

	if s.wsClient != nil {
		s.wsClient.Close()
	}

	if s.flare != nil {
		s.flare.Close()
	}
}

func (s *service) getNextID() int {
	s.nextID++
	return s.nextID
}

func (s *service) generateRandom() {
	random := rand.Uint64()
	randomBig := new(big.Int)
	randomBig.SetUint64(random)

	s.random = randomBig
}
