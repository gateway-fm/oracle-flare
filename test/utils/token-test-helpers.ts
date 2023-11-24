import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { VPContract, VPToken } from "../../typechain";
import { newContract } from "./test-helpers";

const VPContractContract = artifacts.require("VPContract");

interface IISetVpContract {
    address: string;
    setReadVpContract(_vpContract: string, txDetails?: Truffle.TransactionDetails): Promise<any>;
    setWriteVpContract(_vpContract: string, txDetails?: Truffle.TransactionDetails): Promise<any>;
    vpContractInitialized(): Promise<boolean>;
}

export async function setDefaultVPContract(token: IISetVpContract, governance: string) {
    const replacement = await token.vpContractInitialized();
    const vpContract = await VPContractContract.new(token.address, replacement);
    await token.setWriteVpContract(vpContract.address, { from: governance });
    await token.setReadVpContract(vpContract.address, { from: governance });
}

export async function setDefaultVPContract_ethers(token: VPToken, signer: SignerWithAddress, governance: string = signer.address) {
    const replacement = await token.vpContractInitialized();
    const vpContract = await newContract<VPContract>("VPContract", signer, token.address, replacement);
    await token.setWriteVpContract(vpContract.address, { from: governance });
    await token.setReadVpContract(vpContract.address, { from: governance });
}
