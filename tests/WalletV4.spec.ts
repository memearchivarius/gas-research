import { Blockchain, SandboxContract, TreasuryContract, printTransactionFees } from '@ton/sandbox';
import { toNano, beginCell, internal, SendMode } from '@ton/core';
import { WalletContractV4 } from '@ton/ton';
import { KeyPair, mnemonicToPrivateKey } from '@ton/crypto';
import '@ton/test-utils';
import { activateTVM11 } from './helpers/blockchain-config';
import { GasLogAndSave } from './helpers/gas-logger';

/**
 * Gas measurement tests for Wallet V4
 */
describe('Wallet V4 Gas Measurement', () => {
    let GAS_LOG: GasLogAndSave;
    let blockchain: Blockchain;
    let receiver: SandboxContract<TreasuryContract>;
    let keyPair: KeyPair;

    beforeAll(async () => {
        console.log('Using official @ton/ton Wallet V4 wrapper (no local compile)');
        GAS_LOG = new GasLogAndSave('WalletV4');
    });

    afterAll(() => {
        GAS_LOG.saveCurrentRunAfterAll();
    });

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        activateTVM11(blockchain);
        receiver = await blockchain.treasury('receiver');
        
        const mnemonics = 'burst moral give fun rain air sample time ramp chat piano auction pride steel material despair client field gift hello similar degree fame almost'.split(' ');
        keyPair = await mnemonicToPrivateKey(mnemonics);
    });

    it('[bench] V4: simple transfer without comment', async () => {
        const walletV4 = blockchain.openContract(
            WalletContractV4.create({
                publicKey: keyPair.publicKey,
                workchain: 0,
            })
        );

        const deployer = await blockchain.treasury('deployer');
        await deployer.send({ to: walletV4.address, value: toNano('1'), init: walletV4.init });

        const seqno = await walletV4.getSeqno();

        const result = await blockchain.sendMessage({
            info: { type: 'external-in', dest: walletV4.address, importFee: 0n },
            body: await walletV4.createTransfer({
                seqno,
                secretKey: keyPair.secretKey,
                sendMode: SendMode.PAY_GAS_SEPARATELY,
                messages: [internal({ to: receiver.address, value: toNano('0.5'), bounce: false, body: beginCell().endCell() })],
            }),
        });

        printTransactionFees(result.transactions);
        
        // Log detailed metrics
        const tx = result.transactions.find(t => t.inMessage?.info.type === 'external-in');
        if (tx) {
            GAS_LOG.rememberGas('simple_transfer', tx, blockchain);
        }
        
        expect(result.transactions).toHaveTransaction({ from: walletV4.address, to: receiver.address, success: true });
    });

    it('[bench] V4: transfer with comment', async () => {
        const walletV4 = blockchain.openContract(
            WalletContractV4.create({
                publicKey: keyPair.publicKey,
                workchain: 0,
            })
        );

        const deployer = await blockchain.treasury('deployer');
        await deployer.send({ to: walletV4.address, value: toNano('1'), init: walletV4.init });

        const seqno = await walletV4.getSeqno();
        const comment = 'Hello from V4!';
        const commentCell = beginCell().storeUint(0, 32).storeStringTail(comment).endCell();

        const result = await blockchain.sendMessage({
            info: { type: 'external-in', dest: walletV4.address, importFee: 0n },
            body: await walletV4.createTransfer({
                seqno,
                secretKey: keyPair.secretKey,
                sendMode: SendMode.PAY_GAS_SEPARATELY,
                messages: [internal({ to: receiver.address, value: toNano('0.5'), bounce: false, body: commentCell })],
            }),
        });

        printTransactionFees(result.transactions);
        
        // Log detailed metrics
        const tx = result.transactions.find(t => t.inMessage?.info.type === 'external-in');
        if (tx) {
            GAS_LOG.rememberGas('transfer_with_comment', tx, blockchain);
        }
        
        expect(result.transactions).toHaveTransaction({ from: walletV4.address, to: receiver.address, success: true });
    });

    it('[bench] V4: batch transfer (4 messages)', async () => {
        const walletV4 = blockchain.openContract(
            WalletContractV4.create({
                publicKey: keyPair.publicKey,
                workchain: 0,
            })
        );

        const deployer = await blockchain.treasury('deployer');
        await deployer.send({ to: walletV4.address, value: toNano('1'), init: walletV4.init });

        const seqno = await walletV4.getSeqno();

        // Create 4 messages with unique comments to avoid deduplication
        const messages = Array.from({ length: 4 }, (_, i) =>
            internal({
                to: receiver.address,
                value: toNano('0.01'),
                bounce: false,
                body: beginCell()
                    .storeUint(0, 32) // text comment opcode
                    .storeStringTail(`${i + 1}`) // unique comment: "1", "2", "3", "4"
                    .endCell(),
            })
        );

        console.log('\n========================================');
        console.log('  Wallet V4: Batch Transfer (4 msgs)');
        console.log('========================================\n');

        const result = await blockchain.sendMessage({
            info: { type: 'external-in', dest: walletV4.address, importFee: 0n },
            body: await walletV4.createTransfer({
                seqno,
                secretKey: keyPair.secretKey,
                sendMode: SendMode.PAY_GAS_SEPARATELY,
                messages,
            }),
        });

        printTransactionFees(result.transactions);

        // Log detailed metrics
        const tx = result.transactions.find(t => t.inMessage?.info.type === 'external-in');
        if (tx) {
            GAS_LOG.rememberGas('batch_4_messages', tx, blockchain);

            // Additional batch metrics
            const gasUsed = tx.description.type === 'generic' && tx.description.computePhase.type === 'vm'
                ? Number(tx.description.computePhase.gasUsed)
                : 0;
            console.log(`\n💡 Gas per message: ${(gasUsed / 4).toFixed(0)} gas (avg)\n`);
        }

        expect(result.transactions).toHaveTransaction({ from: walletV4.address, to: receiver.address, success: true });
    });
});