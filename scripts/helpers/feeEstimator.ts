import { toNano } from '@ton/core';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Interface for fee data from bench-snapshots
 */
interface FeeData {
  gas: number;
  compute_fee_nanoton: number;
  storage_fee_nanoton: number;
  import_fee_nanoton: number;
  total_fwd_fees_nanoton: number;
  forward_only_nanoton: number;
  action_fee_nanoton: number;
  total_fee_nanoton: number;
  reported_total_nanoton: number;
  true_network_total_nanoton: number; // Most accurate total fee
  transactions: number;
}

/**
 * Interface for interpolated fee data
 */
interface InterpolatedFeeData {
  fee: FeeData;
  messageCount: number;
  isInterpolated: boolean;
  baseScenarios: string[];
}

/**
 * Interface for fee breakdown with detailed components
 */
interface FeeBreakdown {
  fee: FeeData;
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
}

/**
 * Wallet type definitions
 */
export type WalletType = 'WalletV3' | 'WalletV4' | 'WalletV5' | 'HighloadWalletV3';

/**
 * Scenario type definitions
 */
export type ScenarioType = 'simple_transfer' | 'transfer_with_comment' | 'batch_4_messages' | 'batch_12_messages' | 'batch_50_messages';

/**
 * Enhanced fee estimator using real data from bench-snapshots with interpolation support
 */
export class FeeEstimator {
  private feeData: Map<string, FeeData> = new Map();
  private interpolationCache: Map<string, InterpolatedFeeData> = new Map();
  private readonly BUFFER_TON = toNano('0.1'); // 0.1 TON buffer as required

  constructor() {
    this.loadFeeData();
  }

  /**
   * Load fee data from bench-snapshot JSON files
   */
  private loadFeeData() {
    const snapshotsDir = path.resolve(__dirname, '../../bench-snapshots');
    
    // Load all wallet fee data
    const wallets: WalletType[] = ['HighloadWalletV3', 'WalletV3', 'WalletV4', 'WalletV5'];
    
    for (const wallet of wallets) {
      const snapshotFile = path.join(snapshotsDir, `${wallet}.last.json`);
      
      if (fs.existsSync(snapshotFile)) {
        try {
          const data = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
          const fees = data.fees_detailed;
          
          // Store all fee scenarios for this wallet
          for (const [scenario, feeData] of Object.entries(fees)) {
            this.feeData.set(`${wallet}_${scenario}`, feeData as FeeData);
          }
          
          console.log(`✅ Loaded fee data for ${wallet}: ${Object.keys(fees).join(', ')}`);
        } catch (error) {
          console.warn(`⚠️ Failed to load fee data for ${wallet}: ${error}`);
        }
      } else {
        console.warn(`⚠️ Fee data file not found: ${snapshotFile}`);
      }
    }
  }

  /**
   * Get fee data for specific wallet and scenario
   */
  private getFee(wallet: string, scenario: string): FeeData {
    const key = `${wallet}_${scenario}`;
    const fee = this.feeData.get(key);
    
    if (!fee) {
      throw new Error(`Fee data not found for ${wallet}_${scenario}`);
    }
    
    return fee;
  }

  /**
   * Get message count for specific scenario
   */
  private getMessageCount(scenario: string): number {
    if (scenario.includes('simple') || scenario.includes('comment')) {
      return 1;
    } else if (scenario.includes('batch_4')) {
      return 4;
    } else if (scenario.includes('batch_12')) {
      return 12;
    } else if (scenario.includes('batch_50')) {
      return 50;
    }
    return 1;
  }

  /**
   * Get available scenarios for a wallet sorted by message count
   */
  private getSortedScenarios(wallet: string): { scenario: string; messageCount: number }[] {
    const scenarios: { scenario: string; messageCount: number }[] = [];
    
    for (const [key] of this.feeData.keys()) {
      if (key.startsWith(`${wallet}_`)) {
        const scenario = key.substring(wallet.length + 1);
        const messageCount = this.getMessageCount(scenario);
        scenarios.push({ scenario, messageCount });
      }
    }
    
    // Sort by message count for interpolation
    return scenarios.sort((a, b) => a.messageCount - b.messageCount);
  }

  /**
   * Interpolate fee data for non-standard message counts
   */
  private interpolateFee(wallet: string, messageCount: number): InterpolatedFeeData {
    const cacheKey = `${wallet}_${messageCount}`;
    
    // Check cache first
    if (this.interpolationCache.has(cacheKey)) {
      return this.interpolationCache.get(cacheKey)!;
    }
    
    const scenarios = this.getSortedScenarios(wallet);
    
    if (scenarios.length === 0) {
      throw new Error(`No fee data available for wallet ${wallet}`);
    }
    
    // Find exact match
    const exactMatch = scenarios.find(s => s.messageCount === messageCount);
    if (exactMatch) {
      const fee = this.getFee(wallet, exactMatch.scenario);
      const result: InterpolatedFeeData = {
        fee,
        messageCount,
        isInterpolated: false,
        baseScenarios: [exactMatch.scenario]
      };
      this.interpolationCache.set(cacheKey, result);
      return result;
    }
    
    // Find lower and upper bounds for interpolation
    let lowerBound = scenarios[0];
    let upperBound = scenarios[scenarios.length - 1];
    
    for (let i = 0; i < scenarios.length - 1; i++) {
      if (scenarios[i].messageCount < messageCount && scenarios[i + 1].messageCount > messageCount) {
        lowerBound = scenarios[i];
        upperBound = scenarios[i + 1];
        break;
      }
    }
    
    // If message count is outside available range, use nearest bound
    if (messageCount < lowerBound.messageCount) {
      const fee = this.getFee(wallet, lowerBound.scenario);
      const result: InterpolatedFeeData = {
        fee,
        messageCount,
        isInterpolated: true,
        baseScenarios: [lowerBound.scenario]
      };
      this.interpolationCache.set(cacheKey, result);
      return result;
    }
    
    if (messageCount > upperBound.messageCount) {
      const fee = this.getFee(wallet, upperBound.scenario);
      const result: InterpolatedFeeData = {
        fee,
        messageCount,
        isInterpolated: true,
        baseScenarios: [upperBound.scenario]
      };
      this.interpolationCache.set(cacheKey, result);
      return result;
    }
    
    // Perform linear interpolation
    const lowerFee = this.getFee(wallet, lowerBound.scenario);
    const upperFee = this.getFee(wallet, upperBound.scenario);
    
    const ratio = (messageCount - lowerBound.messageCount) / (upperBound.messageCount - lowerBound.messageCount);
    
    const interpolatedFee: FeeData = {
      gas: Math.round(lowerFee.gas + (upperFee.gas - lowerFee.gas) * ratio),
      compute_fee_nanoton: Math.round(lowerFee.compute_fee_nanoton + (upperFee.compute_fee_nanoton - lowerFee.compute_fee_nanoton) * ratio),
      storage_fee_nanoton: Math.round(lowerFee.storage_fee_nanoton + (upperFee.storage_fee_nanoton - lowerFee.storage_fee_nanoton) * ratio),
      import_fee_nanoton: Math.round(lowerFee.import_fee_nanoton + (upperFee.import_fee_nanoton - lowerFee.import_fee_nanoton) * ratio),
      total_fwd_fees_nanoton: Math.round(lowerFee.total_fwd_fees_nanoton + (upperFee.total_fwd_fees_nanoton - lowerFee.total_fwd_fees_nanoton) * ratio),
      forward_only_nanoton: Math.round(lowerFee.forward_only_nanoton + (upperFee.forward_only_nanoton - lowerFee.forward_only_nanoton) * ratio),
      action_fee_nanoton: Math.round(lowerFee.action_fee_nanoton + (upperFee.action_fee_nanoton - lowerFee.action_fee_nanoton) * ratio),
      total_fee_nanoton: Math.round(lowerFee.total_fee_nanoton + (upperFee.total_fee_nanoton - lowerFee.total_fee_nanoton) * ratio),
      reported_total_nanoton: Math.round(lowerFee.reported_total_nanoton + (upperFee.reported_total_nanoton - lowerFee.reported_total_nanoton) * ratio),
      true_network_total_nanoton: Math.round(lowerFee.true_network_total_nanoton + (upperFee.true_network_total_nanoton - lowerFee.true_network_total_nanoton) * ratio),
      transactions: lowerFee.transactions + (upperFee.transactions - lowerFee.transactions) * ratio > 1 ? 2 : 1
    };
    
    const result: InterpolatedFeeData = {
      fee: interpolatedFee,
      messageCount,
      isInterpolated: true,
      baseScenarios: [lowerBound.scenario, upperBound.scenario]
    };
    
    this.interpolationCache.set(cacheKey, result);
    return result;
  }

  /**
   * Calculate required balance for wallet scenario with 0.1 TON buffer
   * @param wallet Wallet type (e.g., 'WalletV3', 'HighloadWalletV3')
   * @param scenario Scenario name (e.g., 'simple_transfer', 'batch_4_messages')
   * @param transferAmount Amount per transfer in nanotons
   * @param useFixedBuffer Use fixed 0.1 TON buffer instead of percentage (default: true)
   * @param bufferPercent Buffer percentage (only used if useFixedBuffer is false, default 20%)
   * @returns Required balance in nanotons
   */
  getRequiredBalance(
    wallet: string, 
    scenario: string, 
    transferAmount: bigint,
    useFixedBuffer: boolean = true,
    bufferPercent: number = 20
  ): bigint {
    const fee = this.getFee(wallet, scenario);
    const messageCount = this.getMessageCount(scenario);
    
    // Total transfer amount
    const transferTotal = transferAmount * BigInt(messageCount);
    
    // Calculate fee with buffer
    let feeWithBuffer: bigint;
    if (useFixedBuffer) {
      // Use fixed 0.1 TON buffer as required
      feeWithBuffer = BigInt(fee.true_network_total_nanoton) + this.BUFFER_TON;
    } else {
      // Use percentage buffer for backward compatibility
      feeWithBuffer = BigInt(fee.true_network_total_nanoton) * BigInt(100 + bufferPercent) / 100n;
    }
    
    // Required balance = transfers + fee with buffer
    return transferTotal + feeWithBuffer;
  }

  /**
   * Calculate required balance for custom message count with interpolation
   * @param wallet Wallet type
   * @param messageCount Number of messages
   * @param transferAmount Amount per transfer in nanotons
   * @param useFixedBuffer Use fixed 0.1 TON buffer (default: true)
   * @param bufferPercent Buffer percentage (only used if useFixedBuffer is false, default 20%)
   * @returns Required balance in nanotons
   */
  getRequiredBalanceForMessageCount(
    wallet: string,
    messageCount: number,
    transferAmount: bigint,
    useFixedBuffer: boolean = true,
    bufferPercent: number = 20
  ): bigint {
    const interpolatedData = this.interpolateFee(wallet, messageCount);
    
    // Total transfer amount
    const transferTotal = transferAmount * BigInt(messageCount);
    
    // Calculate fee with buffer
    let feeWithBuffer: bigint;
    if (useFixedBuffer) {
      // Use fixed 0.1 TON buffer as required
      feeWithBuffer = BigInt(interpolatedData.fee.true_network_total_nanoton) + this.BUFFER_TON;
    } else {
      // Use percentage buffer for backward compatibility
      feeWithBuffer = BigInt(interpolatedData.fee.true_network_total_nanoton) * BigInt(100 + bufferPercent) / 100n;
    }
    
    // Required balance = transfers + fee with buffer
    return transferTotal + feeWithBuffer;
  }

  /**
   * Get fee breakdown for display with detailed components
   */
  getFeeBreakdown(wallet: string, scenario: string): FeeBreakdown {
    const fee = this.getFee(wallet, scenario);
    const messageCount = this.getMessageCount(scenario);
    
    return {
      fee,
      messageCount,
      totalFeeNano: BigInt(fee.true_network_total_nanoton),
      totalFeeTon: (Number(fee.true_network_total_nanoton) / 1e9).toFixed(6),
      computeFeeTon: (Number(fee.compute_fee_nanoton) / 1e9).toFixed(6),
      storageFeeTon: (Number(fee.storage_fee_nanoton) / 1e9).toFixed(6),
      importFeeTon: (Number(fee.import_fee_nanoton) / 1e9).toFixed(6),
      forwardFeesTon: (Number(fee.total_fwd_fees_nanoton) / 1e9).toFixed(6),
      actionFeeTon: (Number(fee.action_fee_nanoton) / 1e9).toFixed(6),
      isInterpolated: false,
      baseScenarios: [scenario]
    };
  }

  /**
   * Get fee breakdown for custom message count with interpolation
   */
  getFeeBreakdownForMessageCount(wallet: string, messageCount: number): FeeBreakdown {
    const interpolatedData = this.interpolateFee(wallet, messageCount);
    const fee = interpolatedData.fee;
    
    return {
      fee,
      messageCount,
      totalFeeNano: BigInt(fee.true_network_total_nanoton),
      totalFeeTon: (Number(fee.true_network_total_nanoton) / 1e9).toFixed(6),
      computeFeeTon: (Number(fee.compute_fee_nanoton) / 1e9).toFixed(6),
      storageFeeTon: (Number(fee.storage_fee_nanoton) / 1e9).toFixed(6),
      importFeeTon: (Number(fee.import_fee_nanoton) / 1e9).toFixed(6),
      forwardFeesTon: (Number(fee.total_fwd_fees_nanoton) / 1e9).toFixed(6),
      actionFeeTon: (Number(fee.action_fee_nanoton) / 1e9).toFixed(6),
      isInterpolated: interpolatedData.isInterpolated,
      baseScenarios: interpolatedData.baseScenarios
    };
  }

  /**
   * Get all available scenarios for a wallet
   */
  getAvailableScenarios(wallet: string): string[] {
    const scenarios: string[] = [];
    
    for (const [key] of this.feeData.keys()) {
      if (key.startsWith(`${wallet}_`)) {
        scenarios.push(key.substring(wallet.length + 1));
      }
    }
    
    return scenarios;
  }

  /**
   * Get all loaded wallets
   */
  getLoadedWallets(): string[] {
    const wallets = new Set<string>();
    
    for (const [key] of this.feeData.keys()) {
      const wallet = key.split('_')[0];
      wallets.add(wallet);
    }
    
    return Array.from(wallets);
  }

  /**
   * Get fee data by wallet type and scenario type with type safety
   */
  getFeeByType(walletType: WalletType, scenarioType: ScenarioType): FeeData {
    return this.getFee(walletType, scenarioType);
  }

  /**
   * Get required balance by wallet type and scenario type with type safety
   */
  getRequiredBalanceByType(
    walletType: WalletType,
    scenarioType: ScenarioType,
    transferAmount: bigint,
    useFixedBuffer: boolean = true,
    bufferPercent: number = 20
  ): bigint {
    return this.getRequiredBalance(walletType, scenarioType, transferAmount, useFixedBuffer, bufferPercent);
  }

  /**
   * Get fee breakdown by wallet type and scenario type with type safety
   */
  getFeeBreakdownByType(walletType: WalletType, scenarioType: ScenarioType): FeeBreakdown {
    return this.getFeeBreakdown(walletType, scenarioType);
  }

  /**
   * Clear interpolation cache
   */
  clearCache(): void {
    this.interpolationCache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { feeDataEntries: number; cacheEntries: number } {
    return {
      feeDataEntries: this.feeData.size,
      cacheEntries: this.interpolationCache.size
    };
  }
}