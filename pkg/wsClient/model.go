package wsClient

// CoinAveragePriceParams is a params model for the coin_average_price rpc method for the CoinAveragePriceRequest model
type CoinAveragePriceParams struct {
	// Coins is a coins slice, should be supported by the rpc service
	Coins []string `json:"coins"`
	// FrequencyMS is a return data frequency in milliseconds
	FrequencyMS int `json:"frequency_ms"`
}

// CoinAveragePriceRequest is a request model for the coin_average_price rpc method
type CoinAveragePriceRequest struct {
	ID      int                     `json:"id"`
	JSONRPC string                  `json:"jsonrpc"`
	Method  string                  `json:"method"`
	Params  *CoinAveragePriceParams `json:"params"`
}

// SuccessfulResult is a result model for the success msg from the rpc service for SuccessfulResponse model
type SuccessfulResult struct {
	Message string
	Method  string
}

// SuccessfulResponse is a response model for success messages from the rpc
type SuccessfulResponse struct {
	ID      int               `json:"id"`
	JSONRPC string            `json:"jsonrpc"`
	Result  *SuccessfulResult `json:"result"`
}

// CoinAveragePriceResult is a result model for the coin_average_price rpc method for the CoinAveragePriceResponse model
type CoinAveragePriceResult struct {
	Coin      string  `json:"coin"`
	Method    string  `json:"method"`
	Timestamp int     `json:"timestamp"`
	Value     float64 `json:"value"`
}

// CoinAveragePriceResponse is a response model for the coin_average_price rpc method
type CoinAveragePriceResponse struct {
	ID      int                     `json:"id"`
	JSONRPC string                  `json:"jsonrpc"`
	Result  *CoinAveragePriceResult `json:"result"`
}

// CoinAveragePriceStream is a stream data model used to process data from the rpc into the app channels
type CoinAveragePriceStream struct {
	Coin      string  `json:"coin"`
	Timestamp int     `json:"timestamp"`
	Value     float64 `json:"value"`
}
