package wsClient

import (
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"oracle-flare/config"
)

// IWSClient is a ws client pkg interface
type IWSClient interface {
	// SubscribeCoinAveragePrice is used to send subscribe msg for the prc coin_average_price method
	SubscribeCoinAveragePrice(coins []string, id int, frequencyMS int, v chan *CoinAveragePriceStream) error
	// Close is used to close the service
	Close()
}

// client is a ws client pkg struct implementing IWSClient interface
type client struct {
	conf *config.WS
	conn *websocket.Conn

	mu sync.Mutex

	// streams mapping stream rpc id to the CoinAveragePriceStream chan
	streams map[int]chan *CoinAveragePriceStream
	// stop is used to stop the connections listener
	stop chan struct{}
}

// NewClient is used to get new client instance
func NewClient(conf *config.WS) IWSClient {
	c := &client{
		conf: conf,
		mu:   sync.Mutex{},
	}

	c.init()
	go c.listenWS()

	return c
}

// init is used to init client dependencies
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

// Close is used to stop the service
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

// listenWS is used to listen to the ws connection
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
				// error can be occurred when stop the service
				logWarn(fmt.Sprintln("err from server:", err.Error()), "listenWS")
				return
			}

			logDebug("received msg", "listenWS")

			logSuccess(data)
			c.sendData(data)
		}
	}
}

// sendData is a handler for data reposes. Can be expanded for several stream types
func (c *client) sendData(data []byte) {
	dataResp := &CoinAveragePriceResponse{}
	err := json.Unmarshal(data, dataResp)
	if err != nil {
		logWarn(fmt.Sprintln("err decode data msg:", err.Error()), "listenWS")
		return
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

// TODO: add error handlers

// logSuccess is a handler for success messages
func logSuccess(data []byte) {
	successfulResp := &SuccessfulResponse{}
	err := json.Unmarshal(data, successfulResp)
	if err != nil {
		logWarn(fmt.Sprintln("err decode successful msg:", err.Error()), "listenWS")
		return
	}

	if successfulResp.Result.Message != "" {
		logInfo(
			fmt.Sprintf("%s for %s id:%v", successfulResp.Result.Message, successfulResp.Result.Method, successfulResp.ID),
			"listenWS",
		)
	}
}
