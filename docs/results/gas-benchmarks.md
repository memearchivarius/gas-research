# TON Wallet Gas Benchmarks

## Overview

This document contains current gas consumption measurements for different TON wallet versions in a sandbox environment with TVM 11 activation for maximum on-chain compatibility.

## Test Configuration

- **TVM Version**: 11 (activated via `activateTVM11()`)
- **Libraries**: Complete V5 library set connected for on-chain parity
- **Prices**: Current network configuration prices used (param 21/25/18)
- **Send Mode**: `SendMode.PAY_GAS_SEPARATELY`

## Current Measurement Results

### Wallet V3 (Baseline)

| Operation             | Gas Used  | Compute Fee (TON) | Total Fee (TON) | Notes                             |
| --------------------- | --------- | ----------------- | --------------- | --------------------------------- |
| Simple transfer       | **2,994** | 0.0011976         | ~0.00194        | Most efficient single transfer    |
| Transfer with comment | **2,994** | 0.0011976         | ~0.00204        | Comments don't affect compute gas |
| Batch 4 messages      | **4,920** | 0.001968          | ~0.00378        | Maximum batch size for V3         |

### Wallet V4 (Plugin-Enabled)

| Operation             | Gas Used  | Compute Fee (TON) | Total Fee (TON) | Notes                              |
| --------------------- | --------- | ----------------- | --------------- | ---------------------------------- |
| Simple transfer       | **3,308** | 0.001323          | ~0.00206        | +10.4% vs V3 due to plugin support |
| Transfer with comment | **3,308** | 0.001323          | ~0.00212        | Consistent with V3 behavior        |
| Batch 4 messages      | **5,234** | 0.002094          | ~0.00418        | Same batch limit as V3             |

### Wallet V5R1 (Modern)

| Operation              | Gas Used   | Compute Fee (TON) | Total Fee (TON) | Notes                                 |
| ---------------------- | ---------- | ----------------- | --------------- | ------------------------------------- |
| Simple transfer        | **4,939**  | 0.001976          | ~0.00286        | +64.9% vs V3, modern features         |
| Transfer with comment  | **4,939**  | 0.001976          | ~0.00289        | Same gas, slightly higher forward fee |
| Batch 4 transfers      | **7,090**  | 0.002836          | ~0.00491        | Multi-destination support             |
| **Batch 12 transfers** | **12,826** | 0.005130          | ~0.01052        | **1,069 gas per message**             |

### Highload Wallet V3 (Batch-Optimized)

| Operation              | Gas Used  | Compute Fee (TON) | Total Fee (TON) | Notes                          |
| ---------------------- | --------- | ----------------- | --------------- | ------------------------------ |
| Simple transfer        | **6,200** | 0.002480          | ~0.00332        | +107% vs V3, replay protection |
| Transfer with comment  | **6,200** | 0.002480          | ~0.00337        | No gas increase for comments   |
| **Batch 12 transfers** | **7,956** | 0.003182          | ~0.01013        | **663 gas per message**        |
| **Batch 50 transfers** | **7,956** | 0.003182          | ~0.02930        | Scales efficiently             |

## Efficiency Comparison

### Gas per Message (lower is better)

| Wallet          | Single Transfer | Batch 12 (per msg) | Efficiency vs V3  |
| --------------- | --------------- | ------------------ | ----------------- |
| **V3**          | 2,994 gas       | 1,230 gas          | Baseline          |
| **V4**          | 3,308 gas       | 1,309 gas          | +6.4%             |
| **V5**          | 4,939 gas       | **1,069 gas**      | **13.1% savings** |
| **Highload V3** | 6,200 gas       | **663 gas**        | **46.1% savings** |

### Real-World Cost Analysis (@ $5/TON)

**For 100 transfers per day:**

| Wallet          | Gas Cost | Daily Cost | Monthly Cost | Annual Savings vs V3 |
| --------------- | -------- | ---------- | ------------ | -------------------- |
| **V3**          | 299,400  | $0.60      | $18.01       | -                    |
| **V4**          | 330,800  | $0.66      | $19.85       | -$1.84               |
| **V5**          | 493,900  | $0.99      | $29.62       | -$11.61              |
| **Highload V3** | 620,000  | $1.24      | $37.22       | -$19.21              |

\*Note: Highload V3 becomes cost-effective for 50+ transfers per batch due to 1.8x higher forward fees

## Parity Implementation Details

### Library Integration

For complete on-chain parity, the following components are used:

```typescript
import { getV5BlockchainLibraries } from "../../scripts/v5-library-compiler";

// In test beforeEach
blockchain.libs = await getV5BlockchainLibraries();
```

### Library Compilation

Libraries are compiled with complete dependency sets:

```typescript
const compileResult = await doCompileFunc({
    targets: ['contracts/wallets/wallet-v5.fc'],
    sources: /* all required files */,
    optLevel: 2
});
```

### Fee Calculation

Fees are calculated using configuration prices:

```typescript
const msgPrices = getMsgPrices(blockchain.config, 0);
const fwdFees = computeMessageForwardFees(msgPrices, message);
```

## Test Commands

### Run all gas tests

```bash
npm test
```

### Run specific wallet tests

```bash
npm test WalletV3           # V3 tests
npm test WalletV4           # V4 tests
npm test WalletV5           # V5 tests
npm test HighloadWalletV3   # Highload V3 tests
npm test WalletsComparison  # Cross-wallet comparison
```

### Generate snapshots

```bash
npm test -- --testNamePattern="\[bench\]"
```

## File Structure

```
tests/
├── helpers/
│   ├── blockchain-config.ts    # TVM activation and libraries
│   └── fees.ts                 # Fee calculations
├── WalletV3.spec.ts           # V3 gas tests
├── WalletV4.spec.ts           # V4 gas tests
├── WalletV5.spec.ts           # V5 gas tests
└── HighloadWalletV3.spec.ts   # Highload V3 gas tests

scripts/
├── v5-library-compiler.ts     # Library compilation
└── compileV5Libraries.ts      # Alternative compiler

bench-snapshots/
└── *.last.json                # Current gas measurements

contracts/
├── wallets/wallet-v5.fc       # Main contract
└── imports/stdlib.fc          # Standard library
```
