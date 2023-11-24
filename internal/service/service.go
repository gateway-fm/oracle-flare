package service

import (
	"oracle-flare/pkg/flare"
	"oracle-flare/pkg/wsClient"
)

type IService interface {
	SendCoinAveragePrice()
	Close()
}

type service struct {
	flare    flare.IFlare
	wsClient wsClient.IWSClient
}

func NewService(ws wsClient.IWSClient, flare flare.IFlare) IService {
	c := &service{
		wsClient: ws,
		flare:    flare,
	}

	return c
}

func (s *service) Close() {
	if s.wsClient != nil {
		s.wsClient.Close()
	}

	if s.flare != nil {
		s.flare.Close()
	}
}
