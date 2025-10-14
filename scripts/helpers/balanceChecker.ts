import { Address, toNano, Cell } from '@ton/core';
import { NetworkProvider } from '@ton/blueprint';

const MINIMUM_BALANCE = toNano('0.1');
const TARGET_BALANCE = toNano('0.2');

/**
 * Fetches contract state and balance from TON Center API
 */
async function getContractInfo(address: Address, isTestnet: boolean) {
    const baseUrl = isTestnet
        ? 'https://testnet.toncenter.com/api/v2'
        : 'https://toncenter.com/api/v2';

    const url = `${baseUrl}/getAddressInformation?address=${address.toString()}`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (!data.ok || !data.result) {
            throw new Error(`API error: ${data.error || 'Unknown error'}`);
        }

        return {
            state: data.result.state as 'uninit' | 'active' | 'frozen',
            balance: BigInt(data.result.balance),
        };
    } catch (error) {
        throw new Error(`Failed to fetch contract info: ${error}`);
    }
}

/**
 * Checks contract balance and tops up if needed via TonConnect
 * Returns true if contract exists (deployed), false if uninit
 */
export async function ensureSufficientBalance(
    provider: NetworkProvider,
    contractAddress: Address,
    stateInit?: { code: Cell; data: Cell },
): Promise<{ isDeployed: boolean; balance: bigint }> {
    const ui = provider.ui();
    const isTestnet = provider.network() === 'testnet';

    ui.write(`Checking contract state at ${contractAddress.toString({ testOnly: isTestnet })}...`);

    const info = await getContractInfo(contractAddress, isTestnet);

    ui.write(`Contract state: ${info.state}`);
    ui.write(`Current balance: ${(Number(info.balance) / 1e9).toFixed(4)} TON`);

    const isDeployed = info.state === 'active' || info.state === 'frozen';

    // If contract doesn't exist and balance is too low, top up via TonConnect
    if (!isDeployed && info.balance <= MINIMUM_BALANCE) {
        const requiredAmount = TARGET_BALANCE - info.balance;
        ui.write(`⚠️ Balance too low for deployment!`);
        ui.write(`Topping up ${(Number(requiredAmount) / 1e9).toFixed(4)} TON via TonConnect...`);

        try {
            // Send funds with stateInit to deploy contract
            // Without stateInit, messages to uninit contracts will bounce
            await provider.sender().send({
                to: contractAddress,
                value: requiredAmount,
                init: stateInit,
            });

            ui.write(`✓ Top-up transaction sent successfully`);
            ui.write(`Waiting 15 seconds for confirmation...`);

            // Wait for the transaction to be processed
            await new Promise((resolve) => setTimeout(resolve, 15000));

            // Re-check balance
            const newInfo = await getContractInfo(contractAddress, isTestnet);
            ui.write(`New balance: ${(Number(newInfo.balance) / 1e9).toFixed(4)} TON`);

            return { isDeployed: false, balance: newInfo.balance };
        } catch (error) {
            ui.write(`❌ Failed to top up: ${error}`);
            throw new Error(`Top-up failed. Please manually send at least 0.2 TON to ${contractAddress.toString({ testOnly: isTestnet })}`);
        }
    }

    return { isDeployed, balance: info.balance };
}

