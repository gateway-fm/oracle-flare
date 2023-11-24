import { BigNumber } from "ethers";
import { GenesisAccount } from "../genesis-lib";

// 15 billion SGB
const TARGET_TOTAL_SUPPLY = "15,000,000,000.000 000 000 000 000 000" 
export const songbirdTargetTotalSupply = BigNumber.from(TARGET_TOTAL_SUPPLY.replace(/[., ]/g, ""));

// THE AUTHORITATIVE LIST OF ADDRESSES AND BALANCES
// Should match the line numbers in Gdocs
export const songbirdGenesisAccountDefinitions: GenesisAccount[] = [
    {
        id: 2,
        address: "0xa7235ad1532c178603B457E9671e32eD61ed8372",
    },
    {
        id: 3,
        address: "0x6699E078e90d646E02C2a2976a738C34dC7bF0Bf",
    },
    {
        id: 4,
        address: "0xFb6148ea2c87F424e8F3DED3567cfd7b179C1b6f",
        initialEntryWei: "378,407,966.689 868 568 810 000 000"
    },
    {
        id: 5,
        address: "0x780B144e034341a970c2e4F93f2f6Cd82E8DFadc",
        initialEntryNat: "478,125,000"
    },
    {
        id: 6,
        address: "0xd197F63CEefDaFaAF771a722c0A9cce771912b41",
        initialEntryWei: "796,452,292.290 750 000 000 000 000"
    },
    {
        id: 7,
        address: "0x10fc0865d11eebc61eA23511183305EE18b77939",
        initialEntryWei: "796,452,292.290 750 000 000 000 000"
    },
    {
        id: 8,
        address: "0xdde49343a309941ca44ea257bA3c897B47B6b1D4",
        initialEntryWei: "796,452,292.290 750 000 000 000 000"
    },
    {
        id: 9,
        address: "0x8078637A052E39A2Fc8833878D70Ae41f7310290",
        initialEntryWei: "796,452,292.290 750 000 000 000 000"
    },
    {
        id: 10,
        address: "0xC6Da0f9C2c2542cC8860f60d6b160ce6573C5F60",
        initialEntryNat: "375,000,000"
    },
    {
        id: 11,
        address: "0xb2718a5EB8C68399326eD4c358A26cB1DDAE27e1",
        initialEntryNat: "375,000,000"
    },
    ////
    {
        id: 12,
        address: "0x806dfa5ceeAA6249B1ab038eBd01Df315dd45485",
        initialEntryWei: "94,031,805.139 500 000 000 000 000"
    },
    {
        id: 13,
        address: "0x7B3283826833D9E204C3c7cbD39feF31227C9868",
        initialEntryWei: "94,031,805.139 500 000 000 000 000"
    },
    {
        id: 14,
        address: "0x0f71a5aa9B97A4a186604583CBbFfBAb3bd4dE0C",
        initialEntryWei: "94,031,805.139 500 000 000 000 000"
    },
    {
        id: 15,
        address: "0xBEb5Aafa635ec3D1C393f2bB599383bB3C854Bdc",
        initialEntryWei: "94,031,805.139 500 000 000 000 000"
    },
    {
        id: 16,
        address: "0xe9B8ED5c3cF88415DBe50FaF94F0b0302d4c329e",
        initialEntryWei: "94,031,805.139 500 000 000 000 000"
    },
    {
        id: 17,
        address: "0x54a5F325103D8113686C62FF73C3251E064247bB",
        initialEntryWei: "94,031,805.139 500 000 000 000 000"
    },
    ////
    {
        id: 18,
        address: "0x4190123e3bf34276d601B877dC4CeFaB3bbE667f",
        initialEntryNat: "45,000,000"
    },
    {
        id: 19,
        address: "0x706db31fdbd1D13B2678826c5d30C20a0B5AE097",
        initialEntryNat: "45,000,000"
    },
    {
        id: 20,
        address: "0xaE4644F8E49B031b8170Ec6C9bB0C24501A69C2f",
        initialEntryNat: "45,000,000"
    },
    {
        id: 21,
        address: "0xd5E575E2B1F61Fd5e9F8D828feb8F53C554Eb998",
        initialEntryNat: "7,500,000"
    },
    {
        id: 22,
        address: "0xf763dd0bB23e580097f69D17e2a60b04EB605147",
        initialEntryNat: "37,500,000"
    },
    {
        id: 23,
        address: "0x009A4624646501fe3cdE44B8CD1A435D81aA9186",
        initialEntryNat: "37,500,000"
    },
    {
        id: 24,
        address: "0xE5D4F5a40097128b826bE833c7c02F47a8D99a55",
        initialEntryNat: "7,500,000"
    },
    {
        id: 25,
        address: "0xE8c27Ec6A03612e21c42f5616891b6FFC416b1D2",
        initialEntryNat: "37,500,000"
    },
    {
        id: 26,
        address: "0xc5DAE0d309EFa1C5D5C90bBa773Dc9e9176fE956",
        initialEntryNat: "37,500,000"
    },
    {
        id: 27,
        address: "0x040dd8bD2F7e1ad893eAa4d0837fE210373fF190",
        initialEntryNat: "65,000,000"
    },
    {
        id: 28,
        address: "0x399Ff6428D4e616BE8ce21Ee5beC9d344185e8D9",
        initialEntryNat: "40,000,000"
    },
    {
        id: 29,
        address: "0x489506707A68bEdAd0B62c57e3226506b54a9364",
        initialEntryNat: "40,000,000"
    },
    {
        id: 30,
        address: "0x4AC175dcf8355A5Ed545a7178715c542cF43B9bB",
        initialEntryNat: "40,000,000"
    },
    {
        id: 31,
        address: "0x544DF305ef3ef012108D770B259720E7Ef6360Bd",
        initialEntryNat: "40,000,000"
    },
    {
        id: 34,
        address: "0x42a7bD36593c75c981C7201d2E7974133782f0e0",
        initialEntryWei: "3,900,056,276.934 594 667 740 000 000"
    },
    {
        id: 35,
        address: "0x493044fbBAA7F9F78379864fA88aCcaFf6A7586e",
        initialEntryNat: "1500"
    },
]
