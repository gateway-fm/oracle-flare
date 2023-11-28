package flare

// ChainID is a chain id type
type ChainID int

const (
	UnknownChain ChainID = iota
	FlareChain
	Coston2Chain
	SongBirdChain
)

var ChainIDStrings = [...]string{
	UnknownChain:  "UnknownChain",
	FlareChain:    "FlareChain",
	Coston2Chain:  "Coston2Chain",
	SongBirdChain: "SongBirdChain",
}

var ChainIDInts = [...]int{
	UnknownChain:  0,
	FlareChain:    14,
	Coston2Chain:  114,
	SongBirdChain: 19,
}

// ChainIDFromInt is used to get chain id from the given int
func ChainIDFromInt(id int) ChainID {
	switch id {
	case 14:
		return FlareChain
	case 114:
		return Coston2Chain
	case 19:
		return SongBirdChain
	default:
		return UnknownChain
	}
}

// String is used to get ChainID string value
func (i ChainID) String() string {
	return ChainIDStrings[i]
}

// ID is used to get ChainID int value
func (i ChainID) ID() int {
	return ChainIDInts[i]
}
