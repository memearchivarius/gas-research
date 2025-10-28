import 'dotenv/config';
import { Address, beginCell, internal, SendMode, toNano } from '@ton/core';
import { compile, NetworkProvider } from '@ton/blueprint';
import { HighloadWalletV3 } from '../wrappers/HighloadWalletV3';
import { HighloadQueryId } from '../wrappers/HighloadQueryId';
import { mnemonicToPrivateKey } from '@ton/crypto';
import { ensureSufficientBalance } from './helpers/balanceChecker';

/**
 * Highload Wallet V3 Script - Testnet/Mainnet Operations
 * 
 * This script demonstrates the three main Highload V3 usage patterns:
 * 1. Simple transfer (no comment)
 * 2. Transfer with comment
 * 3. Batch transfer (10 messages)
 * 
 * Usage:
 *   Simple transfer:
 *     npx blueprint run runHighloadV3 --testnet --tonconnect simple [receiver_address]
 *
 *   Transfer with comment:
 *     npx blueprint run runHighloadV3 --testnet --tonconnect comment "Hello World" [receiver_address]
 *
 *   Batch 12 transfers:
 *     npx blueprint run runHighloadV3 --testnet --tonconnect batch12 [receiver_address]
 *
 *   Batch 50 transfers (stress test):
 *     npx blueprint run runHighloadV3 --testnet --tonconnect batch50 [receiver_address]
 * 
 * Configuration:
 *   - Set WALLET_MNEMONIC in .env for custom wallet
 *   - Defaults to example mnemonic if not set
 *   - Receiver defaults to sender address if not specified
 */

// Constants
const DEFAULT_TIMEOUT = 60 * 60; // 1 hour
const DEFAULT_SUBWALLET = 0;
const MAX_SEQ = 8380414; // Reserve last ID
const TIMESTAMP_OFFSET = 60; // 60 seconds in the past to avoid clock skew

/**
 * Helper to create a simple transfer message (no comment)
 */
function createSimpleTransfer(to: Address, value: bigint) {
    return internal({
        to,
        value,
        bounce: false,
        body: beginCell().endCell(),
    });
}

/**
 * Helper to create a transfer message with comment
 */
function createTransferWithComment(to: Address, value: bigint, comment: string) {
    return internal({
        to,
        value,
        bounce: false,
        body: beginCell()
            .storeUint(0, 32) // text comment opcode
            .storeStringTail(comment)
            .endCell(),
    });
}

/**
 * Get controlled timestamp (slightly in the past to avoid clock skew)
 */
function getControlledTimestamp(): number {
    return Math.floor(Date.now() / 1000) - TIMESTAMP_OFFSET;
}

/**
 * Find next available query ID
 */
async function getNextQueryId(wallet: HighloadWalletV3, provider: any, createdAt: number): Promise<HighloadQueryId> {
    let queryId = HighloadQueryId.fromSeqno(BigInt(createdAt % MAX_SEQ));
    let attempts = 0;
    
    while (await wallet.getProcessed(provider, queryId, true) && queryId.hasNext() && attempts < 1024) {
        queryId = queryId.getNext();
        attempts++;
    }
    
    if (attempts >= 1024) {
        throw new Error('Could not find available query ID after 1024 attempts');
    }
    
    return queryId;
}

/**
 * Print operation header
 */
function printOperationHeader(mode: string, receiver: Address, network: 'mainnet' | 'testnet' | 'custom') {
    console.log('\n' + '='.repeat(60));
    console.log(`  Highload V3: ${mode.charAt(0).toUpperCase() + mode.slice(1)}`);
    console.log('='.repeat(60));
    console.log(`Receiver: ${receiver.toString({ testOnly: network === 'testnet' })}`);
    console.log(`Mode:     ${mode}`);
    console.log('='.repeat(60) + '\n');
}

/**
 * Execute simple transfer (no comment)
 */
async function executeSimpleTransfer(
    wallet: HighloadWalletV3,
    provider: any,
    keyPair: any,
    receiver: Address,
    queryId: HighloadQueryId,
    createdAt: number,
    ui: any
) {
    const transfer = createSimpleTransfer(receiver, toNano('0.01'));
    
    await wallet.sendExternalMessage(
        provider,
        keyPair.secretKey,
        {
            message: transfer,
            mode: SendMode.PAY_GAS_SEPARATELY,
            query_id: queryId,
            createdAt,
            subwalletId: DEFAULT_SUBWALLET,
            timeout: DEFAULT_TIMEOUT,
        },
    );
    
    ui.write('✅ Simple transfer sent successfully');
    ui.write(`   Amount: 0.01 TON`);
    ui.write(`   No comment`);
}

/**
 * Execute transfer with comment
 */
async function executeTransferWithComment(
    wallet: HighloadWalletV3,
    provider: any,
    keyPair: any,
    receiver: Address,
    comment: string,
    queryId: HighloadQueryId,
    createdAt: number,
    ui: any
) {
    const transfer = createTransferWithComment(receiver, toNano('0.01'), comment);
    
    await wallet.sendExternalMessage(
        provider,
        keyPair.secretKey,
        {
            message: transfer,
            mode: SendMode.PAY_GAS_SEPARATELY,
            query_id: queryId,
            createdAt,
            subwalletId: DEFAULT_SUBWALLET,
            timeout: DEFAULT_TIMEOUT,
        },
    );
    
    ui.write('✅ Transfer with comment sent successfully');
    ui.write(`   Amount:  0.01 TON`);
    ui.write(`   Comment: "${comment}"`);
}

/**
 * Execute batch transfer (12 messages)
 */
async function executeBatchTransfer(
    wallet: HighloadWalletV3,
    provider: any,
    keyPair: any,
    receiver: Address,
    queryId: HighloadQueryId,
    createdAt: number,
    ui: any
) {
    // Create batch of 12 transfers with unique comments to avoid deduplication
    const messages = Array.from({ length: 12 }, (_, i) => ({
        type: 'sendMsg' as const,
        mode: SendMode.PAY_GAS_SEPARATELY,
        outMsg: createTransferWithComment(receiver, toNano('0.01'), `${i + 1}`),
    }));
    
    await wallet.sendBatch(
        provider,
        keyPair.secretKey,
        messages,
        DEFAULT_SUBWALLET,
        queryId,
        DEFAULT_TIMEOUT,
        toNano('0.05'),
        SendMode.PAY_GAS_SEPARATELY,
        createdAt,
    );
    
    ui.write('✅ Batch transfer sent successfully');
    ui.write(`   Messages: 12`);
    ui.write(`   Amount per message: 0.01 TON`);
    ui.write(`   Total amount: 0.12 TON`);
}

/**
 * Execute batch transfer (50 messages) - stress test
 */
async function executeBatchTransferStress(
    wallet: HighloadWalletV3,
    provider: any,
    keyPair: any,
    receiver: Address,
    queryId: HighloadQueryId,
    createdAt: number,
    ui: any
) {
    // Create batch of 50 transfers with unique comments to avoid deduplication
    const messages = Array.from({ length: 50 }, (_, i) => ({
        type: 'sendMsg' as const,
        mode: SendMode.PAY_GAS_SEPARATELY,
        outMsg: createTransferWithComment(receiver, toNano('0.01'), `${i + 1}`),
    }));
    
    await wallet.sendBatch(
        provider,
        keyPair.secretKey,
        messages,
        DEFAULT_SUBWALLET,
        queryId,
        DEFAULT_TIMEOUT,
        toNano('0.5'),
        SendMode.PAY_GAS_SEPARATELY,
        createdAt,
    );
    
    ui.write('✅ Batch stress transfer sent successfully');
    ui.write(`   Messages: 50`);
    ui.write(`   Amount per message: 0.01 TON`);
    ui.write(`   Total amount: 0.50 TON`);
}

/**
 * Main execution function
 */
export async function run(provider: NetworkProvider, args: string[]) {
    const ui = provider.ui();
    const mode = (args[0] ?? 'simple').toLowerCase();
    
    // Validate mode
    if (!['simple', 'comment', 'batch12', 'batch50'].includes(mode)) {
        ui.write(`❌ Invalid mode: ${mode}`);
        ui.write(`   Valid modes: simple, comment, batch12, batch50`);
        return;
    }
    
    // Parse arguments based on mode
    let comment = '';
    let receiverAddress: Address;
    
    if (mode === 'comment') {
        comment = args[1] ?? 'Hello from Highload V3';
        receiverAddress = args[2] ? Address.parse(args[2]) : (provider.sender().address as Address);
    } else {
        receiverAddress = args[1] ? Address.parse(args[1]) : (provider.sender().address as Address);
    }
    
    // Load keypair from environment or use default
    const mnemonics = (process.env.WALLET_MNEMONIC?.trim() ?? '').length
        ? (process.env.WALLET_MNEMONIC as string).split(' ')
        : 'burst moral give fun rain air sample time ramp chat piano auction pride steel material despair client field gift hello similar degree fame almost'.split(' ');
    
    const keyPair = await mnemonicToPrivateKey(mnemonics);
    
    // Compile and create wallet
    ui.write('Compiling Highload Wallet V3...');
    const code = await compile('HighloadWalletV3');
    
    const wallet = HighloadWalletV3.createFromConfig(
        {
            publicKey: keyPair.publicKey,
            subwalletId: DEFAULT_SUBWALLET,
            timeout: DEFAULT_TIMEOUT,
        },
        code,
    );
    
    ui.write(`Wallet address: ${wallet.address.toString({ testOnly: provider.network() === 'testnet' })}`);
    
    // Check balance and deploy if needed
    ui.write('Checking balance and deployment status...');
    const { isDeployed } = await ensureSufficientBalance(provider, wallet.address, wallet.init);
    
    if (isDeployed) {
        ui.write('✅ Wallet is deployed');
    } else {
        ui.write('⚠️  Wallet not deployed - will deploy with first transaction');
    }
    
    const contractProvider = provider.provider(wallet.address, isDeployed ? undefined : wallet.init);
    
    // Get controlled timestamp and query ID
    const createdAt = getControlledTimestamp();
    const queryId = await getNextQueryId(wallet, contractProvider, createdAt);
    
    // Print operation header
    printOperationHeader(mode, receiverAddress, provider.network());
    
    // Execute operation based on mode
    try {
        switch (mode) {
            case 'simple':
                await executeSimpleTransfer(
                    wallet,
                    contractProvider,
                    keyPair,
                    receiverAddress,
                    queryId,
                    createdAt,
                    ui
                );
                break;
                
            case 'comment':
                await executeTransferWithComment(
                    wallet,
                    contractProvider,
                    keyPair,
                    receiverAddress,
                    comment,
                    queryId,
                    createdAt,
                    ui
                );
                break;
                
            case 'batch12':
                await executeBatchTransfer(
                    wallet,
                    contractProvider,
                    keyPair,
                    receiverAddress,
                    queryId,
                    createdAt,
                    ui
                );
                break;
                
            case 'batch50':
                await executeBatchTransferStress(
                    wallet,
                    contractProvider,
                    keyPair,
                    receiverAddress,
                    queryId,
                    createdAt,
                    ui
                );
                break;
        }
        
        ui.write('\n' + '='.repeat(60));
        ui.write('Transaction submitted to network');
        ui.write('Check transaction status in explorer');
        ui.write('='.repeat(60) + '\n');
        
    } catch (error) {
        ui.write('\n❌ Error executing operation:');
        ui.write(`   ${error}`);
        throw error;
    }
}
