package main

import (
	"crypto/rand"
	"log"
)

func main() {
	//m := big.NewInt(0).Exp(big.NewInt(2), big.NewInt(128), nil)

	n, err := rand.Prime(rand.Reader, 130)
	if err != nil {
		log.Fatal(err)
	}

	log.Println(n)

	//uint256ArrT, _ := abi.NewType("uint256[]", "", nil)
	//uint256T, _ := abi.NewType("uint256", "", nil)
	//addressT, _ := abi.NewType("address", "", nil)
	//
	//coder := abi.Arguments{
	//	{
	//		Type: uint256ArrT,
	//	},
	//	{
	//		Type: uint256ArrT,
	//	},
	//	{
	//		Type: uint256T,
	//	},
	//	{
	//		Type: addressT,
	//	},
	//}
	//
	//b, err := coder.Pack(
	//	[]*big.Int{big.NewInt(1), big.NewInt(2)},
	//	[]*big.Int{big.NewInt(3), big.NewInt(4)},
	//	big.NewInt(5),
	//	common.HexToAddress("0x0000000000000000000000000000000000000000"),
	//)
	//if err != nil {
	//	log.Fatal(err)
	//}
	//
	//hash := crypto.Keccak256(b)
	//hash32 := *abi.ConvertType(hash, new([32]byte)).(*[32]byte)
	//
	//rpc, err := ethclient.Dial("https://ethereum-goerli.publicnode.com")
	//if err != nil {
	//	log.Fatal(err)
	//}
	//
	//_, contract, err := contractUtils.GetContract("./utils/test-abi-coder/abi.json", common.HexToAddress("0xEA2A5B5B1886F4E88477Cb4A42a387876959f359"), rpc, rpc)
	//if err != nil {
	//	log.Fatal(err)
	//}
	//
	//out := []interface{}{}
	//
	//err = contract.Call(
	//	&bind.CallOpts{},
	//	&out,
	//	"decode",
	//	hash32,
	//	[]*big.Int{big.NewInt(1), big.NewInt(2)},
	//	[]*big.Int{big.NewInt(3), big.NewInt(4)},
	//	big.NewInt(5),
	//)
	//if err != nil {
	//	log.Fatal(err)
	//}
	//
	//log.Println(out)
}
