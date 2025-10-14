import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode, Dictionary } from '@ton/core';

export type WalletV4Config = {
    seqno: number;
    subwalletId: number;
    publicKey: Buffer;
    plugins?: Dictionary<bigint, bigint>; // address hash -> empty
};

export function walletV4ConfigToCell(config: WalletV4Config): Cell {
    return beginCell()
        .storeUint(config.seqno, 32)
        .storeUint(config.subwalletId, 32)
        .storeBuffer(config.publicKey)
        .storeDict(config.plugins)
        .endCell();
}

export class WalletV4 implements Contract {
    constructor(
        readonly address: Address,
        readonly init?: { code: Cell; data: Cell }
    ) {}

    static createFromConfig(config: WalletV4Config, code: Cell, workchain = 0) {
        const data = walletV4ConfigToCell(config);
        const init = { code, data };
        return new WalletV4(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    async getSeqno(provider: ContractProvider) {
        const result = await provider.get('seqno', []);
        return result.stack.readNumber();
    }

    async getSubwalletId(provider: ContractProvider) {
        const result = await provider.get('get_subwallet_id', []);
        return result.stack.readNumber();
    }

    async getPublicKey(provider: ContractProvider) {
        const result = await provider.get('get_public_key', []);
        return result.stack.readNumber();
    }
}
