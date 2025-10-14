import { Blockchain, SandboxContract, TreasuryContract, printTransactionFees } from '@ton/sandbox';
import { toNano, internal, SendMode, beginCell } from '@ton/core';
import { WalletContractV5R1 } from '@ton/ton';
import { KeyPair, mnemonicToPrivateKey } from '@ton/crypto';
import '@ton/test-utils';
import { activateTVM11 } from './helpers/blockchain-config';
import { GasLogAndSave } from './helpers/gas-logger';

/**
 * Gas measurement tests for Wallet V5R1
 * Uses ready-made WalletContractV5R1 class from @ton/ton
 */
describe('Wallet V5R1 Gas Measurement', () => {
    let GAS_LOG: GasLogAndSave;
    let blockchain: Blockchain;
    let receiver: SandboxContract<TreasuryContract>;
    let keyPair: KeyPair;

    beforeAll(async () => {
        console.log('Using official @ton/ton Wallet V5R1 wrapper');
        GAS_LOG = new GasLogAndSave('WalletV5');
    });

    afterAll(() => {
        GAS_LOG.saveCurrentRunAfterAll();
    });

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        activateTVM11(blockchain);

        receiver = await blockchain.treasury('receiver');

        // Generate test keypair
        const mnemonics = 'test test test test test test test test test test test test test test test test test test test test test test test test'.split(' ');
        keyPair = await mnemonicToPrivateKey(mnemonics);
    });

    it('[bench] V5R1: simple transfer without comment', async () => {
        // Create Wallet V5R1 using ready-made class
        const wallet = blockchain.openContract(
            WalletContractV5R1.create({
                publicKey: keyPair.publicKey,
                workchain: 0,
                walletId: { networkGlobalId: -239 }
            })
        );

        console.log('\n========================================');
        console.log('  Wallet V5R1: Simple Transfer');
        console.log('========================================\n');
        console.log(`Wallet address: ${wallet.address.toString()}`);

        // Libraries are already configured in beforeEach for full on-chain parity

        // Deploy and fund wallet via internal message with stateInit
        const deployer = await blockchain.treasury('deployer');
        await deployer.send({
            to: wallet.address,
            value: toNano('10'), // Enough to cover forward fees
            init: wallet.init, // This will deploy the contract!
        });

        console.log('[OK] Wallet deployed and funded\n');

        // Check balance
        const balance = await wallet.getBalance();
        console.log(`Wallet balance: ${Number(balance) / 1000000000} TON`);

        // Get seqno
        const seqno = await wallet.getSeqno();
        console.log(`Current seqno: ${seqno}\n`);

        // Create transfer message
        const transfer = await wallet.createTransfer({
            seqno: seqno,
            secretKey: keyPair.secretKey,
            messages: [
                internal({
                    to: receiver.address,
                    value: toNano('0.5'),
                    bounce: false,
                })
            ],
            sendMode: SendMode.PAY_GAS_SEPARATELY,
        });

        console.log('Sending external message...\n');

        // Send external message via sandbox
        // Important: add init only if seqno === 0 (first transaction)
        const result = await blockchain.sendMessage({
            info: {
                type: 'external-in',
                dest: wallet.address,
                importFee: 0n, // sandbox doesn't charge import fee
            },
            init: seqno === 0 ? wallet.init : undefined,
            body: transfer,
        });

        printTransactionFees(result.transactions);
        
        // Log detailed metrics
        const tx = result.transactions.find(t => t.inMessage?.info.type === 'external-in');
        if (tx) {
            GAS_LOG.rememberGas('simple_transfer', tx, blockchain);
        }

        expect(result.transactions).toHaveLength(2); // external + internal
        
        // Check that receiver got funds
        const receiverBalance = await receiver.getBalance();
        expect(receiverBalance).toBeGreaterThan(0n);
    });

    it('[bench] V5R1: transfer with comment', async () => {
        const wallet = blockchain.openContract(
            WalletContractV5R1.create({
                publicKey: keyPair.publicKey,
                workchain: 0,
            })
        );

        // Deploy and fund wallet
        const deployer = await blockchain.treasury('deployer');
        await deployer.send({
            to: wallet.address,
            value: toNano('10'),
            init: wallet.init, // Deploy contract
        });

        const seqno = await wallet.getSeqno();
        const comment = 'Hello from V5!';

        console.log('\n========================================');
        console.log('  Wallet V5R1: Transfer with Comment');
        console.log('========================================');
        console.log(`Comment: "${comment}"`);
        console.log(`Length: ${comment.length} chars (${Buffer.from(comment).length} bytes)\n`);

        // Create transfer with comment
        const transfer = await wallet.createTransfer({
            seqno: seqno,
            secretKey: keyPair.secretKey,
            messages: [
                internal({
                    to: receiver.address,
                    value: toNano('0.5'),
                    bounce: false,
                    body: comment, // Comment is added as a string
                })
            ],
            sendMode: SendMode.PAY_GAS_SEPARATELY,
        });

        const result = await blockchain.sendMessage({
            info: {
                type: 'external-in',
                dest: wallet.address,
                importFee: 0n,
            },
            // init not needed anymore - contract already deployed!
            body: transfer,
        });

        printTransactionFees(result.transactions);
        
        // Log detailed metrics
        const tx = result.transactions.find(t => t.inMessage?.info.type === 'external-in');
        if (tx) {
            GAS_LOG.rememberGas('transfer_with_comment', tx, blockchain);
        }

        expect(result.transactions).toHaveLength(2);
    });

    it('[bench] V5R1: batch transfer (4 messages)', async () => {
        const wallet = blockchain.openContract(
            WalletContractV5R1.create({
                publicKey: keyPair.publicKey,
                workchain: 0,
            })
        );

        // Deploy and fund wallet
        const deployer = await blockchain.treasury('deployer');
        await deployer.send({
            to: wallet.address,
            value: toNano('10'),
            init: wallet.init, // Deploy contract
        });

        const seqno = await wallet.getSeqno();

        console.log('\n========================================');
        console.log('  Wallet V5R1: Batch Transfer (4 msgs)');
        console.log('========================================\n');

        // Create 4 messages with unique comments to avoid deduplication (same structure as V3)
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

        // Create batch transfer - V5 supports up to 255 messages!
        const transfer = await wallet.createTransfer({
            seqno: seqno,
            secretKey: keyPair.secretKey,
            messages,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
        });

        const result = await blockchain.sendMessage({
            info: {
                type: 'external-in',
                dest: wallet.address,
                importFee: 0n,
            },
            // init not needed anymore - contract already deployed!
            body: transfer,
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

        // Should be 5 transactions: 1 external + 4 internal
        expect(result.transactions).toHaveLength(5);
    });

    it('[bench] V5R1: batch transfer (12 messages)', async () => {
        const walletV5 = blockchain.openContract(
            WalletContractV5R1.create({
                publicKey: keyPair.publicKey,
                workchain: 0,
            })
        );

        // Deploy wallet
        const deployer = await blockchain.treasury('deployer');
        await deployer.send({
            to: walletV5.address,
            value: toNano('20'),
            init: walletV5.init,
        });

        const seqno = await walletV5.getSeqno();

        // Create 12 messages with unique comments to avoid deduplication
        const messages = Array.from({ length: 12 }, (_, i) =>
            internal({
                to: receiver.address,
                value: toNano('0.1'),
                bounce: false,
                body: beginCell()
                    .storeUint(0, 32) // text comment opcode
                    .storeStringTail(`${i + 1}`) // unique comment: "1", "2", "3", ..., "12"
                    .endCell(),
            })
        );

        const transfer = await walletV5.createTransfer({
            seqno,
            secretKey: keyPair.secretKey,
            messages,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
        });

        console.log('\n========================================');
        console.log('  Wallet V5: Batch Transfer (12 msgs)');
        console.log('========================================\n');

        const result = await blockchain.sendMessage({
            info: {
                type: 'external-in',
                dest: walletV5.address,
                importFee: 0n,
            },
            init: undefined,
            body: transfer,
        });

        printTransactionFees(result.transactions);

        // Log detailed metrics
        const tx = result.transactions.find(t => t.inMessage?.info.type === 'external-in');
        if (tx) {
            GAS_LOG.rememberGas('batch_12_messages', tx, blockchain);

            const gasUsed = tx.description.type === 'generic' && tx.description.computePhase.type === 'vm'
                ? Number(tx.description.computePhase.gasUsed)
                : 0;

            console.log(`\n💡 Gas per message: ${(gasUsed / 12).toFixed(0)} gas (avg)`);

            // Calculate efficiency compared to V3
            const v3SingleGas = 3002;
            const v5PerMsgGas = gasUsed / 12;
            const efficiency = ((v3SingleGas - v5PerMsgGas) / v3SingleGas * 100).toFixed(1);

            console.log('\n=== Efficiency Analysis ===');
            console.log(`   V3 single transfer:     ${v3SingleGas} gas`);
            console.log(`   V5 per message:         ${v5PerMsgGas.toFixed(0)} gas`);
            console.log(`   Savings per message:    ${efficiency}%`);
            console.log(`   Total savings (12 msg): ${(v3SingleGas * 12 - gasUsed).toFixed(0)} gas\n`);
        }

        // Verify all transactions success (all to the same receiver)
        expect(result.transactions).toHaveTransaction({
            from: walletV5.address,
            to: receiver.address,
            success: true,
        });
    });
});