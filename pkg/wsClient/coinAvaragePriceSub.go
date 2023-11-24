package wsClient

import (
	"encoding/json"
	"fmt"

	"github.com/gorilla/websocket"
)

func (c *client) SubscribeCoinAveragePrice(coins []string, id int, v chan *CoinAveragePriceStream) error {
	req := &CoinAveragePriceRequest{
		ID:      id,
		JSONRPC: "2.0",
		Method:  "coin_average_price",
		Params: &CoinAveragePriceParams{
			Coins: coins,
		},
	}

	data, err := json.Marshal(req)
	if err != nil {
		logErr(fmt.Sprintln("err marshal request:", err.Error()), "SubscribeCoinAveragePrice")
		return err
	}

	if err := c.conn.WriteMessage(websocket.TextMessage, data); err != nil {
		logErr(fmt.Sprintln("err send subscribe msg:", err.Error()), "SubscribeCoinAveragePrice")
		return err
	}

	c.streams[id] = v

	return nil
}
