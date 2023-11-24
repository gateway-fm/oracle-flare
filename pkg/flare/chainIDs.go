package flare

type ChainID int

const (
	UnknownChain ChainID = iota
	FlareChain
	SongBirdChain
)

var ChainIDStrings = [...]string{
	UnknownChain:  "UnknownChain",
	FlareChain:    "FlareChain",
	SongBirdChain: "SongBirdChain",
}

var ChainIDInts = [...]int{
	UnknownChain:  0,
	FlareChain:    14,
	SongBirdChain: 19,
}

func ChainIDFromInt(id int) ChainID {
	switch id {
	case 14:
		return FlareChain
	case 19:
		return SongBirdChain
	default:
		return UnknownChain
	}
}

func (i ChainID) String() string {
	return ChainIDStrings[i]
}

func (i ChainID) ID() int {
	return ChainIDInts[i]
}
