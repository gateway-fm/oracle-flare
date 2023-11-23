package main

import (
	"log"
	"time"

	"oracle-flare/config"
	"oracle-flare/pkg/wsClient"
)

func main() {
	c := wsClient.NewClient(&config.WS{URL: "wss://oracle.gateway.fm"})
	defer c.Close()

	stream := make(chan *wsClient.CoinAveragePriceStream)
	stop := make(chan struct{})
	defer close(stop)

	go func() {
		for {
			select {
			case <-stop:
				return
			case v := <-stream:
				log.Printf("received coin: %s, value: %v, timestamp: %v", v.Coin, v.Value, v.Timestamp)
			}
		}
	}()

	if err := c.SubscribeCoinAveragePrice([]string{"ETH", "BTC"}, 1, stream); err != nil {
		log.Fatal(err)
	}

	time.Sleep(time.Second * 10)
}
