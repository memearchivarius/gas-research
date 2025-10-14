import {
    Address,
    beginCell,
    Cell,
    Contract,
    contractAddress,
    ContractProvider,
    Sender,
    SendMode,
    Dictionary,
} from '@ton/core';

export type WalletV5Config = {
    signatureAllowed: boolean;
    seqno: number;
    walletId: number;
    publicKey: Buffer;
    extensions?: Dictionary<bigint, bigint>;
};

export function walletV5ConfigToCell(config: WalletV5Config): Cell {
    return beginCell()
        .storeBit(config.signatureAllowed)
        .storeUint(config.seqno, 32)
        .storeUint(config.walletId, 32)
        .storeBuffer(config.publicKey)
        .storeDict(config.extensions)
        .endCell();
}

export class WalletV5 implements Contract {
    constructor(
        readonly address: Address,
        readonly init?: { code: Cell; data: Cell }
    ) {}

    static createFromConfig(config: WalletV5Config, code: Cell, workchain = 0) {
        const data = walletV5ConfigToCell(config);
        const init = { code, data };
        return new WalletV5(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    async isSignatureAllowed(provider: ContractProvider) {
        const result = await provider.get('is_signature_allowed', []);
        return result.stack.readNumber();
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

    async getExtensions(provider: ContractProvider) {
        const result = await provider.get('get_extensions', []);
        return result.stack.readCellOpt();
    }
}
