import 'dotenv/config';
import { Address, beginCell, internal, SendMode, toNano } from '@ton/core';
import { NetworkProvider } from '@ton/blueprint';
import { WalletContractV4 } from '@ton/ton';
import { mnemonicToPrivateKey } from '@ton/crypto';
import { ensureSufficientBalance } from './helpers/balanceChecker';

/**
 * Usage:
 *   npx blueprint run runWalletV4 --testnet --tonconnect simple
 *   npx blueprint run runWalletV4 --testnet --tonconnect comment "Hello"
 *   npx blueprint run runWalletV4 --testnet --tonconnect batch4
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

    const receiver = maybeAddress ? Address.parse(maybeAddress) : (provider.sender().address as Address);

    const mnemonics = (process.env.WALLET_MNEMONIC?.trim() ?? '').length
        ? (process.env.WALLET_MNEMONIC as string).split(' ')
        : 'burst moral give fun rain air sample time ramp chat piano auction pride steel material despair client field gift hello similar degree fame almost'.split(' ');
    const keyPair = await mnemonicToPrivateKey(mnemonics);

    const wallet = provider.open(
        WalletContractV4.create({
            publicKey: keyPair.publicKey,
            workchain: 0,
        }),
    );

    ui.write(`V4 wallet address: ${wallet.address.toString({ testOnly: provider.network() === 'testnet' })}`);

    // Check balance and top up if needed
    const { isDeployed } = await ensureSufficientBalance(provider, wallet.address, wallet.init);

    const seqno = isDeployed ? await wallet.getSeqno() : 0;

    const messages = [
        internal({
            to: receiver,
            value: toNano('0.01'),
            bounce: false,
            body: mode === 'comment' ? (maybeComment ?? 'GasResearch V4') : beginCell().endCell(),
        }),
    ];

    const transfer = await wallet.createTransfer({
        seqno,
        secretKey: keyPair.secretKey,
        messages,
        sendMode: SendMode.PAY_GAS_SEPARATELY,
    });

    await provider.provider(wallet.address, isDeployed ? undefined : wallet.init).external(transfer);

    ui.write(`V4 transfer sent to ${receiver.toString({ testOnly: provider.network() === 'testnet' })}`);
}


