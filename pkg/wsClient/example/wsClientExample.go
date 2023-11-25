package main

import (
	"log"
	"time"

	"oracle-flare/config"
	"oracle-flare/pkg/wsClient"
)

/**
This is an example of the wsClient pkg usage. It is similar to the usage in the app internal service layer.
You can play with the SubscribeCoinAveragePrice params, mainly with the coins and frequency params
*/

func main() {
	c := wsClient.NewClient(&config.WS{URL: "wss://oracle.gateway.fm"})
	defer c.Close()

	stream := make(chan *wsClient.CoinAveragePriceStream)
	stop := make(chan struct{})
	defer close(stop)

	// First - run the go routine function to listen to the stream chanel
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

	// Second - send the subscribe message
	if err := c.SubscribeCoinAveragePrice([]string{"ETH", "BTC"}, 1, 1000, stream); err != nil {
		log.Fatal(err)
	}

	time.Sleep(time.Second * 10)
}
