# Highload V3 Gas Measurement Implementation

## Summary

This document describes the comprehensive refactoring of the Highload Wallet V3 gas measurement harness in `gas-research/`. The implementation now provides accurate gas measurements and follows best practices from the `tolk-bench` project.

## Problem Statement

The original implementation had several critical issues:
1. **Incorrect gas measurement**: Only measured external transaction gas (~6.2k), missing batch execution overhead
2. **No TVM11 support**: Tests ran on default TVM config without parity to production environment
3. **No fift output**: Missing compilation artifacts for debugging and verification
4. **Inconsistent wrapper API**: Lacked deterministic helpers and proper documentation
5. **Time randomness**: Used `Date.now()` causing run-to-run variation

## Key Insight: Highload V3 Execution Model

Through testing, we discovered that **Highload V3 behavior differs based on action count**:

### Single Action (Simple Transfers)
- **Direct execution**: External message directly executes the single action
- **Gas cost**: ~6200 gas (all in external transaction)
- **Transaction count**: 2 (external-in + outgoing transfer)

### Multiple Actions (Batch Operations)
- **Internal self-transfer**: External message enqueues an internal self-transfer containing batch actions
- **Gas cost**: ~7956 gas (6200 external + 1756 internal batch execution)
- **Transaction count**: 2 + N (external-in + internal self-transfer + N outgoing transfers)

This is a **critical distinction** that was missed in the original implementation.

## Implementation

### 1. Compilation Infrastructure (`tests/my-compile.ts`)

Created a robust compilation helper that:
- Extracts compiler config from `.compile.ts` files in `wrappers/`
- Supports FunC compilation with proper path resolution
- Saves fift output to `fift-output/` for debugging (`.before.fif` and `.now.fif`)
- Provides `activateTVM11()` function to upgrade sandbox blockchain config

**Key Features:**
```typescript
// Compile with fift output
const code = await myCompile('HighloadWalletV3');

// Activate TVM11 for production parity
activateTVM11(blockchain);
```

### 2. Gas Logging Infrastructure (`tests/gas-logger.ts`)

Created `GasLogAndSave` class that:
- Aggregates gas usage across multiple transactions
- Supports both single transaction and transaction array inputs
- Calculates BOC size (bits and cells) for compiled contracts
- Saves metrics to `bench-snapshots/*.last.json` for regression tracking
- Provides immediate console feedback during test runs

**Usage:**
```typescript
const GAS_LOG = new GasLogAndSave('HighloadWalletV3');

// Remember contract size
GAS_LOG.rememberBocSize('HighloadWalletV3', code);

// Log gas for single transaction
GAS_LOG.rememberGas('simple_transfer', result.transactions[0]);

// Log gas for multiple transactions (batch operations)
GAS_LOG.rememberGas('batch_10_messages', result.transactions.slice(0, 2));

// Save all metrics at end
GAS_LOG.saveCurrentRunAfterAll();
```

### 3. Enhanced Wrapper (`wrappers/HighloadWalletV3.ts`)

Added comprehensive documentation and static helpers:
- Documented all public functions with JSDoc
- Added static `buildSignedExternalBody()` for explicit message construction
- Added static `packOutActions()` for action packing
- Improved error messages with actionable guidance

### 4. Refactored Test Suite (`tests/HighloadWalletV3.spec.ts`)

Complete rewrite with:

#### Proper Setup
```typescript
beforeAll(async () => {
    codeHighloadV3 = await myCompile('HighloadWalletV3');
    GAS_LOG = new GasLogAndSave('HighloadWalletV3');
    GAS_LOG.rememberBocSize('HighloadWalletV3', codeHighloadV3);
});

beforeEach(async () => {
    blockchain = await Blockchain.create();
    activateTVM11(blockchain);
    blockchain.now = CONTROLLED_TIMESTAMP; // Deterministic time
});
```

#### Shared Helper Functions
- `controlledTimestamp()`: Returns fixed timestamp for deterministic tests
- `createSimpleTransfer()`: Creates transfer message without comment
- `createTransferWithComment()`: Creates transfer message with comment
- `aggregateGasUsage()`: Sums gas across transaction array
- `printTransactionBreakdown()`: Detailed gas breakdown for all transactions

#### Test Coverage

**1. Simple Transfer (No Comment)**
- Gas: ~6200 gas (direct execution)
- Validates external transaction
- Validates outgoing transfer

**2. Transfer with Comment**
- Gas: ~6200 gas (direct execution)
- Validates comment payload encoding
- Same cost as simple transfer (comment doesn't affect wallet gas)

**3. Batch Transfer (10 Messages)**
- Gas: ~7956 gas (6200 + 1756 batch execution)
- Validates internal self-transfer for batch processing
- Validates all 10 outgoing transfers
- Calculates efficiency vs sequential V3 transfers (63.2% savings)

**4. Batch Transfer (50 Messages) - Stress Test**
- Gas: ~7956 gas (same batch overhead regardless of message count)
- Demonstrates scalability of batch operations
- Average: 468 gas per message when amortized

## Gas Metrics

### Final Measurements (TVM11)

| Operation | Gas Used | Notes |
|-----------|----------|-------|
| Simple transfer | 6,200 | Direct execution, no batch overhead |
| Transfer with comment | 6,200 | Comment doesn't affect wallet gas |
| Batch 10 messages | 7,956 | 6200 + 1756 batch overhead |
| Batch 50 messages | 7,956 | Same batch overhead, scales well |

### Code Size

| Metric | Value |
|--------|-------|
| Bits | 3,997 |
| Cells | 16 |

### Efficiency Analysis

Compared to sequential Wallet V3 transfers (2,994 gas each):

**10 Messages:**
- V3 sequential: 29,940 gas
- Highload batch: 11,046 gas total (7,956 wallet + 3,090 receiver processing)
- **Savings: 63.2% per message**

**50 Messages:**
- V3 sequential: 149,700 gas
- Highload batch: 23,406 gas total (7,956 wallet + 15,450 receiver processing)
- **Savings: 84.4% per message**

## Project Structure

```
gas-research/
│   └── HighloadWalletV3.compile.ts  # Moved from wrappers/
├── contracts/
│   ├── imports/
│   │   └── stdlib-highload.fc
│   └── wallets/
│       └── highload-wallet-v3.fc
├── tests/
│   ├── my-compile.ts                # NEW: Compilation helper
│   ├── gas-logger.ts                # NEW: Gas logging utility
│   └── HighloadWalletV3.spec.ts    # REFACTORED: Complete rewrite
├── wrappers/
│   ├── HighloadWalletV3.ts         # ENHANCED: Better docs, static helpers
│   └── HighloadQueryId.ts
├── bench-snapshots/                 # NEW: Gas metrics storage
│   └── HighloadWalletV3.last.json
├── fift-output/                     # NEW: Compilation artifacts
│   ├── HighloadWalletV3.before.fif
│   └── HighloadWalletV3.now.fif
└── docs/
    └── HIGHLOAD_V3_IMPLEMENTATION.md  # This file
```

## Validation

All tests pass with proper gas measurement:

```bash
$ npm test -- HighloadWalletV3.spec.ts

PASS tests/HighloadWalletV3.spec.ts
  Highload Wallet V3 Gas Measurement
    ✓ [bench] HighloadV3: simple transfer without comment (527 ms)
    ✓ [bench] HighloadV3: transfer with comment (252 ms)
    ✓ [bench] HighloadV3: batch transfer (10 messages) (284 ms)
    ✓ [bench] HighloadV3: batch transfer (50 messages) - stress test (414 ms)

Test Suites: 1 passed, 1 total
Tests:       4 passed, 4 total
```

## Lessons Learned

1. **Architecture matters**: Highload V3's conditional execution model (direct vs batch) requires careful gas accounting
2. **TVM config is critical**: TVM11 vs default config can affect gas measurements
3. **Deterministic tests**: Fixed timestamps and controlled seeds prevent flaky tests
4. **Comprehensive logging**: Detailed transaction breakdowns reveal execution patterns
5. **Reference implementations**: tolk-bench patterns (myCompile, GasLogAndSave) are battle-tested

## Future Enhancements

1. **Negative tests**: Stale timestamps, wrong subwallet, invalid signatures
2. **Recursion tests**: >254 actions requiring recursive batching
3. **Comparison suite**: Side-by-side with WalletV3/V4/V5
4. **CI integration**: Automated regression detection via bench-snapshots
5. **Documentation**: Usage examples, best practices guide

## References

- **tolk-bench**: `/Users/memearchivarius/Documents/Cursor/tolk-bench/tests/`
  - `my-compile.ts`: Compilation helper with TVM11 activation
  - `gas-logger.ts`: Gas aggregation and persistence
  - `05_wallet-v5/wallet-v5-bench.spec.ts`: Reference test structure
- **Highload V3 Spec**: Original TON docs on Highload Wallet architecture
- **TVM11 Documentation**: TON Virtual Machine version 11 specification

## Conclusion

The refactored Highload V3 gas harness now provides:
- ✅ Accurate gas measurements (accounting for execution model)
- ✅ TVM11 support (production parity)
- ✅ Fift output (debugging capability)
- ✅ Deterministic tests (no time drift)
- ✅ Comprehensive metrics (regression tracking)
- ✅ Best practices (aligned with tolk-bench)

The implementation reveals that Highload V3's true strength is **batch operations**, where the fixed overhead (~1756 gas) is amortized across many messages, achieving up to 84% gas savings compared to sequential V3 transfers.

