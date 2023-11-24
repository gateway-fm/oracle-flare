package service

import "oracle-flare/pkg/wsClient"

type IService interface {
	SendCoinAveragePrice()
	Close()
}

type service struct {
	wsClient wsClient.IWSClient
}

func NewService(ws wsClient.IWSClient) IService {
	c := &service{
		wsClient: ws,
	}

	return c
}

func (s *service) Close() {
	if s.wsClient != nil {
		s.wsClient.Close()
	}
}
