import 'dotenv/config';
import { Address, beginCell, internal, SendMode, toNano, Cell } from '@ton/core';
import { NetworkProvider } from '@ton/blueprint';
import { WalletContractV3R2 } from '@ton/ton';
import { WalletContractV4 } from '@ton/ton';
import { WalletContractV5R1 } from '@ton/ton';
import { HighloadWalletV3 } from '../wrappers/HighloadWalletV3';
import { HighloadQueryId, OutActionSendMsg } from '../wrappers/HighloadWalletV3';
import { mnemonicToPrivateKey } from '@ton/crypto';
import { compile } from '@ton/blueprint';
import { EnhancedBalanceChecker, WalletType, ScenarioType, BalanceCheckResult, TopUpResult } from './helpers/enhancedBalanceChecker';

/**
 * Scenario definition for execution
 */
interface Scenario {
  name: string;
  walletType: 'WalletV3' | 'WalletV4' | 'WalletV5' | 'HighloadWalletV3';
  mode: 'simple' | 'comment' | 'batch4' | 'batch12' | 'batch50';
  description: string;
  transferAmount: bigint;
  comment?: string;
}

/**
 * Scenario execution result with detailed metrics
 */
interface ScenarioResult {
  scenario: Scenario;
  success: boolean;
  error?: string;
  executionTime: number;
  gasUsed?: number;
  actualFee?: bigint;
  balanceCheckResult?: BalanceCheckResult;
  topUpResult?: TopUpResult;
  walletAddress?: Address;
  transactionHash?: string;
  estimatedFee?: bigint;
  feeBreakdown?: any;
}

/**
 * Execution options interface
 */
interface ExecutionOptions {
  wallets?: string[];
  scenarios?: string[];
  dryRun: boolean;
  showScenarios: boolean;
  verbose?: boolean;
  collectMetrics?: boolean;
}

/**
 * Run all wallet scenarios with precise balance management
 * 
 * Usage:
 *   npx blueprint run runAllScenarios --testnet --tonconnect
 *   npx blueprint run runAllScenarios --mainnet --tonconnect
 * 
 * Options:
 *   --wallets: Comma-separated list of wallets to test (default: all)
 *   --scenarios: Comma-separated list of scenarios to test (default: all)
 *   --dry-run: Only calculate requirements without execution
 */
export async function run(provider: NetworkProvider, args: string[]) {
  const ui = provider.ui();
  const startTime = Date.now();

  // Parse arguments
  const options = parseArguments(args);
  
  ui.write('\n🚀 Starting TON Gas Research - All Scenarios');
  ui.write('='.repeat(60));
  
  // Initialize enhanced balance checker
  const balanceChecker = new EnhancedBalanceChecker();
  
  // Show available scenarios if requested
  if (options.showScenarios) {
    balanceChecker.printAvailableScenarios();
    return;
  }

  // Define all scenarios
  const allScenarios: Scenario[] = [
    // HighloadWalletV3 scenarios
    {
      name: 'HighloadV3 Simple Transfer',
      walletType: 'HighloadWalletV3',
      mode: 'simple',
      description: 'Simple transfer without comment',
      transferAmount: toNano('0.01')
    },
    {
      name: 'HighloadV3 Transfer with Comment',
      walletType: 'HighloadWalletV3',
      mode: 'comment',
      description: 'Transfer with comment',
      transferAmount: toNano('0.01'),
      comment: 'Hello from Highload V3'
    },
    {
      name: 'HighloadV3 Batch 12 Messages',
      walletType: 'HighloadWalletV3',
      mode: 'batch12',
      description: 'Batch transfer of 12 messages',
      transferAmount: toNano('0.01')
    },
    {
      name: 'HighloadV3 Batch 50 Messages (Stress)',
      walletType: 'HighloadWalletV3',
      mode: 'batch50',
      description: 'Stress test with 50 messages',
      transferAmount: toNano('0.01')
    },
    
    // WalletV3 scenarios
    {
      name: 'WalletV3 Simple Transfer',
      walletType: 'WalletV3',
      mode: 'simple',
      description: 'Simple transfer without comment',
      transferAmount: toNano('0.01')
    },
    {
      name: 'WalletV3 Transfer with Comment',
      walletType: 'WalletV3',
      mode: 'comment',
      description: 'Transfer with comment',
      transferAmount: toNano('0.01'),
      comment: 'Hello from V3'
    },
    {
      name: 'WalletV3 Batch 4 Messages',
      walletType: 'WalletV3',
      mode: 'batch4',
      description: 'Batch transfer of 4 messages',
      transferAmount: toNano('0.01')
    },
    
    // WalletV4 scenarios
    {
      name: 'WalletV4 Simple Transfer',
      walletType: 'WalletV4',
      mode: 'simple',
      description: 'Simple transfer without comment',
      transferAmount: toNano('0.01')
    },
    {
      name: 'WalletV4 Transfer with Comment',
      walletType: 'WalletV4',
      mode: 'comment',
      description: 'Transfer with comment',
      transferAmount: toNano('0.01'),
      comment: 'Hello from V4'
    },
    {
      name: 'WalletV4 Batch 4 Messages',
      walletType: 'WalletV4',
      mode: 'batch4',
      description: 'Batch transfer of 4 messages',
      transferAmount: toNano('0.01')
    },
    
    // WalletV5 scenarios
    {
      name: 'WalletV5 Simple Transfer',
      walletType: 'WalletV5',
      mode: 'simple',
      description: 'Simple transfer without comment',
      transferAmount: toNano('0.01')
    },
    {
      name: 'WalletV5 Transfer with Comment',
      walletType: 'WalletV5',
      mode: 'comment',
      description: 'Transfer with comment',
      transferAmount: toNano('0.01'),
      comment: 'Hello from V5'
    },
    {
      name: 'WalletV5 Batch 4 Messages',
      walletType: 'WalletV5',
      mode: 'batch4',
      description: 'Batch transfer of 4 messages',
      transferAmount: toNano('0.01')
    },
    {
      name: 'WalletV5 Batch 12 Messages',
      walletType: 'WalletV5',
      mode: 'batch12',
      description: 'Batch transfer of 12 messages',
      transferAmount: toNano('0.01')
    }
  ];

  // Filter scenarios based on options
  const scenariosToRun = filterScenarios(allScenarios, options);
  
  ui.write(`\n📋 Will execute ${scenariosToRun.length} scenarios:`);
  scenariosToRun.forEach((scenario, index) => {
    ui.write(`  ${index + 1}. ${scenario.name} (${scenario.walletType} ${scenario.mode})`);
  });

  if (options.dryRun) {
    ui.write('\n🔍 DRY RUN MODE - Only calculating requirements');
    await dryRunScenarios(provider, balanceChecker, scenariosToRun);
    return;
  }

  // Get mnemonic for wallet creation
  const mnemonics = getMnemonics();
  const keyPair = await mnemonicToPrivateKey(mnemonics);
  
  // Execute scenarios
  const results: ScenarioResult[] = [];
  const receiver = provider.sender().address as Address;

  for (let i = 0; i < scenariosToRun.length; i++) {
    const scenario = scenariosToRun[i];
    
    ui.write(`\n${'='.repeat(60)}`);
    ui.write(`📝 Scenario ${i + 1}/${scenariosToRun.length}: ${scenario.name}`);
    ui.write(`${'='.repeat(60)}`);
    
    try {
      const result = await executeScenario(provider, balanceChecker, scenario, keyPair, receiver, options);
      results.push(result);
      
      if (result.success) {
        ui.write(`✅ Scenario completed successfully`);
      } else {
        ui.write(`❌ Scenario failed: ${result.error}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      ui.write(`❌ Scenario failed with error: ${errorMessage}`);
      
      results.push({
        scenario,
        success: false,
        error: errorMessage,
        executionTime: 0
      });
    }
    
    // Small delay between scenarios
    if (i < scenariosToRun.length - 1) {
      ui.write('⏳ Waiting 5 seconds before next scenario...');
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  // Print final report
  printFinalReport(results, Date.now() - startTime);
}

/**
 * Parse command line arguments with enhanced options
 */
function parseArguments(args: string[]): ExecutionOptions {
  const options: ExecutionOptions = {
    dryRun: false,
    showScenarios: false,
    verbose: false,
    collectMetrics: true
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--show-scenarios') {
      options.showScenarios = true;
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (arg === '--no-metrics') {
      options.collectMetrics = false;
    } else if (arg.startsWith('--wallets=')) {
      options.wallets = arg.substring(10).split(',').map(w => w.trim());
    } else if (arg.startsWith('--scenarios=')) {
      options.scenarios = arg.substring(12).split(',').map(s => s.trim());
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }
  }

  return options;
}

/**
 * Print usage information
 */
function printUsage() {
  console.log(`
🚀 TON Gas Research - All Scenarios Runner

Usage:
  npx blueprint run runAllScenarios [options] --testnet --tonconnect
  npx blueprint run runAllScenarios [options] --mainnet --tonconnect

Options:
  --wallets=LIST        Comma-separated list of wallets to test
                         Available: WalletV3, WalletV4, WalletV5, HighloadWalletV3
                         Default: all wallets
  
  --scenarios=LIST      Comma-separated list of scenarios to test
                         Available: simple, comment, batch4, batch12, batch50
                         Default: all scenarios
  
  --dry-run             Only calculate requirements without execution
  --show-scenarios      Display available scenarios and exit
  --verbose, -v         Enable verbose output with detailed information
  --no-metrics          Disable detailed metrics collection
  --help, -h            Show this help message

Examples:
  # Run all scenarios for all wallets
  npx blueprint run runAllScenarios --testnet --tonconnect

  # Run only simple and comment scenarios for WalletV3 and WalletV4
  npx blueprint run runAllScenarios --wallets=WalletV3,WalletV4 --scenarios=simple,comment --testnet --tonconnect

  # Dry run to calculate requirements
  npx blueprint run runAllScenarios --dry-run --testnet --tonconnect

  # Show available scenarios
  npx blueprint run runAllScenarios --show-scenarios --testnet --tonconnect
`);
}

/**
 * Filter scenarios based on options
 */
function filterScenarios(scenarios: Scenario[], options: any): Scenario[] {
  let filtered = [...scenarios];

  if (options.wallets) {
    filtered = filtered.filter(s => options.wallets.includes(s.walletType));
  }

  if (options.scenarios) {
    filtered = filtered.filter(s => options.scenarios.includes(s.mode));
  }

  return filtered;
}

/**
 * Get mnemonics from environment or use default
 */
function getMnemonics(): string[] {
  return (process.env.WALLET_MNEMONIC?.trim() ?? '').length
    ? (process.env.WALLET_MNEMONIC as string).split(' ')
    : 'burst moral give fun rain air sample time ramp chat piano auction pride steel material despair client field gift hello similar degree fame almost'.split(' ');
}

/**
 * Execute a single scenario with detailed metrics collection
 */
async function executeScenario(
  provider: NetworkProvider,
  balanceChecker: EnhancedBalanceChecker,
  scenario: Scenario,
  keyPair: any,
  receiver: Address,
  options: ExecutionOptions
): Promise<ScenarioResult> {
  const startTime = Date.now();
  const ui = provider.ui();
  
  try {
    // Create wallet based on type
    const wallet = await createWallet(provider, scenario.walletType, keyPair);
    
    // Map scenario mode to fee data key
    const scenarioKey = mapScenarioToFeeKey(scenario.mode) as ScenarioType;
    
    // Get fee breakdown for metrics
    const feeBreakdown = balanceChecker.getDetailedFeeBreakdown(
      scenario.walletType as WalletType,
      scenarioKey,
      scenario.transferAmount,
      true,
      20
    );
    
    if (options.verbose) {
      ui.write(`\n📊 Scenario Metrics:`);
      ui.write(`   Estimated Fee: ${feeBreakdown.totalFeeTon} TON`);
      ui.write(`   Compute Fee: ${feeBreakdown.computeFeeTon} TON`);
      ui.write(`   Storage Fee: ${feeBreakdown.storageFeeTon} TON`);
      ui.write(`   Forward Fee: ${feeBreakdown.forwardFeesTon} TON`);
      ui.write(`   Action Fee: ${feeBreakdown.actionFeeTon} TON`);
    }
    
    // Ensure sufficient balance
    const { balanceCheckResult, topUpResult } = await balanceChecker.ensureSufficientBalanceForScenario(
      provider,
      wallet.address,
      scenario.walletType as WalletType,
      scenarioKey,
      scenario.transferAmount,
      wallet.init
    );
    const isDeployed = balanceCheckResult.balanceInfo.isDeployed;

    // Execute the scenario
    await executeWalletScenario(provider, wallet, scenario, keyPair, receiver, isDeployed);
    
    // Wait a bit for transaction to process
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    return {
      scenario,
      success: true,
      executionTime: Date.now() - startTime,
      balanceCheckResult,
      topUpResult,
      walletAddress: wallet.address,
      estimatedFee: feeBreakdown.totalFeeNano,
      feeBreakdown
    };
  } catch (error) {
    return {
      scenario,
      success: false,
      error: error instanceof Error ? error.message : String(error),
      executionTime: Date.now() - startTime
    };
  }
}

/**
 * Create wallet instance based on type
 */
async function createWallet(provider: NetworkProvider, walletType: string, keyPair: any) {
  switch (walletType) {
    case 'WalletV3':
      return provider.open(
        WalletContractV3R2.create({
          publicKey: keyPair.publicKey,
          workchain: 0,
        })
      );
    
    case 'WalletV4':
      return provider.open(
        WalletContractV4.create({
          publicKey: keyPair.publicKey,
          workchain: 0,
        })
      );
    
    case 'WalletV5':
      const networkGlobalId = provider.network() === 'testnet' ? -3 : -239;
      return provider.open(
        WalletContractV5R1.create({
          publicKey: keyPair.publicKey,
          workchain: 0,
          walletId: { networkGlobalId },
        })
      );
    
    case 'HighloadWalletV3':
      const code = await compile('HighloadWalletV3');
      return HighloadWalletV3.createFromConfig(
        {
          publicKey: keyPair.publicKey,
          subwalletId: 0,
          timeout: 60 * 60, // 1 hour
        },
        code
      );
    
    default:
      throw new Error(`Unknown wallet type: ${walletType}`);
  }
}

/**
 * Map scenario mode to fee data key
 */
function mapScenarioToFeeKey(mode: string): string {
  switch (mode) {
    case 'simple': return 'simple_transfer';
    case 'comment': return 'transfer_with_comment';
    case 'batch4': return 'batch_4_messages';
    case 'batch12': return 'batch_12_messages';
    case 'batch50': return 'batch_50_messages';
    default: return mode;
  }
}

/**
 * Execute wallet-specific scenario with retry logic for server errors
 */
async function executeWalletScenario(
  provider: NetworkProvider,
  wallet: any,
  scenario: Scenario,
  keyPair: any,
  receiver: Address,
  isDeployed: boolean
) {
  const maxRetries = 3;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      switch (scenario.walletType) {
        case 'HighloadWalletV3':
          await executeHighloadScenario(provider, wallet, scenario, keyPair, receiver, isDeployed);
          break;
        
        case 'WalletV3':
        case 'WalletV4':
        case 'WalletV5':
          await executeRegularWalletScenario(provider, wallet, scenario, keyPair, receiver, isDeployed);
          break;
      }
      
      // Success - exit retry loop
      return;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const ui = provider.ui();
      
      // Check if it's a retryable error
      const isRetryable = errorMsg.includes('500') || 
                         errorMsg.includes('timeout') || 
                         errorMsg.includes('ECONNREFUSED') ||
                         errorMsg.includes('Request failed');
      
      if (isRetryable && attempt < maxRetries) {
        ui.write(`⚠️ Request failed (attempt ${attempt}/${maxRetries}): ${errorMsg}`);
        ui.write(`⏳ Retrying in 15 seconds...`);
        await new Promise((resolve) => setTimeout(resolve, 15000));
        continue;
      }
      
      // If not retryable or last attempt, throw the error
      throw error;
    }
  }
}

/**
 * Helper to find next available query ID (avoids duplicate query IDs)
 */
async function getNextQueryId(wallet: HighloadWalletV3, provider: any, createdAt: number, maxAttempts: number = 1024): Promise<HighloadQueryId> {
  let queryId = HighloadQueryId.fromSeqno(BigInt(createdAt % 8380414));
  let attempts = 0;
  
  while (await wallet.getProcessed(provider, queryId, true) && queryId.hasNext() && attempts < maxAttempts) {
    queryId = queryId.getNext();
    attempts++;
  }
  
  if (attempts >= maxAttempts) {
    throw new Error('Could not find available query ID after 1024 attempts');
  }
  
  return queryId;
}

/**
 * Execute HighloadWalletV3 scenario
 */
async function executeHighloadScenario(
  provider: NetworkProvider,
  wallet: HighloadWalletV3,
  scenario: Scenario,
  keyPair: any,
  receiver: Address,
  isDeployed: boolean
) {
  const contractProvider = provider.provider(wallet.address, isDeployed ? undefined : wallet.init);
  
  // Get controlled timestamp and find available query ID
  const createdAt = Math.floor(Date.now() / 1000) - 60; // 60 seconds in the past
  const queryId = await getNextQueryId(wallet, contractProvider, createdAt);
  
  if (scenario.mode === 'simple') {
    const transfer = internal({
      to: receiver,
      value: scenario.transferAmount,
      bounce: false,
      body: beginCell().endCell(),
    });
    
    await wallet.sendExternalMessage(
      contractProvider,
      keyPair.secretKey,
      {
        message: transfer,
        mode: SendMode.PAY_GAS_SEPARATELY,
        query_id: queryId,
        createdAt,
        subwalletId: 0,
        timeout: 60 * 60,
      },
    );
  } else if (scenario.mode === 'comment') {
    const transfer = internal({
      to: receiver,
      value: scenario.transferAmount,
      bounce: false,
      body: beginCell()
        .storeUint(0, 32) // text comment opcode
        .storeStringTail(scenario.comment || 'Hello from Highload V3')
        .endCell(),
    });
    
    await wallet.sendExternalMessage(
      contractProvider,
      keyPair.secretKey,
      {
        message: transfer,
        mode: SendMode.PAY_GAS_SEPARATELY,
        query_id: queryId,
        createdAt,
        subwalletId: 0,
        timeout: 60 * 60,
      },
    );
  } else if (scenario.mode === 'batch12' || scenario.mode === 'batch50') {
    const messageCount = scenario.mode === 'batch12' ? 12 : 50;
    const messages: OutActionSendMsg[] = Array.from({ length: messageCount }, (_, i) => ({
      type: 'sendMsg' as const,
      mode: SendMode.PAY_GAS_SEPARATELY,
      outMsg: internal({
        to: receiver,
        value: scenario.transferAmount,
        bounce: false,
        body: beginCell()
          .storeUint(0, 32) // text comment opcode
          .storeStringTail(`${i + 1}`) // unique comment
          .endCell(),
      }),
    }));
    
    await wallet.sendBatch(
      contractProvider,
      keyPair.secretKey,
      messages,
      0, // subwalletId
      queryId,
      60 * 60, // timeout
      toNano('0.05'), // value
      SendMode.PAY_GAS_SEPARATELY,
      createdAt,
    );
  }
}

/**
 * Execute regular wallet scenario (V3, V4, V5)
 */
async function executeRegularWalletScenario(
  provider: NetworkProvider,
  wallet: any,
  scenario: Scenario,
  keyPair: any,
  receiver: Address,
  isDeployed: boolean
) {
  const seqno = isDeployed ? await wallet.getSeqno() : 0;
  
  let messages;
  
  if (scenario.mode === 'batch4' || scenario.mode === 'batch12') {
    const messageCount = scenario.mode === 'batch4' ? 4 : 12;
    messages = Array.from({ length: messageCount }, (_, i) =>
      internal({
        to: receiver,
        value: scenario.transferAmount,
        bounce: false,
        body: beginCell()
          .storeUint(0, 32) // text comment opcode
          .storeStringTail(`${i + 1}`) // unique comment
          .endCell(),
      })
    );
  } else {
    messages = [
      internal({
        to: receiver,
        value: scenario.transferAmount,
        bounce: false,
        body: scenario.mode === 'comment' 
          ? (scenario.comment ? beginCell().storeUint(0, 32).storeStringTail(scenario.comment).endCell() : beginCell().storeUint(0, 32).storeStringTail('Hello').endCell())
          : beginCell().endCell(),
      }),
    ];
  }

  const transfer = await wallet.createTransfer({
    seqno,
    secretKey: keyPair.secretKey,
    messages,
    sendMode: SendMode.PAY_GAS_SEPARATELY,
  });

  await provider.provider(wallet.address, isDeployed ? undefined : wallet.init).external(transfer);
}

/**
 * Dry run scenarios - only calculate requirements
 */
async function dryRunScenarios(
  provider: NetworkProvider,
  balanceChecker: EnhancedBalanceChecker,
  scenarios: Scenario[]
) {
  const keyPair = await mnemonicToPrivateKey(getMnemonics());
  
  for (const scenario of scenarios) {
    const wallet = await createWallet(provider, scenario.walletType, keyPair);
    const scenarioKey = mapScenarioToFeeKey(scenario.mode);
    
    provider.ui().write(`\n📊 ${scenario.name}:`);
    provider.ui().write(`   Wallet: ${scenario.walletType}`);
    provider.ui().write(`   Mode: ${scenario.mode}`);
    provider.ui().write(`   Address: ${wallet.address.toString({ testOnly: provider.network() === 'testnet' })}`);
    
    const requiredBalance = balanceChecker.getFeeEstimator().getRequiredBalance(
      scenario.walletType,
      scenarioKey,
      scenario.transferAmount,
      false, // Use percentage buffer for backward compatibility
      20
    );
    
    provider.ui().write(`   Required balance: ${(Number(requiredBalance) / 1e9).toFixed(4)} TON`);
  }
}

/**
 * Print final execution report with detailed metrics
 */
function printFinalReport(results: ScenarioResult[], totalTime: number) {
  console.log('\n' + '='.repeat(80));
  console.log('📊 FINAL EXECUTION REPORT');
  console.log('='.repeat(80));
  
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  console.log(`\n📈 Summary:`);
  console.log(`   Total scenarios: ${results.length}`);
  console.log(`   Successful: ${successful.length}`);
  console.log(`   Failed: ${failed.length}`);
  console.log(`   Success rate: ${((successful.length / results.length) * 100).toFixed(1)}%`);
  console.log(`   Total time: ${(totalTime / 1000).toFixed(1)}s`);
  
  // Group results by wallet type
  const resultsByWallet = results.reduce((acc, result) => {
    const walletType = result.scenario.walletType;
    if (!acc[walletType]) acc[walletType] = [];
    acc[walletType].push(result);
    return acc;
  }, {} as Record<string, ScenarioResult[]>);
  
  // Print detailed results by wallet
  console.log(`\n📋 Detailed Results:`);
  for (const [walletType, walletResults] of Object.entries(resultsByWallet)) {
    console.log(`\n${walletType}:`);
    console.log('-'.repeat(40));
    
    for (const result of walletResults) {
      const status = result.success ? '✅' : '❌';
      const time = (result.executionTime / 1000).toFixed(1);
      
      console.log(`  ${status} ${result.scenario.name} (${result.scenario.mode})`);
      console.log(`     Time: ${time}s`);
      
      if (result.success && result.feeBreakdown) {
        console.log(`     Estimated Fee: ${result.feeBreakdown.totalFeeTon} TON`);
        if (result.actualFee) {
          const actualFeeTon = (Number(result.actualFee) / 1e9).toFixed(6);
          console.log(`     Actual Fee: ${actualFeeTon} TON`);
          
          // Calculate fee difference
          const estimatedFee = Number(result.feeBreakdown.totalFeeTon);
          const actualFeeNum = Number(actualFeeTon);
          const diff = ((actualFeeNum - estimatedFee) / estimatedFee * 100).toFixed(1);
          console.log(`     Fee Difference: ${diff}%`);
        }
      }
      
      if (!result.success && result.error) {
        console.log(`     Error: ${result.error}`);
      }
    }
  }
  
  // Print fee summary for successful scenarios
  if (successful.length > 0) {
    console.log(`\n💰 Fee Summary (Successful Scenarios):`);
    console.log('-'.repeat(40));
    
    const totalEstimatedFees = successful
      .filter(r => r.estimatedFee)
      .reduce((sum, r) => sum + Number(r.estimatedFee!), 0);
    
    const totalActualFees = successful
      .filter(r => r.actualFee)
      .reduce((sum, r) => sum + Number(r.actualFee!), 0);
    
    console.log(`   Total Estimated Fees: ${(totalEstimatedFees / 1e9).toFixed(6)} TON`);
    if (totalActualFees > 0) {
      console.log(`   Total Actual Fees: ${(totalActualFees / 1e9).toFixed(6)} TON`);
      const avgDiff = ((totalActualFees - totalEstimatedFees) / totalEstimatedFees * 100).toFixed(1);
      console.log(`   Average Fee Difference: ${avgDiff}%`);
    }
  }
  
  if (failed.length > 0) {
    console.log(`\n❌ Failed scenarios:`);
    failed.forEach(result => {
      console.log(`   ${result.scenario.name}: ${result.error}`);
    });
  }
  
  console.log('\n' + '='.repeat(80));
}