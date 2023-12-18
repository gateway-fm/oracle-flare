package flareChain

import "math/big"

// SubmitterSort is a helper struct to sort both Indices and Prices
type SubmitterSort struct {
	Indices []*big.Int
	Prices  []*big.Int
}

func (s SubmitterSort) Len() int {
	return len(s.Indices)
}

func (s SubmitterSort) Swap(i, j int) {
	s.Indices[i], s.Indices[j] = s.Indices[j], s.Indices[i]
	s.Prices[i], s.Prices[j] = s.Prices[j], s.Prices[i]
}

func (s SubmitterSort) Less(i, j int) bool {
	return s.Indices[i].Int64() < s.Indices[j].Int64()
}
