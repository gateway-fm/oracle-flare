package service

import (
	"log"
	"oracle-flare/pkg/wsClient"
)

func (s *service) SendCoinAveragePrice() {
	stream := make(chan *wsClient.CoinAveragePriceStream)
	id := s.getNextID()
	stop := make(chan struct{})
	s.stopChans[id] = stop

	go s.listenStream(stream, stop)

	if err := s.wsClient.SubscribeCoinAveragePrice([]string{"ETH"}, id, 1000, stream); err != nil {
		close(stop)
	}
}

func (s *service) listenStream(stream chan *wsClient.CoinAveragePriceStream, stop chan struct{}) {
	select {
	case <-s.stopAll:
		return
	case <-stop:
		return
	case data := <-stream:
		log.Printf("received data coint:%v, value: %v", data.Coin, data.Value)
	}
}
