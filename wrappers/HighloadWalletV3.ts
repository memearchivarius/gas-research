import {
    Address,
    beginCell,
    Cell,
    Contract,
    contractAddress,
    ContractProvider,
    internal as internal_relaxed,
    MessageRelaxed,
    OutAction,
    OutActionSendMsg,
    Sender,
    SendMode,
    storeMessageRelaxed,
    storeOutList,
    toNano
} from '@ton/core';
import {sign} from "@ton/crypto";
import {HighloadQueryId} from "./HighloadQueryId";

const OP_INTERNAL_TRANSFER = 0xae42e5a4;

export type HighloadWalletV3Config = {
    publicKey: Buffer,
    subwalletId: number,
    timeout: number
};


export const TIMESTAMP_SIZE = 64;
export const TIMEOUT_SIZE = 22;

export function highloadWalletV3ConfigToCell(config: HighloadWalletV3Config): Cell {
    return beginCell()
        .storeBuffer(config.publicKey)
        .storeUint(config.subwalletId, 32)
        .storeUint(0, 1 + 1 + TIMESTAMP_SIZE)
        .storeUint(config.timeout, TIMEOUT_SIZE)
        .endCell();
}

/**
 * Builds a signed external body for Highload Wallet V3.
 * This is the core function for creating authenticated external messages.
 * 
 * @param opts Configuration for the external body
 * @returns Cell containing the signed message ready to be sent externally
 */
export function buildSignedExternalBody(opts: {
    subwalletId: number;
    mode: number;
    queryId: bigint;
    createdAt: number;
    timeout: number;
    message: MessageRelaxed | Cell;
    secretKey: Buffer;
}): Cell {
    const messageCell = opts.message instanceof Cell
        ? opts.message
        : beginCell().store(storeMessageRelaxed(opts.message)).endCell();

    const messageInner = beginCell()
        .storeUint(opts.subwalletId, 32)
        .storeRef(messageCell)
        .storeUint(opts.mode, 8)
        .storeUint(opts.queryId, 23)
        .storeUint(opts.createdAt, TIMESTAMP_SIZE)
        .storeUint(opts.timeout, TIMEOUT_SIZE)
        .endCell();

    return beginCell()
        .storeBuffer(sign(messageInner.hash(), opts.secretKey))
        .storeRef(messageInner)
        .endCell();
}

/**
 * Creates a batch message for internal transfer.
 * This is used when sending multiple actions in a single transaction.
 * 
 * @param opts Batch message configuration
 * @returns MessageRelaxed ready to be sent as internal message
 */
export function createBatchMessage(opts: {
    actions: OutAction[];
    value: bigint;
    queryId: HighloadQueryId;
}): MessageRelaxed {
    return internal_relaxed({
        to: Address.parse('0:0'), // Will be replaced with self-address during send
        value: opts.value,
        body: beginCell()
            .storeUint(OP_INTERNAL_TRANSFER, 32)
            .storeUint(opts.queryId.getQueryId(), 64)
            .storeRef(packOutActions(opts.actions))
            .endCell()
    });
}

/**
 * Packs actions into a cell for sending.
 * Max 254 actions per cell without recursion.
 * 
 * @param actions Array of OutAction to pack
 * @returns Cell containing packed actions
 */
export function packOutActions(actions: OutAction[]): Cell {
    if (actions.length > 254) {
        throw new Error('Max 254 actions supported without recursion. Use packActions method for automatic recursive batching.');
    }
    const b = beginCell();
    storeOutList(actions)(b);
    return b.endCell();
}

export class HighloadWalletV3 implements Contract {

    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {
    }

    static createFromAddress(address: Address) {
        return new HighloadWalletV3(address);
    }

    static createFromConfig(config: HighloadWalletV3Config, code: Cell, workchain = 0) {
        const data = highloadWalletV3ConfigToCell(config);
        const init = {code, data};
        return new HighloadWalletV3(contractAddress(workchain, init), init);
    }

    /**
     * Static helper to build signed external body without needing a contract instance.
     * Useful for test scenarios where you want explicit control over message construction.
     */
    static buildSignedExternalBody(opts: {
        subwalletId: number;
        mode: number;
        queryId: bigint;
        createdAt: number;
        timeout: number;
        message: MessageRelaxed | Cell;
        secretKey: Buffer;
    }): Cell {
        return buildSignedExternalBody(opts);
    }

    /**
     * Static helper to pack actions into a cell.
     * Max 254 actions per cell without recursion.
     */
    static packOutActions(actions: OutAction[]): Cell {
        return packOutActions(actions);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            bounce: false,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    async sendExternalMessage(
        provider: ContractProvider,
        secretKey: Buffer,
        opts: {
            message: MessageRelaxed | Cell,
            mode: number,
            query_id: bigint | HighloadQueryId,
            createdAt: number,
            subwalletId: number,
            timeout: number,
        }
    ) {
        const queryId = (opts.query_id instanceof HighloadQueryId) ? opts.query_id.getQueryId() : opts.query_id;
        const body = buildSignedExternalBody({
            subwalletId: opts.subwalletId,
            mode: opts.mode,
            queryId,
            createdAt: opts.createdAt,
            timeout: opts.timeout,
            message: opts.message,
            secretKey
        });

        await provider.external(body);
    }

    async sendBatch(provider: ContractProvider, secretKey: Buffer, messages: OutActionSendMsg[], subwallet: number, query_id: HighloadQueryId, timeout: number, value: bigint, sendMode: SendMode, createdAt?: number) {
        if (createdAt == undefined) {
            createdAt = Math.floor(Date.now() / 1000) - 60;
        }
        const batchMessage = this.packActions(messages, value, query_id);
        return await this.sendExternalMessage(provider, secretKey, {
            message: batchMessage,
            mode: sendMode,
            query_id: query_id,
            createdAt: createdAt,
            subwalletId: subwallet,
            timeout: timeout
        });
    }

    static createInternalTransferBody(opts: {
        actions: OutAction[] | Cell,
        queryId: HighloadQueryId,
    }) {
        let actionsCell: Cell;
        if (opts.actions instanceof Cell) {
            actionsCell = opts.actions;
        } else {
            if (opts.actions.length > 254) {
                throw TypeError("Max allowed action count is 254. Use packActions instead.");
            }
            const actionsBuilder = beginCell();
            storeOutList(opts.actions)(actionsBuilder);
            actionsCell = actionsBuilder.endCell();
        }
        return beginCell().storeUint(OP_INTERNAL_TRANSFER, 32)
            .storeUint(opts.queryId.getQueryId(), 64)
            .storeRef(actionsCell)
            .endCell();


    }

    createInternalTransfer(opts: {
        actions: OutAction[] | Cell
        queryId: HighloadQueryId,
        value: bigint
    }) {

        return internal_relaxed({
            to: this.address,
            value: opts.value,
            body: HighloadWalletV3.createInternalTransferBody(opts)
        });
    }

    packActions(messages: OutAction[], value: bigint = toNano('1'), query_id: HighloadQueryId) {
        let batch: OutAction[];
        if (messages.length > 254) {
            batch = messages.slice(0, 253);
            batch.push({
                type: 'sendMsg',
                mode: value > 0n ? SendMode.PAY_GAS_SEPARATELY : SendMode.CARRY_ALL_REMAINING_BALANCE,
                outMsg: this.packActions(messages.slice(253), value, query_id)
            });
        } else {
            batch = messages;
        }
        return this.createInternalTransfer({
            actions: batch,
            queryId: query_id,
            value
        });
    }


    async getPublicKey(provider: ContractProvider): Promise<Buffer> {
        const res = (await provider.get('get_public_key', [])).stack;
        const pubKeyU = res.readBigNumber();
        return Buffer.from(pubKeyU.toString(16).padStart(32 * 2, '0'), 'hex');
    }

    async getSubwalletId(provider: ContractProvider): Promise<number> {
        const res = (await provider.get('get_subwallet_id', [])).stack;
        return res.readNumber();
    }

    async getTimeout(provider: ContractProvider): Promise<number> {
        const res = (await provider.get('get_timeout', [])).stack;
        return res.readNumber();
    }

    async getLastCleaned(provider: ContractProvider): Promise<number> {
        const res = (await provider.get('get_last_clean_time', [])).stack;
        return res.readNumber();
    }

    async getProcessed(provider: ContractProvider, queryId: HighloadQueryId, needClean = true): Promise<boolean> {
        const res = (await provider.get('processed?', [{'type': 'int', 'value': queryId.getQueryId()}, {
            'type': 'int',
            'value': needClean ? -1n : 0n
        }])).stack;
        return res.readBoolean();
    }
}
