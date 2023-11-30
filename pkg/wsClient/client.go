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
	// Resubscribe is used to get the chanel for resubscribe-needed signal
	Resubscribe() chan struct{}
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
	// resubscribe is used to send a resubscribe-needed signal
	resubscribe chan struct{}
}

// NewClient is used to get new client instance
func NewClient(conf *config.WS) IWSClient {
	c := &client{
		conf: conf,
		mu:   sync.Mutex{},
	}

	if err := c.init(); err != nil {
		logFatal(fmt.Sprintln("err init ws:", err.Error()), "Init")
	}
	go c.listenWS()

	return c
}

// init is used to init client dependencies
func (c *client) init() error {
	logInfo("new ws client init attempt...", "Init")

	conn, _, err := websocket.DefaultDialer.Dial(c.conf.URL, nil)
	if err != nil {
		logWarn(fmt.Sprintln("err dial ws server during init, reconnecting in 5 sec err:", err.Error()), "Init")
		time.Sleep(time.Second * 5)
		return c.init()
	}

	c.streams = make(map[int]chan *CoinAveragePriceStream)
	c.conn = conn
	c.stop = make(chan struct{})
	c.resubscribe = make(chan struct{})

	return nil
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

func (c *client) Resubscribe() chan struct{} {
	return c.resubscribe
}

// Reconnect is used to reconnect to the ws server when unexpected close error occurred
func (c *client) reconnect() {
	logWarn("reconnecting...", "Reconnect")
	time.Sleep(time.Second * 5)

	conn, _, err := websocket.DefaultDialer.Dial(c.conf.URL, nil)
	if err != nil {
		logWarn(fmt.Sprintln("reconnect err:", err.Error()), "Reconnect")
		go c.reconnect()
		return
	}

	c.conn = conn

	go c.listenWS()
	c.resubscribe <- struct{}{}
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
				if websocket.IsUnexpectedCloseError(err) {
					logWarn(fmt.Sprintln("unexpected close err:", err.Error()), "listenWS")
					go c.reconnect()
					return
				}
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
