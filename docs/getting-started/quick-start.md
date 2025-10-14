# 🚀 Quick Start Guide

> Get up and running with TON Wallet Gas Research in 2 minutes

## Prerequisites

- **Node.js 18+** - [Download here](https://nodejs.org/)
- **Git** - For cloning the repository

## Installation

```bash
# 1. Clone the repository
git clone https://github.com/memearchivarius/gas-research.git
cd gas-research

# 2. Install dependencies
npm install

# 3. Run all tests to verify everything works
npm test
```

**That's it!** 🎉 You're ready to explore TON wallet gas costs.

## What Just Happened?

The tests ran gas measurements for:

- **Wallet V3** - Standard wallet (baseline)
- **Wallet V4** - Plugin-enabled wallet
- **Wallet V5** - Modern batch wallet
- **Highload Wallet V3** - High-efficiency batch wallet

Each test generates detailed gas metrics saved to `bench-snapshots/` for analysis.

## Next Steps

### 🎯 **New to TON Wallets?**

1. **[Read the overview](../../README.md)** - Understand the project

### 🔧 **Want to Understand the Code?**

1. **[Technical reference](../technical/)** - Implementation details

### 📊 **Need the Research Data?**

1. **[Complete benchmarks](../results/gas-benchmarks.md)** - All measurement results
2. **[Fee analysis](../results/fee-comparison.md)** - Cost breakdown comparisons

---

## 🛠️ **Troubleshooting**

### **"Tests are failing"**

```bash
# Clear any cached data and try again
rm -rf node_modules bench-snapshots
npm install
npm test
```

### **"Permission denied" errors**

```bash
# On macOS/Linux, ensure proper permissions
chmod +x node_modules/.bin/jest
```

### **Need more detailed output?**

```bash
# Run tests with verbose logging
npm test -- --verbose

# Run specific wallet tests only
npm test WalletV3
npm test HighloadWalletV3
```

---

## 📚 **What's Next?**

After running the tests, explore:

- **`bench-snapshots/`** - Contains detailed gas measurements
- **`docs/`** - Complete documentation (organized by user type)
- **`tests/`** - Source code for each wallet implementation

**Ready to dive deeper?** → [Complete Documentation](../../README.md)

---

> **⏱️ Total time:** 2 minutes
> **🎯 Goal achieved:** Understand TON wallet gas costs and choose the right wallet for your use case
