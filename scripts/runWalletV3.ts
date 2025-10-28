import 'dotenv/config';
import { Address, beginCell, internal, SendMode, toNano } from '@ton/core';
import { NetworkProvider } from '@ton/blueprint';
import { WalletContractV3R2 } from '@ton/ton';
import { mnemonicToPrivateKey } from '@ton/crypto';
import { ensureSufficientBalance } from './helpers/balanceChecker';

/**
 * Usage:
 *   npx blueprint run runWalletV3 --testnet --tonconnect simple
 *   npx blueprint run runWalletV3 --testnet --tonconnect comment "Hello"
 *   npx blueprint run runWalletV3 --testnet --tonconnect batch4
 *   Optional receiver address as the last arg
 */
export async function run(provider: NetworkProvider, args: string[]) {
    const ui = provider.ui();

    const mode = (args[0] ?? 'simple').toLowerCase();
    const maybeComment = args[1];
    const maybeAddress = args[2] ?? args[1];

    // Validate mode
    if (!['simple', 'comment', 'batch4'].includes(mode)) {
        ui.write(`❌ Invalid mode: ${mode}`);
        ui.write(`   Valid modes: simple, comment, batch4`);
        return;
    }

    // Use deployer as receiver if none provided
    const receiver = maybeAddress ? Address.parse(maybeAddress) : (provider.sender().address as Address);

    const mnemonics = (process.env.WALLET_MNEMONIC?.trim() ?? '').length
        ? (process.env.WALLET_MNEMONIC as string).split(' ')
        : 'burst moral give fun rain air sample time ramp chat piano auction pride steel material despair client field gift hello similar degree fame almost'.split(' ');
    const keyPair = await mnemonicToPrivateKey(mnemonics);

    // Open V3 wallet using official wrapper
    const wallet = provider.open(
        WalletContractV3R2.create({
            publicKey: keyPair.publicKey,
            workchain: 0,
        }),
    );

    ui.write(`V3 wallet address: ${wallet.address.toString({ testOnly: provider.network() === 'testnet' })}`);

    // Check balance and top up if needed
    const { isDeployed } = await ensureSufficientBalance(provider, wallet.address, wallet.init);

    let messages;
    if (mode === 'batch4') {
        // Create 4 messages with unique comments to avoid deduplication
        messages = Array.from({ length: 4 }, (_, i) =>
            internal({
                to: receiver,
                value: toNano('0.01'),
                bounce: false,
                body: beginCell()
                    .storeUint(0, 32) // text comment opcode
                    .storeStringTail(`${i + 1}`) // unique comment: "1", "2", "3", "4"
                    .endCell(),
            })
        );
    } else {
        // Prepare messages like in V5
        messages = [
            internal({
                to: receiver,
                value: toNano('0.01'),
                bounce: false,
                body: mode === 'comment' ? (maybeComment ?? 'GasResearch V3') : beginCell().endCell(),
            }),
        ];
    }

    const seqno = isDeployed ? await wallet.getSeqno() : 0;

    const transfer = await wallet.createTransfer({
        seqno,
        secretKey: keyPair.secretKey,
        messages,
        sendMode: SendMode.PAY_GAS_SEPARATELY,
    });

    await provider.provider(wallet.address, isDeployed ? undefined : wallet.init).external(transfer);

    if (mode === 'batch4') {
        ui.write(`V3 batch transfer (4 messages) sent to ${receiver.toString({ testOnly: provider.network() === 'testnet' })}`);
        ui.write(`   Messages: 4`);
        ui.write(`   Amount per message: 0.01 TON`);
        ui.write(`   Total amount: 0.04 TON`);
    } else {
        ui.write(`V3 transfer sent to ${receiver.toString({ testOnly: provider.network() === 'testnet' })}`);
    }
}


