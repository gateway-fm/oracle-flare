package wsClient

type CoinAveragePriceParams struct {
	Coins       []string `json:"coins"`
	FrequencyMS int      `json:"frequency_ms"`
}

type CoinAveragePriceRequest struct {
	ID      int                     `json:"id"`
	JSONRPC string                  `json:"jsonrpc"`
	Method  string                  `json:"method"`
	Params  *CoinAveragePriceParams `json:"params"`
}

type SuccessfulResult struct {
	Message string
	Method  string
}

type SuccessfulResponse struct {
	ID      int               `json:"id"`
	JSONRPC string            `json:"jsonrpc"`
	Result  *SuccessfulResult `json:"result"`
}

type CoinAveragePriceResult struct {
	Coin      string  `json:"coin"`
	Method    string  `json:"method"`
	Timestamp int     `json:"timestamp"`
	Value     float64 `json:"value"`
}

type CoinAveragePriceResponse struct {
	ID      int                     `json:"id"`
	JSONRPC string                  `json:"jsonrpc"`
	Result  *CoinAveragePriceResult `json:"result"`
}

type CoinAveragePriceStream struct {
	Coin      string  `json:"coin"`
	Timestamp int     `json:"timestamp"`
	Value     float64 `json:"value"`
}
