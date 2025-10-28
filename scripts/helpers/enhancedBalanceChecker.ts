import { Address, toNano, Cell } from '@ton/core';
import { NetworkProvider } from '@ton/blueprint';
import { FeeEstimator, WalletType, ScenarioType } from './feeEstimator';

// Re-export types for convenience
export type { WalletType, ScenarioType } from './feeEstimator';

/**
 * Interface for balance information
 */
export interface BalanceInfo {
  balance: bigint;
  state: 'uninit' | 'active' | 'frozen';
  isDeployed: boolean;
}

/**
 * Interface for fee breakdown with detailed components
 */
export interface DetailedFeeBreakdown {
  walletType: WalletType;
  scenarioType: ScenarioType;
  messageCount: number;
  totalFeeNano: bigint;
  totalFeeTon: string;
  computeFeeTon: string;
  storageFeeTon: string;
  importFeeTon: string;
  forwardFeesTon: string;
  actionFeeTon: string;
  isInterpolated: boolean;
  baseScenarios: string[];
  transferAmountNano: bigint;
  transferAmountTon: string;
  totalTransferNano: bigint;
  totalTransferTon: string;
  requiredBalanceNano: bigint;
  requiredBalanceTon: string;
  bufferType: 'fixed' | 'percentage';
  bufferValue: string;
}

/**
 * Interface for balance check result
 */
export interface BalanceCheckResult {
  isSufficient: boolean;
  currentBalance: bigint;
  requiredBalance: bigint;
  deficit: bigint;
  feeBreakdown: DetailedFeeBreakdown;
  balanceInfo: BalanceInfo;
}

/**
 * Interface for top-up result
 */
export interface TopUpResult {
  success: boolean;
  transactionSent: boolean;
  oldBalance: bigint;
  newBalance?: bigint;
  topUpAmount: bigint;
  error?: string;
}

/**
 * Enhanced balance checker with precise fee estimation and full TonConnect integration
 * Uses real fee data from bench-snapshots for accurate balance requirements
 */
export class EnhancedBalanceChecker {
  private feeEstimator: FeeEstimator;
  private readonly DEFAULT_BUFFER_TON = toNano('0.1'); // 0.1 TON fixed buffer
  private readonly DEFAULT_BUFFER_PERCENT = 20; // 20% percentage buffer

  constructor() {
    this.feeEstimator = new FeeEstimator();
  }

  /**
   * Fetches contract state and balance from TON Center API
   */
  async getContractInfo(address: Address, isTestnet: boolean): Promise<BalanceInfo> {
    const baseUrl = isTestnet
      ? 'https://testnet.toncenter.com/api/v2'
      : 'https://toncenter.com/api/v2';

    // Check for API key from environment variables
    const apiKey = isTestnet 
      ? process.env.TONCENTER_API_KEY_TESTNET
      : process.env.TONCENTER_API_KEY;

    let url = `${baseUrl}/getAddressInformation?address=${address.toString()}`;
    
    // Add API key to URL if available
    if (apiKey) {
      url += `&api_key=${apiKey}`;
    }

    try {
      const response = await fetch(url);
      const data = await response.json();

      if (!data.ok || !data.result) {
        throw new Error(`API error: ${data.error || 'Unknown error'}`);
      }

      const state = data.result.state as 'uninit' | 'active' | 'frozen';
      const balance = BigInt(data.result.balance);
      const isDeployed = state === 'active' || state === 'frozen';

      return {
        state,
        balance,
        isDeployed
      };
    } catch (error) {
      throw new Error(`Failed to fetch contract info: ${error}`);
    }
  }

  /**
   * Get detailed fee breakdown for wallet scenario
   */
  getDetailedFeeBreakdown(
    walletType: WalletType,
    scenarioType: ScenarioType,
    transferAmount: bigint,
    useFixedBuffer: boolean = true,
    bufferPercent: number = this.DEFAULT_BUFFER_PERCENT
  ): DetailedFeeBreakdown {
    const feeBreakdown = this.feeEstimator.getFeeBreakdownByType(walletType, scenarioType);
    const requiredBalance = this.feeEstimator.getRequiredBalanceByType(
      walletType,
      scenarioType,
      transferAmount,
      useFixedBuffer,
      bufferPercent
    );

    const totalTransfer = transferAmount * BigInt(feeBreakdown.messageCount);
    const bufferType = useFixedBuffer ? 'fixed' : 'percentage';
    const bufferValue = useFixedBuffer 
      ? `${Number(this.DEFAULT_BUFFER_TON) / 1e9} TON`
      : `${bufferPercent}%`;

    return {
      walletType,
      scenarioType,
      messageCount: feeBreakdown.messageCount,
      totalFeeNano: feeBreakdown.totalFeeNano,
      totalFeeTon: feeBreakdown.totalFeeTon,
      computeFeeTon: feeBreakdown.computeFeeTon,
      storageFeeTon: feeBreakdown.storageFeeTon,
      importFeeTon: feeBreakdown.importFeeTon,
      forwardFeesTon: feeBreakdown.forwardFeesTon,
      actionFeeTon: feeBreakdown.actionFeeTon,
      isInterpolated: feeBreakdown.isInterpolated,
      baseScenarios: feeBreakdown.baseScenarios,
      transferAmountNano: transferAmount,
      transferAmountTon: (Number(transferAmount) / 1e9).toFixed(6),
      totalTransferNano: totalTransfer,
      totalTransferTon: (Number(totalTransfer) / 1e9).toFixed(6),
      requiredBalanceNano: requiredBalance,
      requiredBalanceTon: (Number(requiredBalance) / 1e9).toFixed(6),
      bufferType,
      bufferValue
    };
  }

  /**
   * Get detailed fee breakdown for custom message count
   */
  getDetailedFeeBreakdownForMessageCount(
    walletType: WalletType,
    messageCount: number,
    transferAmount: bigint,
    useFixedBuffer: boolean = true,
    bufferPercent: number = this.DEFAULT_BUFFER_PERCENT
  ): DetailedFeeBreakdown {
    const feeBreakdown = this.feeEstimator.getFeeBreakdownForMessageCount(walletType, messageCount);
    const requiredBalance = this.feeEstimator.getRequiredBalanceForMessageCount(
      walletType,
      messageCount,
      transferAmount,
      useFixedBuffer,
      bufferPercent
    );

    const totalTransfer = transferAmount * BigInt(messageCount);
    const bufferType = useFixedBuffer ? 'fixed' : 'percentage';
    const bufferValue = useFixedBuffer 
      ? `${Number(this.DEFAULT_BUFFER_TON) / 1e9} TON`
      : `${bufferPercent}%`;

    return {
      walletType,
      scenarioType: 'simple_transfer' as ScenarioType, // Default scenario type
      messageCount,
      totalFeeNano: feeBreakdown.totalFeeNano,
      totalFeeTon: feeBreakdown.totalFeeTon,
      computeFeeTon: feeBreakdown.computeFeeTon,
      storageFeeTon: feeBreakdown.storageFeeTon,
      importFeeTon: feeBreakdown.importFeeTon,
      forwardFeesTon: feeBreakdown.forwardFeesTon,
      actionFeeTon: feeBreakdown.actionFeeTon,
      isInterpolated: feeBreakdown.isInterpolated,
      baseScenarios: feeBreakdown.baseScenarios,
      transferAmountNano: transferAmount,
      transferAmountTon: (Number(transferAmount) / 1e9).toFixed(6),
      totalTransferNano: totalTransfer,
      totalTransferTon: (Number(totalTransfer) / 1e9).toFixed(6),
      requiredBalanceNano: requiredBalance,
      requiredBalanceTon: (Number(requiredBalance) / 1e9).toFixed(6),
      bufferType,
      bufferValue
    };
  }

  /**
   * Check if balance is sufficient for specific scenario
   */
  async checkBalanceSufficiency(
    provider: NetworkProvider,
    contractAddress: Address,
    walletType: WalletType,
    scenarioType: ScenarioType,
    transferAmount: bigint,
    useFixedBuffer: boolean = true,
    bufferPercent: number = this.DEFAULT_BUFFER_PERCENT
  ): Promise<BalanceCheckResult> {
    const ui = provider.ui();
    const isTestnet = provider.network() === 'testnet';

    // Get current contract info
    const balanceInfo = await this.getContractInfo(contractAddress, isTestnet);
    
    // Get detailed fee breakdown
    const feeBreakdown = this.getDetailedFeeBreakdown(
      walletType,
      scenarioType,
      transferAmount,
      useFixedBuffer,
      bufferPercent
    );

    // Check if balance is sufficient
    const isSufficient = balanceInfo.balance >= feeBreakdown.requiredBalanceNano;
    const deficit = isSufficient ? 0n : feeBreakdown.requiredBalanceNano - balanceInfo.balance;

    // Display information
    ui.write(`\n📊 Balance Check Results:`);
    ui.write(`   Wallet Type: ${walletType}`);
    ui.write(`   Scenario: ${scenarioType}`);
    ui.write(`   Contract: ${contractAddress.toString({ testOnly: isTestnet })}`);
    ui.write(`   State: ${balanceInfo.state}`);
    ui.write(`   Current Balance: ${(Number(balanceInfo.balance) / 1e9).toFixed(6)} TON`);
    ui.write(`   Required Balance: ${feeBreakdown.requiredBalanceTon} TON`);
    ui.write(`   Transfer Amount: ${feeBreakdown.totalTransferTon} TON (${feeBreakdown.messageCount} messages)`);
    ui.write(`   Estimated Fee: ${feeBreakdown.totalFeeTon} TON`);
    ui.write(`   Buffer Type: ${feeBreakdown.bufferType} (${feeBreakdown.bufferValue})`);
    ui.write(`   Status: ${isSufficient ? '✅ Sufficient' : '❌ Insufficient'}`);
    
    if (!isSufficient) {
      ui.write(`   Deficit: ${(Number(deficit) / 1e9).toFixed(6)} TON`);
    }

    return {
      isSufficient,
      currentBalance: balanceInfo.balance,
      requiredBalance: feeBreakdown.requiredBalanceNano,
      deficit,
      feeBreakdown,
      balanceInfo
    };
  }

  /**
   * Top up balance via TonConnect
   */
  async topUpBalance(
    provider: NetworkProvider,
    contractAddress: Address,
    amount: bigint,
    stateInit?: { code: Cell; data: Cell },
    waitForConfirmation: boolean = true
  ): Promise<TopUpResult> {
    const ui = provider.ui();
    const isTestnet = provider.network() === 'testnet';
    const maxRetries = 3;
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Get current balance before top-up
        const oldBalanceInfo = await this.getContractInfo(contractAddress, isTestnet);
        const oldBalance = oldBalanceInfo.balance;

        ui.write(`\n💰 Initiating Top-up:`);
        ui.write(`   To: ${contractAddress.toString({ testOnly: isTestnet })}`);
        ui.write(`   Amount: ${(Number(amount) / 1e9).toFixed(6)} TON`);
        ui.write(`   With StateInit: ${stateInit ? 'Yes' : 'No'}`);
        if (attempt > 1) {
          ui.write(`   Attempt: ${attempt}/${maxRetries}`);
        }

        // Send top-up transaction via TonConnect
        try {
          await provider.sender().send({
            to: contractAddress,
            value: amount,
            init: stateInit,
            body: undefined, // Simple transfer for top-up
          });
        } catch (sendError) {
          const errorMsg = sendError instanceof Error ? sendError.message : String(sendError);
          
          // Check if it's a user rejection
          if (errorMsg.includes('User rejected') || errorMsg.includes('rejected')) {
            ui.write(`❌ Top-up rejected by user`);
            return {
              success: false,
              transactionSent: false,
              oldBalance,
              topUpAmount: amount,
              error: 'User rejected the transaction'
            };
          }
          
          // Check if it's a server error that should be retried
          if (errorMsg.includes('500') || errorMsg.includes('timeout') || errorMsg.includes('ECONNREFUSED')) {
            lastError = sendError instanceof Error ? sendError : new Error(errorMsg);
            if (attempt < maxRetries) {
              ui.write(`⚠️ Request failed (attempt ${attempt}/${maxRetries}): ${errorMsg}`);
              ui.write(`⏳ Retrying in 15 seconds...`);
              await new Promise((resolve) => setTimeout(resolve, 15000));
              continue;
            }
          }
          
          // For other errors, fail immediately
          throw sendError;
        }

        ui.write(`✅ Top-up transaction sent successfully`);

        if (waitForConfirmation) {
          ui.write(`⏳ Waiting 15 seconds for confirmation...`);
          await new Promise((resolve) => setTimeout(resolve, 15000));

          // Re-check balance
          const newBalanceInfo = await this.getContractInfo(contractAddress, isTestnet);
          const newBalance = newBalanceInfo.balance;
          const actualChange = newBalance - oldBalance;

          ui.write(`✅ Top-up confirmed`);
          ui.write(`   Balance before top-up: ${(Number(oldBalance) / 1e9).toFixed(6)} TON`);
          ui.write(`   Balance after wait: ${(Number(newBalance) / 1e9).toFixed(6)} TON`);
          ui.write(`   Net change: ${actualChange >= 0n ? '+' : ''}${(Number(actualChange) / 1e9).toFixed(6)} TON`);
          ui.write(`   (Note: If negative, other transactions completed during the wait)`);

          return {
            success: true,
            transactionSent: true,
            oldBalance,
            newBalance,
            topUpAmount: amount
          };
        }

        return {
          success: true,
          transactionSent: true,
          oldBalance,
          topUpAmount: amount
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (attempt === maxRetries) {
          const errorMessage = lastError.message;
          ui.write(`❌ Failed to top up: ${errorMessage}`);
          
          return {
            success: false,
            transactionSent: false,
            oldBalance: 0n,
            topUpAmount: amount,
            error: errorMessage
          };
        }
        
        // For retryable errors, continue to next attempt
        ui.write(`⚠️ Attempt ${attempt}/${maxRetries} failed: ${lastError.message}`);
        ui.write(`⏳ Retrying in 15 seconds...`);
        await new Promise((resolve) => setTimeout(resolve, 15000));
      }
    }

    // This should not be reached, but handle it just in case
    const errorMessage = lastError?.message || 'Unknown error';
    ui.write(`❌ Failed to top up after ${maxRetries} attempts: ${errorMessage}`);
    
    return {
      success: false,
      transactionSent: false,
      oldBalance: 0n,
      topUpAmount: amount,
      error: errorMessage
    };
  }

  /**
   * Ensure sufficient balance for specific scenario with automatic top-up
   */
  async ensureSufficientBalanceForScenario(
    provider: NetworkProvider,
    contractAddress: Address,
    walletType: WalletType,
    scenarioType: ScenarioType,
    transferAmount: bigint,
    stateInit?: { code: Cell; data: Cell },
    useFixedBuffer: boolean = true,
    bufferPercent: number = this.DEFAULT_BUFFER_PERCENT
  ): Promise<{ balanceCheckResult: BalanceCheckResult; topUpResult?: TopUpResult }> {
    const ui = provider.ui();

    // Check balance sufficiency
    const balanceCheckResult = await this.checkBalanceSufficiency(
      provider,
      contractAddress,
      walletType,
      scenarioType,
      transferAmount,
      useFixedBuffer,
      bufferPercent
    );

    // If balance is sufficient, return early
    if (balanceCheckResult.isSufficient) {
      return { balanceCheckResult };
    }

    // Balance insufficient - request top-up
    // Use max(deficit, buffer) to ensure minimum buffer amount
    const topUpAmount = balanceCheckResult.deficit > this.DEFAULT_BUFFER_TON 
      ? balanceCheckResult.deficit 
      : this.DEFAULT_BUFFER_TON;

    ui.write(`\n🔄 Initiating automatic top-up...`);
    
    const topUpResult = await this.topUpBalance(
      provider,
      contractAddress,
      topUpAmount,
      stateInit,
      true
    );

    // If top-up was rejected by user, return without throwing
    if (!topUpResult.success && topUpResult.error?.includes('rejected')) {
      ui.write(`\n⏭️ Skipping scenario due to user rejection of top-up`);
      throw new Error('User rejected top-up transaction');
    }

    if (!topUpResult.success) {
      throw new Error(
        `Automatic top-up failed. Please manually send at least ${topUpAmount / BigInt(1e9)} TON to ${contractAddress.toString({ testOnly: provider.network() === 'testnet' })}`
      );
    }

    return { balanceCheckResult, topUpResult };
  }

  /**
   * Ensure sufficient balance for custom message count with automatic top-up
   */
  async ensureSufficientBalanceForMessageCount(
    provider: NetworkProvider,
    contractAddress: Address,
    walletType: WalletType,
    messageCount: number,
    transferAmount: bigint,
    stateInit?: { code: Cell; data: Cell },
    useFixedBuffer: boolean = true,
    bufferPercent: number = this.DEFAULT_BUFFER_PERCENT
  ): Promise<{ balanceCheckResult: BalanceCheckResult; topUpResult?: TopUpResult }> {
    const ui = provider.ui();
    const isTestnet = provider.network() === 'testnet';

    // Get current contract info
    const balanceInfo = await this.getContractInfo(contractAddress, isTestnet);
    
    // Get detailed fee breakdown for custom message count
    const feeBreakdown = this.getDetailedFeeBreakdownForMessageCount(
      walletType,
      messageCount,
      transferAmount,
      useFixedBuffer,
      bufferPercent
    );

    // Check if balance is sufficient
    const isSufficient = balanceInfo.balance >= feeBreakdown.requiredBalanceNano;
    const deficit = isSufficient ? 0n : feeBreakdown.requiredBalanceNano - balanceInfo.balance;

    // Display information
    ui.write(`\n📊 Balance Check Results (Custom Message Count):`);
    ui.write(`   Wallet Type: ${walletType}`);
    ui.write(`   Message Count: ${messageCount}`);
    ui.write(`   Contract: ${contractAddress.toString({ testOnly: isTestnet })}`);
    ui.write(`   State: ${balanceInfo.state}`);
    ui.write(`   Current Balance: ${(Number(balanceInfo.balance) / 1e9).toFixed(6)} TON`);
    ui.write(`   Required Balance: ${feeBreakdown.requiredBalanceTon} TON`);
    ui.write(`   Transfer Amount: ${feeBreakdown.totalTransferTon} TON (${messageCount} messages)`);
    ui.write(`   Estimated Fee: ${feeBreakdown.totalFeeTon} TON`);
    ui.write(`   Buffer Type: ${feeBreakdown.bufferType} (${feeBreakdown.bufferValue})`);
    ui.write(`   Interpolated: ${feeBreakdown.isInterpolated ? 'Yes' : 'No'}`);
    if (feeBreakdown.isInterpolated) {
      ui.write(`   Base Scenarios: ${feeBreakdown.baseScenarios.join(', ')}`);
    }
    ui.write(`   Status: ${isSufficient ? '✅ Sufficient' : '❌ Insufficient'}`);
    
    if (!isSufficient) {
      ui.write(`   Deficit: ${(Number(deficit) / 1e9).toFixed(6)} TON`);
    }

    const balanceCheckResult: BalanceCheckResult = {
      isSufficient,
      currentBalance: balanceInfo.balance,
      requiredBalance: feeBreakdown.requiredBalanceNano,
      deficit,
      feeBreakdown,
      balanceInfo
    };

    // If balance is sufficient, return early
    if (isSufficient) {
      return { balanceCheckResult };
    }

    // Balance insufficient - request top-up
    // Use max(deficit, buffer) to ensure minimum buffer amount
    const topUpAmount = deficit > this.DEFAULT_BUFFER_TON 
      ? deficit 
      : this.DEFAULT_BUFFER_TON;

    ui.write(`\n🔄 Initiating automatic top-up...`);
    
    const topUpResult = await this.topUpBalance(
      provider,
      contractAddress,
      topUpAmount,
      stateInit,
      true
    );

    // If top-up was rejected by user, return without throwing
    if (!topUpResult.success && topUpResult.error?.includes('rejected')) {
      ui.write(`\n⏭️ Skipping scenario due to user rejection of top-up`);
      throw new Error('User rejected top-up transaction');
    }

    if (!topUpResult.success) {
      throw new Error(
        `Automatic top-up failed. Please manually send at least ${topUpAmount / BigInt(1e9)} TON to ${contractAddress.toString({ testOnly: isTestnet })}`
      );
    }

    return { balanceCheckResult, topUpResult };
  }

  /**
   * Get fee estimator instance
   */
  getFeeEstimator(): FeeEstimator {
    return this.feeEstimator;
  }

  /**
   * Print all available scenarios for all wallets
   */
  printAvailableScenarios(): void {
    const wallets = this.feeEstimator.getLoadedWallets();
    
    console.log('\n📊 Available Scenarios:');
    console.log('='.repeat(50));
    
    for (const wallet of wallets) {
      const scenarios = this.feeEstimator.getAvailableScenarios(wallet);
      console.log(`\n${wallet}:`);
      
      for (const scenario of scenarios) {
        const breakdown = this.feeEstimator.getFeeBreakdown(wallet, scenario);
        const messageCount = breakdown.messageCount;
        const transferAmount = toNano('0.01'); // Default transfer amount
        const requiredBalance = this.feeEstimator.getRequiredBalance(wallet, scenario, transferAmount, true, 0);
        
        console.log(`  ${scenario}:`);
        console.log(`    Messages: ${messageCount}`);
        console.log(`    Fee: ${breakdown.totalFeeTon} TON`);
        console.log(`    Required balance (0.01 TON/msg): ${(Number(requiredBalance) / 1e9).toFixed(4)} TON`);
      }
    }
    
    console.log('='.repeat(50));
  }

  /**
   * Print detailed fee information for all wallet types and scenarios
   */
  printDetailedFeeInfo(transferAmount: bigint = toNano('0.01')): void {
    const wallets: WalletType[] = ['WalletV3', 'WalletV4', 'WalletV5', 'HighloadWalletV3'];
    const scenarios: ScenarioType[] = ['simple_transfer', 'transfer_with_comment', 'batch_4_messages', 'batch_12_messages', 'batch_50_messages'];
    
    console.log('\n📊 Detailed Fee Information:');
    console.log('='.repeat(80));
    console.log(`Transfer Amount: ${(Number(transferAmount) / 1e9).toFixed(6)} TON per message`);
    console.log('='.repeat(80));
    
    for (const wallet of wallets) {
      console.log(`\n${wallet}:`);
      console.log('-'.repeat(40));
      
      for (const scenario of scenarios) {
        try {
          const breakdown = this.getDetailedFeeBreakdown(wallet, scenario, transferAmount, true, 0);
          
          console.log(`  ${scenario}:`);
          console.log(`    Messages: ${breakdown.messageCount}`);
          console.log(`    Total Transfer: ${breakdown.totalTransferTon} TON`);
          console.log(`    Total Fee: ${breakdown.totalFeeTon} TON`);
          console.log(`      Compute: ${breakdown.computeFeeTon} TON`);
          console.log(`      Storage: ${breakdown.storageFeeTon} TON`);
          console.log(`      Import: ${breakdown.importFeeTon} TON`);
          console.log(`      Forward: ${breakdown.forwardFeesTon} TON`);
          console.log(`      Action: ${breakdown.actionFeeTon} TON`);
          console.log(`    Required Balance: ${breakdown.requiredBalanceTon} TON`);
          console.log(`    Buffer: ${breakdown.bufferType} (${breakdown.bufferValue})`);
          if (breakdown.isInterpolated) {
            console.log(`    Interpolated from: ${breakdown.baseScenarios.join(', ')}`);
          }
        } catch (error) {
          console.log(`  ${scenario}: Not available`);
        }
      }
    }
    
    console.log('='.repeat(80));
  }
}

/**
 * Convenience function for backward compatibility
 */
export async function ensureSufficientBalanceForScenario(
  provider: NetworkProvider,
  contractAddress: Address,
  walletType: WalletType,
  scenarioType: ScenarioType,
  transferAmount: bigint,
  stateInit?: { code: Cell; data: Cell },
  useFixedBuffer?: boolean,
  bufferPercent?: number
) {
  const checker = new EnhancedBalanceChecker();
  return await checker.ensureSufficientBalanceForScenario(
    provider,
    contractAddress,
    walletType,
    scenarioType,
    transferAmount,
    stateInit,
    useFixedBuffer,
    bufferPercent
  );
}