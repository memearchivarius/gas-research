import { Cell, Slice, beginCell, Dictionary, DictionaryValue, Message, Transaction, SendMode, MessageRelaxed } from '@ton/core';

export type GasPrices = {
  flat_gas_limit: bigint;
  flat_gas_price: bigint;
  gas_price: bigint;
};

export type StorageValue = {
  utime_sice: number;
  bit_price_ps: bigint;
  cell_price_ps: bigint;
  mc_bit_price_ps: bigint;
  mc_cell_price_ps: bigint;
};

export class StorageStats {
  bits: bigint;
  cells: bigint;
  constructor(bits?: number | bigint, cells?: number | bigint) {
    this.bits = bits !== undefined ? BigInt(bits) : 0n;
    this.cells = cells !== undefined ? BigInt(cells) : 0n;
  }
  add(...stats: StorageStats[]) {
    let cells = this.cells, bits = this.bits;
    for (let stat of stats) {
      bits += stat.bits;
      cells += stat.cells;
    }
    return new StorageStats(bits, cells);
  }
}

export function collectCellStats(cell: Cell, visited: Array<string>, skipRoot: boolean = false): StorageStats {
  let bits = skipRoot ? 0n : BigInt(cell.bits.length);
  let cells = skipRoot ? 0n : 1n;
  let hash = cell.hash().toString();
  if (visited.includes(hash)) {
    return new StorageStats();
  } else {
    visited.push(hash);
  }
  for (let ref of cell.refs) {
    let r = collectCellStats(ref, visited);
    cells += r.cells;
    bits += r.bits;
  }
  return new StorageStats(bits, cells);
}

export function configParseMsgPrices(sc: Slice) {
  let magic = sc.loadUint(8);
  if (magic != 0xea) {
    throw Error('Invalid message prices magic number!');
  }
  return {
    lumpPrice: sc.loadUintBig(64),
    bitPrice: sc.loadUintBig(64),
    cellPrice: sc.loadUintBig(64),
    ihrPriceFactor: sc.loadUintBig(32),
    firstFrac: sc.loadUintBig(16),
    nextFrac: sc.loadUintBig(16),
  };
}

export function getGasPrices(configRaw: Cell, workchain: 0 | -1): GasPrices {
  const config = configRaw.beginParse().loadDictDirect(Dictionary.Keys.Int(32), Dictionary.Values.Cell());
  const ds = config.get(21 + workchain)!.beginParse();
  if (ds.loadUint(8) !== 0xd1) throw new Error('Invalid flat gas prices tag');
  const flat_gas_limit = ds.loadUintBig(64);
  const flat_gas_price = ds.loadUintBig(64);
  if (ds.loadUint(8) !== 0xde) throw new Error('Invalid gas prices tag');
  return { flat_gas_limit, flat_gas_price, gas_price: ds.preloadUintBig(64) };
}

export function computeGasFee(prices: GasPrices, gas: bigint): bigint {
  if (gas <= prices.flat_gas_limit) {
    return prices.flat_gas_price;
  }
  return prices.flat_gas_price + (prices.gas_price * (gas - prices.flat_gas_limit)) / 65536n;
}

export const storageValue: DictionaryValue<StorageValue> = {
  serialize: (src, builder) => {
    builder
      .storeUint(0xcc, 8)
      .storeUint(src.utime_sice, 32)
      .storeUint(src.bit_price_ps, 64)
      .storeUint(src.cell_price_ps, 64)
      .storeUint(src.mc_bit_price_ps, 64)
      .storeUint(src.mc_cell_price_ps, 64);
  },
  parse: (src) => {
    return {
      utime_sice: src.skip(8).loadUint(32),
      bit_price_ps: src.loadUintBig(64),
      cell_price_ps: src.loadUintBig(64),
      mc_bit_price_ps: src.loadUintBig(64),
      mc_cell_price_ps: src.loadUintBig(64),
    };
  },
};

export function getMsgPrices(configRaw: Cell, workchain: 0 | -1) {
  const config = configRaw.beginParse().loadDictDirect(Dictionary.Keys.Int(32), Dictionary.Values.Cell());
  const prices = config.get(25 + workchain);
  if (prices === undefined) {
    throw Error('No prices defined in config');
  }
  return configParseMsgPrices(prices.beginParse());
}

export function getStoragePrices(configRaw: Cell) {
  const config = configRaw.beginParse().loadDictDirect(Dictionary.Keys.Int(32), Dictionary.Values.Cell());
  const storageData = Dictionary.loadDirect(Dictionary.Keys.Uint(32), storageValue, config.get(18)!);
  const values = storageData.values();
  return values[values.length - 1];
}

function shr16ceil(src: bigint) {
  let rem = src % 65536n;
  let res = src / 65536n;
  if (rem != 0n) res += 1n;
  return res;
}

export function computeFwdFees(msgPrices: ReturnType<typeof configParseMsgPrices>, cells: bigint, bits: bigint) {
  return msgPrices.lumpPrice + shr16ceil(msgPrices.bitPrice * bits + msgPrices.cellPrice * cells);
}

export function computeFwdFeesVerbose(msgPrices: ReturnType<typeof configParseMsgPrices>, cells: bigint | number, bits: bigint | number) {
  const fees = computeFwdFees(msgPrices, BigInt(cells), BigInt(bits));
  const res = (fees * msgPrices.firstFrac) >> 16n;
  return { total: fees, res, remaining: fees - res };
}

export function computeDefaultForwardFee(msgPrices: ReturnType<typeof configParseMsgPrices>) {
  return msgPrices.lumpPrice - ((msgPrices.lumpPrice * msgPrices.firstFrac) >> 16n);
}

export function computeCellForwardFees(msgPrices: ReturnType<typeof configParseMsgPrices>, msg: Cell) {
  let storageStats = collectCellStats(msg, [], true);
  return computeFwdFees(msgPrices, storageStats.cells, storageStats.bits);
}

export function computeMessageForwardFees(msgPrices: ReturnType<typeof configParseMsgPrices>, msg: Message) {
  if (msg.info.type !== 'internal') throw new Error('Internal only');
  let storageStats = new StorageStats();
  let visited: Array<string> = [];
  if (msg.init) {
    let refCount = 0;
    if (msg.init.libraries) {
      refCount++;
      storageStats = storageStats.add(collectCellStats(beginCell().storeDictDirect(msg.init.libraries).endCell(), visited, true));
    }
    if (msg.init.code) {
      refCount++;
      storageStats = storageStats.add(collectCellStats(msg.init.code, visited));
    }
    if (msg.init.data) {
      refCount++;
      storageStats = storageStats.add(collectCellStats(msg.init.data, visited));
    }
    if (refCount >= 2) {
      storageStats.cells++;
      storageStats.bits += 5n;
    }
  }
  const bodyStats = collectCellStats((msg as any).body ?? beginCell().endCell(), visited, true);
  storageStats = storageStats.add(bodyStats);
  return computeFwdFeesVerbose(msgPrices, storageStats.cells, storageStats.bits);
}

export function computedGeneric<T extends Transaction>(transaction: T) {
  if (transaction.description.type !== 'generic') throw new Error('Expected generic');
  if (transaction.description.computePhase.type !== 'vm') throw new Error('Compute phase expected');
  return transaction.description.computePhase;
}

// Additional configuration setters from tolk-bench for precise gas calculation
export function setGasPrice(configRaw: Cell, prices: GasPrices, workchain: 0 | -1): Cell {
  const config = configRaw.beginParse().loadDictDirect(Dictionary.Keys.Int(32), Dictionary.Values.Cell());
  const idx = 21 + workchain;
  const ds = config.get(idx)!;
  const tail = ds.beginParse().skip(8 + 64 + 64 + 8 + 64);

  const newPrices = beginCell().storeUint(0xd1, 8)
    .storeUint(prices.flat_gas_limit, 64)
    .storeUint(prices.flat_gas_price, 64)
    .storeUint(0xde, 8)
    .storeUint(prices.gas_price, 64)
    .storeSlice(tail)
    .endCell();
  config.set(idx, newPrices);

  return beginCell().storeDictDirect(config).endCell();
}

export function setStoragePrices(configRaw: Cell, prices: StorageValue) {
  const config = configRaw.beginParse().loadDictDirect(Dictionary.Keys.Int(32), Dictionary.Values.Cell());
  const storageData = Dictionary.loadDirect(Dictionary.Keys.Uint(32), storageValue, config.get(18)!);
  storageData.set(storageData.values().length - 1, prices);
  config.set(18, beginCell().storeDictDirect(storageData).endCell());
  return beginCell().storeDictDirect(config).endCell();
}

export function setMsgPrices(configRaw: Cell, prices: ReturnType<typeof configParseMsgPrices>, workchain: 0 | -1) {
  const config = configRaw.beginParse().loadDictDirect(Dictionary.Keys.Int(32), Dictionary.Values.Cell());

  const priceCell = beginCell().storeUint(0xea, 8)
    .storeUint(prices.lumpPrice, 64)
    .storeUint(prices.bitPrice, 64)
    .storeUint(prices.cellPrice, 64)
    .storeUint(prices.ihrPriceFactor, 32)
    .storeUint(prices.firstFrac, 16)
    .storeUint(prices.nextFrac, 16)
    .endCell();
  config.set(25 + workchain, priceCell);

  return beginCell().storeDictDirect(config).endCell();
}
