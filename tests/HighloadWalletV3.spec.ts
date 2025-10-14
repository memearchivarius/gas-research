import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { toNano, beginCell, Cell, internal, SendMode } from '@ton/core';
import { HighloadWalletV3 } from '../wrappers/HighloadWalletV3';
import { HighloadQueryId } from '../wrappers/HighloadQueryId';
import { KeyPair, mnemonicToPrivateKey } from '@ton/crypto';
import { myCompile } from './helpers/my-compile';
import { activateTVM11 } from './helpers/blockchain-config';
import { GasLogAndSave } from './helpers/gas-logger';
import '@ton/test-utils';

/**
 * Gas measurement tests for Highload Wallet V3
 * 
 * KEY INSIGHT: Highload V3 behavior differs based on action count:
 * - Single action: Executes directly from external message (no internal self-transfer)
 * - Multiple actions: Uses internal self-transfer to batch execute actions
 * 
 * For batch operations, we must aggregate gas from BOTH transactions:
 * 1. External-in transaction (signature verification, preliminary checks)
 * 2. Internal self-transfer (batch action execution)
 */
describe('Highload Wallet V3 Gas Measurement', () => {
    let GAS_LOG: GasLogAndSave;
    let blockchain: Blockchain;
    let receiver: SandboxContract<TreasuryContract>;
    let keyPair: KeyPair;
    let codeHighloadV3: Cell;

    const DEFAULT_TIMEOUT = 60 * 60; // 1 hour
    const DEFAULT_SUBWALLET = 0;
    
    // Use controlled timestamp to avoid run-to-run drift
    const CONTROLLED_TIMESTAMP = 1700000000; // Fixed timestamp for tests

    /**
     * Helper to create a controlled createdAt timestamp
     */
    function controlledTimestamp(): number {
        return CONTROLLED_TIMESTAMP;
    }

    /**
     * Helper to create a simple transfer message (no comment)
     */
    function createSimpleTransfer(to: any, value: bigint) {
        return internal({
            to: to.address,
            value,
            bounce: false,
            body: beginCell().endCell(),
        });
    }

    /**
     * Helper to create a transfer message with comment
     */
    function createTransferWithComment(to: any, value: bigint, comment: string) {
        return internal({
            to: to.address,
            value,
            bounce: false,
            body: beginCell()
                .storeUint(0, 32) // text comment opcode
                .storeStringTail(comment)
                .endCell(),
        });
    }

    /**
     * Helper to aggregate gas from multiple transactions
     * Critical for Highload V3: we must sum gas from both external and internal passes
     */
    function aggregateGasUsage(transactions: any[]): bigint {
        let totalGas = 0n;
        
        for (const tx of transactions) {
            if (tx.description.type === 'generic' && tx.description.computePhase.type === 'vm') {
                const gasUsed = tx.description.computePhase.gasUsed;
                totalGas += gasUsed;
            }
        }
        
        return totalGas;
    }

    /**
     * Helper to print detailed transaction breakdown
     */
    function printTransactionBreakdown(transactions: any[], label: string) {
        console.log(`\n========================================`);
        console.log(`  ${label}`);
        console.log(`========================================\n`);
        
        let totalGas = 0n;
        
        transactions.forEach((tx, idx) => {
            if (tx.description.type === 'generic' && tx.description.computePhase.type === 'vm') {
                const gasUsed = tx.description.computePhase.gasUsed;
                const gasFeesNano = tx.description.computePhase.gasFees;
                const totalFeesNano = tx.totalFees.coins;
                
                const msgType = tx.inMessage?.info.type || 'unknown';
                console.log(`Transaction ${idx + 1} (${msgType}):`);
                console.log(`  Gas used:     ${gasUsed.toString().padStart(10)} gas`);
                console.log(`  Compute fee:  ${gasFeesNano.toString().padStart(10)} nanoTON`);
                console.log(`  Total fee:    ${totalFeesNano.toString().padStart(10)} nanoTON`);
                
                totalGas += gasUsed;
            }
        });
        
        console.log(`\n${'='.repeat(40)}`);
        console.log(`TOTAL GAS (all VM passes): ${totalGas.toString().padStart(10)} gas`);
        console.log(`${'='.repeat(40)}\n`);
        
        return totalGas;
    }

    beforeAll(async () => {
        // Use myCompile instead of compile to get proper TVM config and fift output
        console.log('Compiling Highload Wallet V3...');
        codeHighloadV3 = await myCompile('HighloadWalletV3');
        console.log('[OK] Highload Wallet V3 compiled');
        
        // Initialize gas logger
        GAS_LOG = new GasLogAndSave('HighloadWalletV3');
        GAS_LOG.rememberBocSize('HighloadWalletV3', codeHighloadV3);
    });

    afterAll(() => {
        // Save gas metrics to bench-snapshots
        GAS_LOG.saveCurrentRunAfterAll();
    });

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        
        // CRITICAL: Activate TVM11 for parity with production environment
        activateTVM11(blockchain);
        
        // Optionally freeze blockchain time for deterministic tests
        blockchain.now = CONTROLLED_TIMESTAMP;
        
        receiver = await blockchain.treasury('receiver');
        
        // Generate test keypair (deterministic for consistent results)
        const mnemonics = 'test test test test test test test test test test test test test test test test test test test test test test test test'.split(' ');
        keyPair = await mnemonicToPrivateKey(mnemonics);
    });

    it('[bench] HighloadV3: simple transfer without comment', async () => {
        const highloadWallet = blockchain.openContract(
            HighloadWalletV3.createFromConfig({
                publicKey: keyPair.publicKey,
                subwalletId: DEFAULT_SUBWALLET,
                timeout: DEFAULT_TIMEOUT,
            }, codeHighloadV3)
        );

        // Deploy wallet
        const deployer = await blockchain.treasury('deployer');
        await highloadWallet.sendDeploy(deployer.getSender(), toNano('10'));

        const queryId = new HighloadQueryId();

        // Create simple transfer message using helper
        const transferMessage = createSimpleTransfer(receiver, toNano('0.5'));
        
        // Send transfer via external message
        const result = await highloadWallet.sendExternalMessage(keyPair.secretKey, {
            message: transferMessage,
            mode: SendMode.PAY_GAS_SEPARATELY,
            query_id: queryId,
            createdAt: controlledTimestamp(),
            subwalletId: DEFAULT_SUBWALLET,
            timeout: DEFAULT_TIMEOUT,
        });

        // Print detailed breakdown
        const totalGas = printTransactionBreakdown(
            result.transactions,
            'Highload V3: Simple Transfer'
        );

        // Verify we have at least 2 transactions (external + transfer to receiver)
        expect(result.transactions.length).toBeGreaterThanOrEqual(2);
        
        // Verify external transaction
        expect(result.transactions).toHaveTransaction({
            from: undefined,
            to: highloadWallet.address,
            success: true,
        });

        // Verify transfer to receiver
        expect(result.transactions).toHaveTransaction({
            from: highloadWallet.address,
            to: receiver.address,
            success: true,
        });

        // Log aggregated gas (for simple transfer, just the external transaction)
        GAS_LOG.rememberGas('simple_transfer', result.transactions[0], blockchain);
        
        // Assert reasonable gas range for simple single-action transfer
        // Note: Single actions execute directly, so gas is ~6200-6500
        expect(Number(totalGas)).toBeGreaterThan(6000);
        expect(Number(totalGas)).toBeLessThan(7000);
    });

    it('[bench] HighloadV3: transfer with comment', async () => {
        const highloadWallet = blockchain.openContract(
            HighloadWalletV3.createFromConfig({
                publicKey: keyPair.publicKey,
                subwalletId: DEFAULT_SUBWALLET,
                timeout: DEFAULT_TIMEOUT,
            }, codeHighloadV3)
        );

        // Deploy wallet
        const deployer = await blockchain.treasury('deployer');
        await highloadWallet.sendDeploy(deployer.getSender(), toNano('10'));

        const queryId = new HighloadQueryId();

        // Create transfer message with comment using helper
        const transferMessage = createTransferWithComment(receiver, toNano('0.5'), 'Test transfer');
        
        // Send transfer via external message
        const result = await highloadWallet.sendExternalMessage(keyPair.secretKey, {
            message: transferMessage,
            mode: SendMode.PAY_GAS_SEPARATELY,
            query_id: queryId,
            createdAt: controlledTimestamp(),
            subwalletId: DEFAULT_SUBWALLET,
            timeout: DEFAULT_TIMEOUT,
        });

        // Print detailed breakdown
        const totalGas = printTransactionBreakdown(
            result.transactions,
            'Highload V3: Transfer with Comment'
        );

        // Verify transactions
        expect(result.transactions.length).toBeGreaterThanOrEqual(2);
        
        expect(result.transactions).toHaveTransaction({
            from: highloadWallet.address,
            to: receiver.address,
            success: true,
        });

        // Log aggregated gas (for simple transfer, just the external transaction)
        GAS_LOG.rememberGas('transfer_with_comment', result.transactions[0], blockchain);
        
        // Assert reasonable gas range for single-action transfer with comment
        expect(Number(totalGas)).toBeGreaterThan(6000);
        expect(Number(totalGas)).toBeLessThan(7000);
    });

    it('[bench] HighloadV3: batch transfer (12 messages)', async () => {
        const highloadWallet = blockchain.openContract(
            HighloadWalletV3.createFromConfig({
                publicKey: keyPair.publicKey,
                subwalletId: DEFAULT_SUBWALLET,
                timeout: DEFAULT_TIMEOUT,
            }, codeHighloadV3)
        );

        // Deploy wallet
        const deployer = await blockchain.treasury('deployer');
        await highloadWallet.sendDeploy(deployer.getSender(), toNano('20'));

        const queryId = new HighloadQueryId();

        // Create batch of 12 messages with unique comments to avoid deduplication
        const messages = Array.from({ length: 12 }, (_, i) => ({
            type: 'sendMsg' as const,
            mode: SendMode.PAY_GAS_SEPARATELY,
            outMsg: createTransferWithComment(receiver, toNano('0.01'), `${i + 1}`),
        }));
        
        // Send batch via external message
        const result = await highloadWallet.sendBatch(
            keyPair.secretKey,
            messages,
            DEFAULT_SUBWALLET,
            queryId,
            DEFAULT_TIMEOUT,
            toNano('0.05'),
            SendMode.PAY_GAS_SEPARATELY,
            controlledTimestamp()
        );

        // Print detailed breakdown
        const totalGas = printTransactionBreakdown(
            result.transactions,
            'Highload V3: Batch Transfer (12 msgs)'
        );

        // Additional metrics for batch
        const avgGasPerMessage = Number(totalGas) / 12;
        console.log(`\n=== Batch Efficiency ===`);
        console.log(`Total gas:        ${totalGas.toString().padStart(10)} gas`);
        console.log(`Avg per message:  ${avgGasPerMessage.toFixed(0).padStart(10)} gas`);
        console.log(`Messages sent:    ${messages.length}`);
        
        // Compare to theoretical single-message cost
        const v3SingleGas = 3002;
        const efficiency = ((v3SingleGas - avgGasPerMessage) / v3SingleGas * 100).toFixed(1);
        console.log(`\n=== Comparison to V3 ===`);
        console.log(`V3 single transfer:     ${v3SingleGas} gas`);
        console.log(`Highload per message:   ${avgGasPerMessage.toFixed(0)} gas`);
        console.log(`Savings per message:    ${efficiency}%`);
        console.log(`Total savings (12 msg): ${(v3SingleGas * 12 - Number(totalGas)).toFixed(0)} gas\n`);

        // Verify transactions
        expect(result.transactions.length).toBeGreaterThanOrEqual(2);
        
        expect(result.transactions).toHaveTransaction({
            from: highloadWallet.address,
            to: receiver.address,
            success: true,
        });

        // Log aggregated gas - slice(0, 2) gets external + internal self-transfer
        GAS_LOG.rememberGas('batch_12_messages', result.transactions.slice(0, 2), blockchain);
        
        // Assert reasonable gas range for batch (more gas due to multiple actions)
        expect(Number(totalGas)).toBeGreaterThan(10000);
        expect(Number(totalGas)).toBeLessThan(20000);
    });

    it('[bench] HighloadV3: batch transfer (50 messages) - stress test', async () => {
        const highloadWallet = blockchain.openContract(
            HighloadWalletV3.createFromConfig({
                publicKey: keyPair.publicKey,
                subwalletId: DEFAULT_SUBWALLET,
                timeout: DEFAULT_TIMEOUT,
            }, codeHighloadV3)
        );

        // Deploy wallet
        const deployer = await blockchain.treasury('deployer');
        await highloadWallet.sendDeploy(deployer.getSender(), toNano('50'));

        const queryId = new HighloadQueryId();

        // Create batch of 50 messages with unique comments to avoid deduplication
        const messages = Array.from({ length: 50 }, (_, i) => ({
            type: 'sendMsg' as const,
            mode: SendMode.PAY_GAS_SEPARATELY,
            outMsg: createTransferWithComment(receiver, toNano('0.01'), `${i + 1}`),
        }));
        
        // Send batch
        const result = await highloadWallet.sendBatch(
            keyPair.secretKey,
            messages,
            DEFAULT_SUBWALLET,
            queryId,
            DEFAULT_TIMEOUT,
            toNano('0.5'),
            SendMode.PAY_GAS_SEPARATELY,
            controlledTimestamp()
        );

        // Print detailed breakdown
        const totalGas = printTransactionBreakdown(
            result.transactions,
            'Highload V3: Batch Transfer (50 msgs)'
        );

        const avgGasPerMessage = Number(totalGas) / 50;
        console.log(`\n=== Batch Efficiency (50 messages) ===`);
        console.log(`Total gas:        ${totalGas.toString().padStart(10)} gas`);
        console.log(`Avg per message:  ${avgGasPerMessage.toFixed(0).padStart(10)} gas\n`);

        // Verify transactions
        expect(result.transactions).toHaveTransaction({
            from: highloadWallet.address,
            to: receiver.address,
            success: true,
        });

        // Log aggregated gas
        GAS_LOG.rememberGas('batch_50_messages', result.transactions.slice(0, 2), blockchain);
        
        // Assert reasonable gas range
        expect(Number(totalGas)).toBeGreaterThan(20000);
        expect(Number(totalGas)).toBeLessThan(60000);
    });
});
