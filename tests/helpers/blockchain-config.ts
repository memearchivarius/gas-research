import { beginCell, Cell, Dictionary } from '@ton/core';
import { Blockchain } from '@ton/sandbox';

// Modifies blockchain config to set TVM version
function setGlobalVersion(blockchainConfig: Cell, version: number, capabilities?: bigint): Cell {
    const parsedConfig = Dictionary.loadDirect(
        Dictionary.Keys.Int(32),
        Dictionary.Values.Cell(),
        blockchainConfig
    );

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

/**
 * Activate a specific TVM version (default 11) to match network behavior.
 */
export function activateTVM(blockchain: Blockchain, version = 11) {
    blockchain.setConfig(setGlobalVersion(blockchain.config, version));
}

/**
 * Backward-compatible helper for TVM 11.
 */
export function activateTVM11(blockchain: Blockchain) {
    activateTVM(blockchain, 11);
}
