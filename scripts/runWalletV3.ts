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
 *   Optional receiver address as the last arg
 */
export async function run(provider: NetworkProvider, args: string[]) {
    const ui = provider.ui();

    const mode = (args[0] ?? 'simple').toLowerCase();
    const maybeComment = args[1];
    const maybeAddress = args[2] ?? args[1];

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

    // Prepare messages like in V5
    const messages = [
        internal({
            to: receiver,
            value: toNano('0.01'),
            bounce: false,
            body: mode === 'comment' ? (maybeComment ?? 'GasResearch V3') : beginCell().endCell(),
        }),
    ];

    const seqno = isDeployed ? await wallet.getSeqno() : 0;

    const transfer = await wallet.createTransfer({
        seqno,
        secretKey: keyPair.secretKey,
        messages,
        sendMode: SendMode.PAY_GAS_SEPARATELY,
    });

    await provider.provider(wallet.address, isDeployed ? undefined : wallet.init).external(transfer);

    ui.write(`V3 transfer sent to ${receiver.toString({ testOnly: provider.network() === 'testnet' })}`);
}


