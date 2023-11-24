import { BigNumber } from "ethers";
import { GenesisAccount } from "../genesis-lib";

// 15 billion SGB
const TARGET_TOTAL_SUPPLY = "100,000,000,000.000 000 000 000 000 000" 
const P_CHAIN_FUNDS = "200,000.000 000 000 000 000 000" 

export const flareTargetTotalSupply = BigNumber.from(TARGET_TOTAL_SUPPLY.replace(/[., ]/g, ""));
export const flarePChainFunds = BigNumber.from(P_CHAIN_FUNDS.replace(/[., ]/g, ""));
// THE AUTHORITATIVE LIST OF ADDRESSES AND BALANCES
// Should match the line numbers in Gdocs
export const flareGenesisAccountDefinitions: GenesisAccount[] = [
    {
        id: 2,
        address: "0x1000000000000000000000000000000000000006",
        initialEntryWei: "3,900,330,239.094 370 633 065 000 000"
    },
    {
        id: 3,
        address: "0x1000000000000000000000000000000000000004",
        initialEntryWei: "22,101,871,354.868 100 254 035 000 000"
    },
    {
        id: 4,
        address: "0x1000000000000000000000000000000000000005",
        initialEntryWei: "20,000,000,000.000 000 000 000 000 000"
    },
////
    {
        id: 5,
        address: "0x628B0E1A5215fb2610347eEDbf9ceE68043D7c92",
        initialEntryWei: "2,522,719,777.932 457 125 400 000 000"
    },
////
    {
        id: 7,
        address: "0x81D2A8b4BbF71F9e9d3284BA0Da90c636f3803f7",
        initialEntryWei: "0",
        isBalancing: true
    },
    {
        id: 8,
        address: "0x8c862EE155a14cb15A18e96684Bbd45ed3E21c23",
        initialEntryWei: "0",
        isBalancing: true
    },
    {
        id: 9,
        address: "0x25B2E9CAf1993439faEDE57E2eBC1321a27fb31d",
        initialEntryWei: "0",
        isBalancing: true
    },
    {
        id: 10,
        address: "0xf3Ce3535Cd6c71A6290Cf2134AE936ac6C369861",
        initialEntryWei: "0",
        isBalancing: true
    },
    {
        id: 11,
        address: "0x0f253Ea4aA19b319038ce6669f62E74ef34Bb35B",
        initialEntryWei: "0",
        isBalancing: true
    },
    {
        id: 12,
        address: "0xcc4620bb63F22a439779181406eE1256192ABc5A",
        initialEntryWei: "0",
        isBalancing: true
    },
    {
        id: 13,
        address: "0xdA02ee21d047A1cfecDb09866Ed37dB93f310dB7",
        initialEntryWei: "0",
        isBalancing: true
    },
    {
        id: 14,
        address: "0xfF964a10041E0bD830dbC9b310014096355E7F68",
        initialEntryWei: "0",
        isBalancing: true
    },
    {
        id: 15,
        address: "0x09Da958D3104890F77d97D1436A1E3567ea86644",
        initialEntryWei: "0",
        isBalancing: true
    },
    {
        id: 16,
        address: "0xD935f3B878Cac8d0E549c6CCe5aFdf7BFA63E6cE",
        initialEntryWei: "0",
        isBalancing: true
    },
////
    {
        id: 18,
        address: "0x9298Bb6E42d6950dcdcccB1309CB6ab5fD29ad63",
        initialEntryNat: "500,000,000"
    },    
    {
        id: 19,
        address: "0x4bd02eF1D3A241c9Bf4A5129c5350D0449F5D3d6",
        initialEntryNat: "500,000,000"
    },
    {
        id: 20,
        address: "0x51583EAE1e9f77b30226190077bd5c236A3A55E1",
        initialEntryNat: "500,000,000"
    },
    {
        id: 21,
        address: "0x91b689EE73793B247C7F98b9CC7d9bF03ea20b12",
        initialEntryNat: "500,000,000"
    },
    {
        id: 22,
        address: "0xC552c18A9793c39Ff1DB48b425B5757120095897",
        initialEntryNat: "500,000,000"
    },
    {
        id: 23,
        address: "0x7825fF4d745F090bc009CE46ea366eB40439b9B8",
        initialEntryNat: "500,000,000"
    },
    {
        id: 24,
        address: "0xc0e1F5a7290c7ae02197B47eBEc8151fF4BDe724",
        initialEntryNat: "500,000,000"
    },
    {
        id: 25,
        address: "0xD956e1ed4C0C090f6AC7B2450863dE3acF3F8eF2",
        initialEntryNat: "500,000,000"
    },
    {
        id: 26,
        address: "0xd929789Cb189223b7744eC81DB010D10079D4b3F",
        initialEntryNat: "500,000,000"
    },
    {
        id: 27,
        address: "0xa0FE681BdB9fdEAD4609297Cb18a47AB26257B28",
        initialEntryNat: "500,000,000"
    },
    {
        id: 28,
        address: "0xf00cfeC4132EDb8f73b6f9A4e9CdE9930D5EEEDC",
        initialEntryNat: "500,000,000"
    },
    {
        id: 29,
        address: "0xC789e17A7fb06e32A0018a0C2670E3763b121916",
        initialEntryNat: "500,000,000"
    },
    {
        id: 30,
        address: "0xdCA14Af311bd966aa493Cc47FDaB88144eF3c7Fa",
        initialEntryNat: "500,000,000"
    },
    {
        id: 31,
        address: "0x1F655DB637fAeAc5442f1C4854eA03d766f087f5",
        initialEntryNat: "500,000,000"
    },
    {
        id: 32,
        address: "0x7FDBD31918177bf3726268cCB17A6ae2b411b902",
        initialEntryNat: "500,000,000"
    },
    {
        id: 33,
        address: "0x2B01FDC03Ad99B52742Fed5F8D607770C1fe8d4a",
        initialEntryNat: "500,000,000"
    },
    {
        id: 34,
        address: "0x949a27d37EBb454D36E4894243ac987b3A7628b4",
        initialEntryNat: "500,000,000"
    },
    {
        id: 35,
        address: "0xFe8f28231E306FBE363846D2f37363AF372972aB",
        initialEntryNat: "500,000,000"
    },
    {
        id: 36,
        address: "0x7efC34Bd86EA18A795E452D7cCd6f05dae76b49b",
        initialEntryNat: "500,000,000"
    },
    {
        id: 37,
        address: "0x9cA8744DDC3c9d245A68B6c7039eD15086E47791",
        initialEntryNat: "500,000,000"
    },
    {
        id: 38,
        address: "0xa63509E754FF14C1849cB252E8c95cbee57c8e25",
        initialEntryNat: "500,000,000"
    },
    {
        id: 39,
        address: "0x0eBeCf7D66571012E49501CD198C94a250f0876E",
        initialEntryNat: "500,000,000"
    },
    {
        id: 40,
        address: "0x6aBa5C8f8870Ec63A30Ff321F742149a19113fcf",
        initialEntryNat: "500,000,000"
    },
    {
        id: 41,
        address: "0xec73ec40425219a601fAA28c408973A4151a990f",
        initialEntryNat: "500,000,000"
    },
    {
        id: 42,
        address: "0x2a53aFC8b991aBBC445EC46c07E80b1a957C9662",
        initialEntryNat: "500,000,000"
    },
    {
        id: 44,
        address: "0xC3E98AF398F23C7aC3BDda1Ef6A1FEDAF4f1135B",
        initialEntryNat: "500,000,000"
    },
    {
        id: 45,
        address: "0x0BA52f5166f15Fb95042C33D75e4063188a39c7E",
        initialEntryNat: "500,000,000"
    },
    {
        id: 46,
        address: "0xbCbf18F795D228a7907affcea3b9d70906D9EF47",
        initialEntryNat: "500,000,000"
    },
    {
        id: 47,
        address: "0x954dE0fAe7228Ad71a180FaB83E9B958dbF0fC02",
        initialEntryNat: "500,000,000"
    },
    {
        id: 48,
        address: "0x3eB8c610a9F15760f44CCEf8C17A72b3e86d2cdb",
        initialEntryNat: "500,000,000"
    },
    {
        id: 49,
        address: "0x16413235C65e99335951565347909FD7F23cd342",
        initialEntryNat: "500,000,000"
    },
    {
        id: 50,
        address: "0xE59c44447EE92aAEe6AF9F5dA52767C445D17272",
        initialEntryNat: "500,000,000"
    },
    {
        id: 51,
        address: "0xB770bBB4f818751082976CAA17bEa6A05Ce1Dd4e",
        initialEntryNat: "500,000,000"
    },
    {
        id: 52,
        address: "0x56359EFfDF4c648A3E696bd36a1dBCA6dd2ec54c",
        initialEntryNat: "500,000,000"
    },
    {
        id: 53,
        address: "0x789c29183452a587f1a5268908ad2A7479425C1B",
        initialEntryNat: "500,000,000"
    },
    {
        id: 54,
        address: "0xcb61A3800bFD975Df2Fd0c3D2238F9eA9736e088",
        initialEntryNat: "500,000,000"
    },
    {
        id: 55,
        address: "0xBE32DACDaDDE5AE87Bc41DB388283147CED10706",
        initialEntryNat: "500,000,000"
    },
    {
        id: 56,
        address: "0xdfa74Ee0A47743B544D6450918Fab56143cA50E0",
        initialEntryNat: "500,000,000"
    },
    {
        id: 57,
        address: "0x96bF57a27C56a5C1098E9a1bD77FB9A765286Ae9",
        initialEntryNat: "500,000,000"
    },
    {
        id: 58,
        address: "0x5fF689f0c90925730206Fb085085599c402B415E",
        initialEntryNat: "500,000,000"
    },
    {
        id: 59,
        address: "0xd25b927b94F09D03D53b5Bb80E26f6220654202b",
        initialEntryNat: "500,000,000"
    },
    {
        id: 60,
        address: "0xeaf6a1477f5fcc1D5076B75d4de29d6A83fd48A6",
        initialEntryNat: "500,000,000"
    },
    {
        id: 61,
        address: "0x3C945afe9B975afC773CE092b493A8AAAcbd3320",
        initialEntryNat: "500,000,000"
    },
    {
        id: 62,
        address: "0xa80Da52630406A720C34fB68308487EBf088C478",
        initialEntryNat: "500,000,000"
    },
    {
        id: 63,
        address: "0x236F6959fEBae430b8Caf3c8eDd208A18276d4e5",
        initialEntryNat: "500,000,000"
    },
    {
        id: 64,
        address: "0x95D074024Ca18B432ED55b1149Bf8C9ff4b9eCAA",
        initialEntryNat: "500,000,000"
    },
    {
        id: 65,
        address: "0x6cab54cd753C463Bad34febE341e31CF3e854F5a",
        initialEntryNat: "500,000,000"
    },
    {
        id: 66,
        address: "0xb706eFA1F4f42a7010CCc5C7597D757575d973Db",
        initialEntryNat: "500,000,000"
    },
    {
        id: 67,
        address: "0x049b73e9683F9A52A03666d69a3F7e9378b0DA95",
        initialEntryNat: "500,000,000"
    },
    {
        id: 68,
        address: "0xca67Fa752E2707C4656c3E99a15fE3cf2FB1FFC4",
        initialEntryNat: "500,000,000"
    },
//////
    {
        id: 70,
        address: "0xf2423b39664A742608543A7DC5fae4a80A3eCb67",
        initialEntryNat: "1,000,000,000"
    },
    {
        id: 71,
        address: "0x3Cca008b4C57a5C2A79Ee8fE11Cf9D67dB0A3f79",
        initialEntryNat: "1,000,000,000"
    },
    {
        id: 72,
        address: "0x2258e7Ad1D8AC70FAB053CF59c027960e94DB7d1",
        initialEntryNat: "1,000,000,000"
    },
    {
        id: 73,
        address: "0x305811ECf33939b795F7b4595e926C8211058572",
        initialEntryNat: "1,000,000,000"
    },
    {
        id: 74,
        address: "0xBA293E5B8caFADe5ccEEa191Cbd3e0E869aA4931",
        initialEntryNat: "800,000,000"
    },
    {
        id: 75,
        address: "0x8165A514054101643a5170e60bcB5d6E79FF34B9",
        initialEntryNat: "1,000,000,000"
    },
    {
        id: 76,
        address: "0x3AA8EefC6f3a42AB2cbA98FEA39397cca297B18b",
        initialEntryNat: "1,000,000,000"
    },
///
    {
        id: 77,
        address: "0x6c7f7757E8587E4068B8Cb9f713852eF2Ae3abaf",
        initialEntryNat: "225,000,000"
    },
    {
        id: 78,
        address: "0xc506a2E354BC10649907a2086dAE2BEED3E760fE",
        initialEntryNat: "225,000,000"
    },
    {
        id: 79,
        address: "0xff71960A8a2597fbD18F81A79D5171CBf27C5665",
        initialEntryNat: "350,000,000"
    },
    {
        id: 80,
        address: "0xc9F314887750169424bd78770ccfd5AAC87A4b5F",
        initialEntryNat: "350,000,000"
    },
    {
        id: 81,
        address: "0x67f467CdbEe74631F516607BEBD145789B2C2220",
        initialEntryNat: "350,000,000"
    },
////    
    {
        id: 82,
        address: "0x4598A6c05910ab914F0CbAAca1911Cd337d10D29",
        initialEntryNat: "15,000"
    },
    {
        id: 83,
        address: "0x785a3983B5FDEa45e1cc49a41Cd38b5b00687e97",
        initialEntryNat: "1,000,000"
    },
//////
]
