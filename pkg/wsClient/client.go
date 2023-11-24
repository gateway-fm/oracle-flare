package wsClient

import (
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"oracle-flare/config"
)

type IWSClient interface {
	SubscribeCoinAveragePrice(coins []string, id int, frequencyMS int, v chan *CoinAveragePriceStream) error
	Close()
}

type client struct {
	conf *config.WS
	conn *websocket.Conn

	mu sync.Mutex

	subscription bool
	streams      map[int]chan *CoinAveragePriceStream
	stop         chan struct{}
}

func NewClient(conf *config.WS) IWSClient {
	c := &client{
		conf:         conf,
		mu:           sync.Mutex{},
		subscription: false,
	}

	c.init()
	go c.listenWS()

	return c
}

func (c *client) init() {
	logInfo("new ws client init...", "Init")
	conn, _, err := websocket.DefaultDialer.Dial(c.conf.URL, nil)
	if err != nil {
		logFatal(fmt.Sprintln("err dial server:", err.Error()), "Init")
	}

	c.streams = make(map[int]chan *CoinAveragePriceStream)
	c.conn = conn
	c.stop = make(chan struct{})
}

func (c *client) Close() {
	logInfo("closing ws client...", "Close")
	if c.conn != nil {
		close(c.stop)

		// wait till listener stop
		time.Sleep(time.Millisecond * 500)
		if err := c.conn.Close(); err != nil {
			logWarn(fmt.Sprintln("err close connection:", err.Error()), "Close")
		}
	}
}

func (c *client) listenWS() {
	logInfo("listening to ws oracle...", "listenWS")
	for {
		select {
		case <-c.stop:
			logInfo("stop listen", "listenWS")
			return
		default:
			_, data, err := c.conn.ReadMessage()
			if err != nil {
				logWarn(fmt.Sprintln("err from server:", err.Error()), "listenWS")
				return
			}

			logDebug("received msg", "listenWS")

			logSuccess(data)
			c.sendData(data)
		}
	}
}

func (c *client) sendData(data []byte) {
	dataResp := &CoinAveragePriceResponse{}
	err := json.Unmarshal(data, dataResp)
	if err != nil {
		logWarn(fmt.Sprintln("err decode data msg:", err.Error()), "listenWS")
	}

	if dataResp.Result.Timestamp != 0 {
		c.mu.Lock()
		c.streams[dataResp.ID] <- &CoinAveragePriceStream{
			Coin:      dataResp.Result.Coin,
			Timestamp: dataResp.Result.Timestamp,
			Value:     dataResp.Result.Value,
		}
		c.mu.Unlock()
	}
}

func logSuccess(data []byte) {
	successfulResp := &SuccessfulResponse{}
	err := json.Unmarshal(data, successfulResp)
	if err != nil {
		logWarn(fmt.Sprintln("err decode successful msg:", err.Error()), "listenWS")
	}

	if successfulResp.Result.Message != "" {
		logInfo(
			fmt.Sprintf("%s for %s id:%v", successfulResp.Result.Message, successfulResp.Result.Method, successfulResp.ID),
			"listenWS",
		)
	}
}
