import { Cell, Transaction } from '@ton/core';
import { Blockchain } from '@ton/sandbox';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getMsgPrices, collectCellStats, computeFwdFees } from './fees';

const ROOT_DIR = path.resolve(__dirname, "../../bench-snapshots/");

function calculateCellsAndBits(root: Cell, visited = new Set<string>()) {
    const hash = root.hash().toString('hex');
    if (visited.has(hash)) {
        return { nBits: 0, nCells: 0 };
    }
    visited.add(hash);

    let nBits = root.bits.length;
    let nCells = 1;
    for (const ref of root.refs) {
        const childRes = calculateCellsAndBits(ref, visited);
        nBits += childRes.nBits;
        nCells += childRes.nCells;
    }
    return { nBits, nCells };
}

/**
 * Detailed fee breakdown for a transaction or set of transactions
 */
interface FeeBreakdown {
    gasUsed: number;
    computeFee: number;       // Gas fees in nanoTON
    storageFee: number;        // Storage fees in nanoTON
    importFee: number;         // Import fee for external-in messages in nanoTON
    totalFwdFees: number;      // Total forward fees (includes both fwd + action) in nanoTON
    actionFee: number;         // Action fees in nanoTON (subset of totalFwdFees)
    totalFee: number;          // Total transaction fee in nanoTON (reported by blockchain)
    trueNetworkTotal: number;  // True network cost: storage + compute + import + totalFwdFees
}

/**
 * Extract detailed fee information from a transaction
 */
function extractFeeBreakdown(tx: Transaction, blockchain?: Blockchain): FeeBreakdown {
    const breakdown: FeeBreakdown = {
        gasUsed: 0,
        computeFee: 0,
        storageFee: 0,
        importFee: 0,
        totalFwdFees: 0,
        actionFee: 0,
        totalFee: 0,
        trueNetworkTotal: 0,
    };

    if (tx.description.type !== 'generic') {
        return breakdown;
    }

    const desc = tx.description;

    // Gas and compute fees
    if (desc.computePhase.type === 'vm') {
        breakdown.gasUsed = Number(desc.computePhase.gasUsed);
        breakdown.computeFee = Number(desc.computePhase.gasFees);
    }

    // Storage fees
    if (desc.storagePhase) {
        breakdown.storageFee = Number(desc.storagePhase.storageFeesCollected);
    }

    // Action fees and Total Forward fees
    // Note: totalFwdFees includes BOTH forward fee (2/3) AND action fee (1/3)
    if (desc.actionPhase) {
        breakdown.totalFwdFees = Number(desc.actionPhase.totalFwdFees || 0n);
        breakdown.actionFee = Number(desc.actionPhase.totalActionFees || 0n);
    }

    // Import fee (for external-in messages)
    // Calculate it using the same method as C++ transaction.cpp
    if (tx.inMessage?.info.type === 'external-in' && blockchain) {
        try {
            const msgPrices = getMsgPrices(blockchain.config, 0);
            
            // Get the message cell to calculate storage stats
            const msgCell = tx.inMessage.body;
            
            // Calculate storage stats (cells and bits) for the message body
            // Note: We use skipRoot=true because "bits in the root cell are free"
            // and "the root cell itself is not counted as a cell" per transaction.cpp
            const stats = collectCellStats(msgCell, [], true);
            
            // Compute forward/IHR fees for the external message (this is the import fee)
            const importFee = computeFwdFees(msgPrices, stats.cells, stats.bits);
            
            breakdown.importFee = Number(importFee);
        } catch (error) {
            // Fallback to importFee from message info if calculation fails
            console.warn('Failed to calculate import fee, using message info:', error);
            breakdown.importFee = Number(tx.inMessage.info.importFee || 0n);
        }
    }

    // Total fees (reported by transaction)
    breakdown.totalFee = Number(tx.totalFees.coins);

    // Calculate TRUE network total for all transactions
    // Formula: storage + compute + import + totalFwdFees
    // Note: totalFwdFees already includes action fees, so don't add them separately
    breakdown.trueNetworkTotal = 
        breakdown.storageFee + 
        breakdown.computeFee + 
        breakdown.importFee + 
        breakdown.totalFwdFees;

    return breakdown;
}

/**
 * Aggregate fee breakdowns from multiple transactions
 */
function aggregateFeeBreakdowns(breakdowns: FeeBreakdown[]): FeeBreakdown {
    return breakdowns.reduce(
        (acc, b) => ({
            gasUsed: acc.gasUsed + b.gasUsed,
            computeFee: acc.computeFee + b.computeFee,
            storageFee: acc.storageFee + b.storageFee,
            importFee: acc.importFee + b.importFee,
            totalFwdFees: acc.totalFwdFees + b.totalFwdFees,
            actionFee: acc.actionFee + b.actionFee,
            totalFee: acc.totalFee + b.totalFee,
            trueNetworkTotal: acc.trueNetworkTotal + b.trueNetworkTotal,
        }),
        {
            gasUsed: 0,
            computeFee: 0,
            storageFee: 0,
            importFee: 0,
            totalFwdFees: 0,
            actionFee: 0,
            totalFee: 0,
            trueNetworkTotal: 0,
        }
    );
}

/**
 * Enhanced gas and fee logger with comprehensive metrics
 */
export class GasLogAndSave {
    private readonly contractName: string;

    private metrics: {
        [testName: string]: {
            gas: number;
            fees: {
                compute: number;
                storage: number;
                import: number;
                totalFwd: number;
                action: number;
                reportedTotal: number;
                trueNetworkTotal: number;
            };
            transactions?: number; // number of transactions involved
        };
    } = {};

    private codeSize: { [key in string]: number } = {};

    constructor(contractName: string) {
        this.contractName = contractName;
    }

    /**
     * Remember gas and detailed fee breakdown for a specific test
     */
    rememberGas(stepName: string, transaction: Transaction | Transaction[], blockchain?: Blockchain) {
        const transactions = Array.isArray(transaction) ? transaction : [transaction];

        // Extract fee breakdowns for each transaction
        const breakdowns = transactions.map(tx => extractFeeBreakdown(tx, blockchain));
        const aggregate = aggregateFeeBreakdowns(breakdowns);

        // Store metrics
        this.metrics[stepName] = {
            gas: aggregate.gasUsed,
            fees: {
                compute: aggregate.computeFee,
                storage: aggregate.storageFee,
                import: aggregate.importFee,
                totalFwd: aggregate.totalFwdFees,
                action: aggregate.actionFee,
                reportedTotal: aggregate.totalFee,
                trueNetworkTotal: aggregate.trueNetworkTotal,
            },
            transactions: transactions.length,
        };

        // Calculate forward-only portion (2/3 of totalFwdFees)
        const forwardOnly = aggregate.totalFwdFees - aggregate.actionFee;

        // Log to console for immediate feedback
        console.log(`\n=== ${stepName} ===`);
        console.log(`Gas used:        ${aggregate.gasUsed.toString().padStart(10)} gas`);
        console.log(`Compute fee:     ${aggregate.computeFee.toString().padStart(10)} nanoTON (${(aggregate.computeFee / 1e9).toFixed(6)} TON)`);
        console.log(`Storage fee:     ${aggregate.storageFee.toString().padStart(10)} nanoTON (${(aggregate.storageFee / 1e9).toFixed(6)} TON)`);
        console.log(`Import fee:      ${aggregate.importFee.toString().padStart(10)} nanoTON (${(aggregate.importFee / 1e9).toFixed(6)} TON)`);
        console.log(`Total fwd fees:  ${aggregate.totalFwdFees.toString().padStart(10)} nanoTON (${(aggregate.totalFwdFees / 1e9).toFixed(6)} TON)`);
        console.log(`  ├─ Forward:    ${forwardOnly.toString().padStart(10)} nanoTON (${(forwardOnly / 1e9).toFixed(6)} TON) [2/3]`);
        console.log(`  └─ Action:     ${aggregate.actionFee.toString().padStart(10)} nanoTON (${(aggregate.actionFee / 1e9).toFixed(6)} TON) [1/3]`);
        console.log(`---`);
        console.log(`TRUE TOTAL:      ${aggregate.trueNetworkTotal.toString().padStart(10)} nanoTON (${(aggregate.trueNetworkTotal / 1e9).toFixed(6)} TON)`);
        console.log(`Reported total:  ${aggregate.totalFee.toString().padStart(10)} nanoTON (${(aggregate.totalFee / 1e9).toFixed(6)} TON)`);
        console.log(`Transactions:    ${transactions.length}`);
    }

    /**
     * Remember contract code size
     */
    rememberBocSize(contractName: string, code: Cell) {
        const { nBits, nCells } = calculateCellsAndBits(code);
        this.codeSize[contractName + " bits"] = nBits;
        this.codeSize[contractName + " cells"] = nCells;
    }

    /**
     * Save all metrics to JSON snapshot file
     */
    saveCurrentRunAfterAll() {
        if (!fs.existsSync(ROOT_DIR)) {
            fs.mkdirSync(ROOT_DIR, { recursive: true });
        }

        const fileName = path.join(ROOT_DIR, `${this.contractName}.last.json`);

        // Create a more readable format
        const gasOnly: { [key: string]: number } = {};
        const feesDetailed: { [key: string]: any } = {};

        for (const [key, value] of Object.entries(this.metrics)) {
            gasOnly[key] = value.gas;
            feesDetailed[key] = {
                gas: value.gas,
                compute_fee_nanoton: value.fees.compute,
                storage_fee_nanoton: value.fees.storage,
                import_fee_nanoton: value.fees.import,
                total_fwd_fees_nanoton: value.fees.totalFwd,
                forward_only_nanoton: value.fees.totalFwd - value.fees.action,
                action_fee_nanoton: value.fees.action,
                true_network_total_nanoton: value.fees.trueNetworkTotal,
                reported_total_nanoton: value.fees.reportedTotal,
                transactions: value.transactions,
            };
        }

        const obj = {
            gas: gasOnly,
            fees_detailed: feesDetailed,
            codeSize: this.codeSize,
        };

        fs.writeFileSync(fileName, JSON.stringify(obj, null, 2));

        console.log(`\n✅ Gas metrics saved to ${fileName}`);
        console.log(`\n📊 Summary:`);
        console.log(`   Contract: ${this.contractName}`);
        console.log(`   Tests: ${Object.keys(this.metrics).length}`);
        console.log(`   Code size: ${this.codeSize[this.contractName + " bits"] || 'N/A'} bits, ${this.codeSize[this.contractName + " cells"] || 'N/A'} cells`);
    }

    /**
     * Get current metrics (useful for assertions in tests)
     */
    getMetrics() {
        return this.metrics;
    }
}
