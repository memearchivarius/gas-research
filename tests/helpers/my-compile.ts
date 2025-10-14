import { beginCell, Cell, Dictionary } from "@ton/core";
import { extractCompilableConfig } from "@ton/blueprint/dist/compile/compile";
import { doCompileFunc } from "@ton/blueprint/dist/compile/func/compile.func";
import fs from "fs";
import path from "path";
import { Blockchain } from '@ton/sandbox';

const PROJECT_ROOT = path.resolve(__dirname, '../../');
const WRAPPERS_ROOT = `${PROJECT_ROOT}/wrappers/`;
const FIFT_OUTPUT_ROOT = `${PROJECT_ROOT}/fift-output/`;

// Always save fift output after compilation.
// Achieve the following structure:
// - fift-output/
// |-- HighloadWalletV3.before.fif
// |-- HighloadWalletV3.now.fif
// |-- WalletV3.before.fif
// |-- WalletV3.now.fif
// As a result, it's easy to compare fif output when making minor changes and rolling them back.
// To save specific versions for later comparison, copy fif files manually.
function saveFiftOutput(contractName: string, fiftOutput: string) {
    if (!fs.existsSync(FIFT_OUTPUT_ROOT)) {
        fs.mkdirSync(FIFT_OUTPUT_ROOT, { recursive: true });
    }
    const prevFifFileName = path.join(FIFT_OUTPUT_ROOT, `${contractName}.before.fif`);
    const curFifFileName = path.join(FIFT_OUTPUT_ROOT, `${contractName}.now.fif`);
    if (fs.existsSync(curFifFileName)) {
        fs.renameSync(curFifFileName, prevFifFileName);
    }
    fs.writeFileSync(curFifFileName, fiftOutput, 'utf-8');
}

// modifies a cell blockchainConfig so that it contains "tvmVersion = {version}" parameter
function setGlobalVersion(blockchainConfig: Cell, version: number, capabilities?: bigint) {
    const parsedConfig = Dictionary.loadDirect(Dictionary.Keys.Int(32), Dictionary.Values.Cell(), blockchainConfig);

    let changed = false;

    const param8 = parsedConfig.get(8);
    if (!param8) {
        throw new Error('[setGlobalVersion] parameter 8 is not found!');
    }

    const ds = param8.beginParse();
    const tag = ds.loadUint(8);
    const curVersion = ds.loadUint(32);

    const newValue = beginCell().storeUint(tag, 8);

    if (curVersion != version) {
        changed = true;
    }
    newValue.storeUint(version, 32);

    if (capabilities) {
        const curCapabilities = ds.loadUintBig(64);
        if (capabilities != curCapabilities) {
            changed = true;
        }
        newValue.storeUint(capabilities, 64);
    } else {
        newValue.storeSlice(ds);
    }

    // If any changes, serialize
    if (changed) {
        parsedConfig.set(8, newValue.endCell());
        return beginCell().storeDictDirect(parsedConfig).endCell();
    }

    return blockchainConfig;
}

// activate TVM 11 before it's officially voted to and turned on by default
export function activateTVM11(blockchain: Blockchain) {
    blockchain.setConfig(setGlobalVersion(blockchain.config, 11));
}

// `myCompile` is a replacement for `compile` that searches for `.compile.ts` in wrappers/ (standard)
// and also saves fif output.
export async function myCompile(contractName: string): Promise<Cell> {
    // Look for .compile.ts file in wrappers/ (standard blueprint location)
    const compileTsFileName = path.join(WRAPPERS_ROOT, `${contractName}.compile.ts`);

    if (!fs.existsSync(compileTsFileName)) {
        throw new Error(`Compile file not found in wrappers/: ${contractName}.compile.ts`);
    }

    const config = extractCompilableConfig(compileTsFileName);
    try {
        let codeCell: Cell;
        let fiftOutput: string;
        
        if (config.lang === 'func') {
            const funcResult = await doCompileFunc({
                targets: config.targets!,
                sources: (filepath: string) => {
                    // The filepath already includes the contracts/ prefix from the compile config
                    // So we read relative to PROJECT_ROOT, not CONTRACTS_ROOT
                    const fullPath = path.join(PROJECT_ROOT, filepath);
                    if (!fs.existsSync(fullPath)) {
                        throw new Error(`Source file not found: ${fullPath}`);
                    }
                    return fs.readFileSync(fullPath, 'utf-8');
                },
                optLevel: 2,
            });
            codeCell = funcResult.code;
            fiftOutput = funcResult.fiftCode;
        } else {
            // noinspection ExceptionCaughtLocallyJS
            throw new Error(`Unknown compiler type: ${config.lang}. Only 'func' is supported in gas-research.`);
        }

        saveFiftOutput(contractName, fiftOutput);
        return codeCell;
    } catch (ex) {
        process.stdout.write(`❌ Compilation failed for ${contractName}\n\n`);
        process.stdout.write((ex as any).toString());
        throw ex;
    }
}

