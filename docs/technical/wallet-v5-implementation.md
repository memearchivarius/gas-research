# Wallet V5 Sandbox Feature Guide

## 1. Contract Mechanics Snapshot

### 1.1 Storage Layout and Persistence

The contract keeps its state in a compact cell with lazy load/save helpers, which the sandbox must emulate when crafting initial data cells.

```1:18:contracts_Tolk/05_wallet-v5/storage.tolk
type ExtensionsDict = map<uint256, bool>

struct Storage {
    isSignatureAllowed: bool
    seqno: uint32
    subwalletId: uint32
    publicKey: uint256
    extensions: ExtensionsDict      // from address hash to true
}

fun Storage.load() {
    return Storage.fromCell(contract.getData())
}

fun Storage.save(self) {
    contract.setData(self.toCell())
}
```

### 1.2 Message and Extra-Action Schema

Wallet v5 recognises three high-level messages plus a snake-form extra action list. Porting to another contract requires mirroring these layouts.

```3:58:contracts_Tolk/05_wallet-v5/messages.tolk
struct (0x02) AddExtensionExtraAction {
    addr: address
}

struct (0x03) RemoveExtensionExtraAction {
    addr: address
}

struct (0x04) SetSignatureAllowedExtraAction {
    allowSignature: bool
}

type ExtraAction =
    | AddExtensionExtraAction
    | RemoveExtensionExtraAction
    | SetSignatureAllowedExtraAction

type SnakedExtraActions = RemainingBitsAndRefs

struct (0x6578746E) ExtensionActionRequest {
    queryId: uint64
    outActions: OutActionsCell?
    hasExtraActions: bool
    extraActions: SnakedExtraActions
}

struct (0x73696E74) InternalSignedRequest {
    walletId: uint32
    validUntil: uint32
    seqno: uint32
    outActions: OutActionsCell?
    hasExtraActions: bool
    extraActions: SnakedExtraActions
}

struct (0x7369676E) ExternalSignedRequest {
    walletId: uint32
    validUntil: uint32
    seqno: uint32
    outActions: OutActionsCell?
    hasExtraActions: bool
    extraActions: SnakedExtraActions
}
```

### 1.3 Execution Flow and Authorization Rules

Extra actions run in a loop, enforcing workchain-lock and signature-mode toggles. Any sandbox workflow must preserve these assertions.

```9:67:contracts_Tolk/05_wallet-v5/wallet-v5-contract.tolk
@inline_ref
fun processExtraActions(extraActions: SnakedExtraActions, isExtension: bool) {
    while (true) {
        val action = lazy ExtraAction.fromSlice(extraActions);
        match (action) {
            AddExtensionExtraAction => {
                var (extensionWorkchain, extensionAddrHash) = action.addr.getWorkchainAndHash();
                var myWorkchain = contract.getAddress().getWorkchain();
                assert (myWorkchain == extensionWorkchain) throw ERROR_EXTENSION_WRONG_WORKCHAIN;

                var storage = lazy Storage.load();
                val inserted = storage.extensions.addIfNotExists(extensionAddrHash, true);
                assert (inserted) throw ERROR_ADD_EXTENSION;
                storage.save();
            }

            RemoveExtensionExtraAction => {
                var (extensionWorkchain, extensionAddrHash) = action.addr.getWorkchainAndHash();
                var myWorkchain = contract.getAddress().getWorkchain();
                assert (myWorkchain == extensionWorkchain) throw ERROR_EXTENSION_WRONG_WORKCHAIN;

                var storage = lazy Storage.load();
                val removed = storage.extensions.delete(extensionAddrHash);
                assert (removed) throw ERROR_REMOVE_EXTENSION;
                if (!storage.isSignatureAllowed) {
                    assert (!storage.extensions.isEmpty()) throw ERROR_REMOVE_LAST_EXTENSION_WHEN_SIGNATURE_DISABLED;
                }
                storage.save();
            }

            SetSignatureAllowedExtraAction => {
                assert (isExtension) throw ERROR_ONLY_EXTENSION_CAN_CHANGE_SIGNATURE_MODE;

                var storage = lazy Storage.load();
                assert (storage.isSignatureAllowed != action.allowSignature) throw ERROR_THIS_SIGNATURE_MODE_ALREADY_SET;
                if (!action.allowSignature) {
                    assert (!storage.extensions.isEmpty()) throw ERROR_DISABLE_SIGNATURE_WHEN_EXTENSIONS_IS_EMPTY;
                }
                storage.isSignatureAllowed = action.allowSignature;
                storage.save();
            }

            else => throw ERROR_UNSUPPORTED_ACTION
        }
        if (!extraActions.hasNext()) {
            return;
        }
        extraActions = extraActions.getNext();
    }
}
```

External and internal messages share signature checks, seqno handling, and C5 register validation.

```76:134:contracts_Tolk/05_wallet-v5/wallet-v5-contract.tolk
fun onExternalMessage(inMsgBody: slice) {
    var signature = inMsgBody.getLastBits(SIZE_SIGNATURE);
    var signedSlice = inMsgBody.removeLastBits(SIZE_SIGNATURE);

    var msg = AllowedExternalMessageToWalletV5.fromSlice(signedSlice, {
        throwIfOpcodeDoesNotMatch: ERROR_INVALID_MESSAGE_OPERATION,
    });

    var storage = lazy Storage.load();

    assert (isSignatureValid(signedSlice.hash(), signature, storage.publicKey)) throw ERROR_INVALID_SIGNATURE;
    assert (storage.isSignatureAllowed | storage.extensions.isEmpty()) throw ERROR_SIGNATURE_DISABLED;
    assert (msg.seqno == storage.seqno) throw ERROR_INVALID_SEQNO;
    assert (msg.walletId == storage.subwalletId) throw ERROR_INVALID_WALLET_ID;
    assert (msg.validUntil > blockchain.now()) throw ERROR_EXPIRED;

    acceptExternalMessage();

    storage.isSignatureAllowed = true;
    storage.seqno += 1;
    storage.save();

    commitContractDataAndActions();
    processActions(msg.outActions, msg.hasExtraActions, msg.extraActions, true, false);
}

@on_bounced_policy("manual")
fun onInternalMessage(in: InMessage) {
    val msg = lazy AllowedMessageToWalletV5.fromSlice(in.body);

    match (msg) {
        InternalSignedRequest => {
            val bodyLongEnough = in.body.remainingBitsCount() >= SIZE_SIGNATURE + 128;
            if (!bodyLongEnough) {
                return;
            }

            var signature = in.body.getLastBits(SIZE_SIGNATURE);
            var signedSlice = in.body.removeLastBits(SIZE_SIGNATURE);

            var storage = lazy Storage.load();
            if (!isSignatureValid(signedSlice.hash(), signature, storage.publicKey)) {
                return;
            }

            assert (storage.isSignatureAllowed | storage.extensions.isEmpty()) throw ERROR_SIGNATURE_DISABLED;
            assert (msg.seqno == storage.seqno) throw ERROR_INVALID_SEQNO;
            assert (msg.walletId == storage.subwalletId) throw ERROR_INVALID_WALLET_ID;
            assert (msg.validUntil > blockchain.now()) throw ERROR_EXPIRED;

            storage.isSignatureAllowed = true;
            storage.seqno += 1;
            storage.save();

            processActions(msg.outActions, msg.hasExtraActions, msg.extraActions, false, false);
        }

        ExtensionActionRequest => {
            var (senderWorkchain, senderAddrHash) = in.senderAddress.getWorkchainAndHash();
            var myWorkchain = contract.getAddress().getWorkchain();
            if (myWorkchain != senderWorkchain) {
                return;
            }

            val storage = lazy Storage.load();
            if (!storage.extensions.exists(senderAddrHash)) {
                return;
            }

            processActions(msg.outActions, msg.hasExtraActions, msg.extraActions, false, true);
        }
    }
}
```

### 1.4 Outbound Action Verification

The sandbox must attach valid C5 cells. Wallet v5 performs explicit validation that only send-message actions appear and enforces `IGNORE_ERRORS` for external sends.

```28:54:contracts_Tolk/05_wallet-v5/c5-register-validation.tolk
fun OutActionsCell.verifyC5Actions(self, isExternal: bool): self {
    var count = 0;

    var cs = self.beginParseAllowExotic();
    do {
        var (nBits, nRefs) = cs.remainingBitsAndRefsCount();
        assert (nRefs == 2)      throw ERROR_INVALID_C5;
        assert (nBits == 32 + 8) throw ERROR_INVALID_C5;

        val outAction = lazy OutActionWithSendMessageOnly.fromSlice(cs, {
            throwIfOpcodeDoesNotMatch: ERROR_INVALID_C5
        });

        if (isExternal) {
            assert (outAction.sendMode & SEND_MODE_IGNORE_ERRORS) throw ERROR_EXTERNAL_SEND_MESSAGE_MUST_HAVE_IGNORE_ERRORS_SEND_MODE;
        }

        cs = outAction.prev.beginParseAllowExotic();
        count += 1;
    } while (!cs.isEmpty());

    assert (count <= 255) throw ERROR_INVALID_C5;
    return self;
}
```

## 2. Runtime & Compilation Tooling

### 2.1 Custom Compiler Driver

`myCompile` selects the Tolk compiler, stores FIF outputs, and upgrades blockchain configuration to TVM 11 for sandbox parity.

```1:121:tests/my-compile.ts
import { beginCell, Cell, Dictionary } from "@ton/core";
import {extractCompilableConfig} from "@ton/blueprint/dist/compile/compile";
import {doCompileFunc} from "@ton/blueprint/dist/compile/func/compile.func";
import fs from "fs";
import {doCompileTolk} from "@ton/blueprint/dist/compile/tolk/compile.tolk";
import { Blockchain } from '@ton/sandbox'

// ... existing code ...

export function activateTVM11(blockchain: Blockchain) {
    blockchain.setConfig(setGlobalVersion(blockchain.config, 11));
}

export async function myCompile(numericFolder: string, contractName: string): Promise<Cell> {
    const compileTsFileName = WRAPPERS_ROOT + numericFolder + '/' + contractName + '.compile.ts';
    const config = extractCompilableConfig(compileTsFileName);
    try {
        let codeCell: Cell;
        let fiftOutput: string;
        if (config.lang === 'func') {
            let funcResult = await doCompileFunc({
                targets: config.targets!,
                sources: path => fs.readFileSync(CONTRACTS_FUNC_ROOT + numericFolder + '/' + path, 'utf-8'),
                optLevel: 2,
            });
            codeCell = funcResult.code;
            fiftOutput = funcResult.fiftCode;
        } else if (config.lang === 'tolk') {
            let tolkResult = await doCompileTolk({
                entrypointFileName: config.entrypoint,
                optimizationLevel: config.optimizationLevel,
                experimentalOptions: config.experimentalOptions,
                withSrcLineComments: config.withSrcLineComments,
                withStackComments: config.withStackComments,
                fsReadCallback: path => fs.readFileSync(CONTRACTS_TOLK_ROOT + numericFolder + '/' + path, 'utf-8'),
            });
            codeCell = tolkResult.code;
            fiftOutput = tolkResult.fiftCode;
        } else {
            throw "Unknown compiler type: " + config.lang;
        }

        saveFiftOutput(numericFolder, contractName, fiftOutput);
        return codeCell;
    } catch (ex) {
        process.stdout.write(`❌ Compilation failed for ${numericFolder}/${contractName}\n\n`);
        process.stdout.write((ex as any).toString());
        process.exit(1);
    }
}
```

### 2.2 Library Handling

Wallet v5 exports code as an exotic library cell and injects it into the sandbox’s global libraries, which is crucial for deterministic addresses.

```1:62:wrappers/05_wallet-v5/library-deployer.ts
export function buildBlockchainLibraries(libs: Cell[]): Cell {
    const libraries = Dictionary.empty(Dictionary.Keys.BigUint(256), Dictionary.Values.Cell());
    libs.forEach(lib => libraries.set(BigInt('0x' + lib.hash().toString('hex')), lib));

    return beginCell().storeDictDirect(libraries).endCell();
}

export class LibraryDeployer implements Contract {
    static exportLibCode(code: Cell) {
        const bits = new BitBuilder();
        bits.writeUint(2, 8);
        bits.writeUint(BigInt('0x' + code.hash().toString('hex')), 256);

        return new Cell({ exotic: true, bits: bits.build() });
    }

    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

    static createFromConfig(config: LibraryDeployerConfig, code: Cell, workchain = -1) {
        const data = config.libraryCode;
        const init = { code, data };
        return new LibraryDeployer(contractAddress(workchain, init), init);
    }
}
```

## 3. Sandbox Interaction Patterns

### 3.1 Wrapper Contract Helpers

The TypeScript wrapper creates data cells, exposes getters, and simplifies sending different message types. Reuse these helpers when modelling a new contract.

```24:173:wrappers/05_wallet-v5/wallet-v5.ts
export type WalletV5Config = {
    signatureAllowed: boolean;
    seqno: number;
    walletId: bigint;
    publicKey: Buffer;
    extensions: Dictionary<bigint, bigint>;
};

export function walletV5ConfigToCell(config: WalletV5Config): Cell {
    return beginCell()
        .storeBit(config.signatureAllowed)
        .storeUint(config.seqno, 32)
        .storeUint(config.walletId, 32)
        .storeBuffer(config.publicKey, 32)
        .storeDict(config.extensions, Dictionary.Keys.BigUint(256), Dictionary.Values.BigInt(1))
        .endCell();
}

export class WalletV5 implements Contract {
    static createFromConfig(config: WalletV5Config, code: Cell, workchain = 0) {
        const data = walletV5ConfigToCell(config);
        const init = { code, data };
        return new WalletV5(contractAddress(workchain, init), init);
    }

    async sendInternalSignedMessage(
        provider: ContractProvider,
        via: Sender,
        opts: {
            value: bigint;
            body: Cell;
        }
    ) {
        await provider.internal(via, {
            value: opts.value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeSlice(opts.body.beginParse())
                .endCell()
        });
    }

    async sendExternalSignedMessage(provider: ContractProvider, body: Cell) {
        await provider.external(body);
    }
}
```

### 3.2 Action Builders and Snake Encoding

Action factories ensure extra actions precede out actions and guarantee `SendMode` flags. This is vital for generating valid payloads in test harnesses.

```4:137:tests/05_wallet-v5/actions.ts
export class ActionSendMsg {
    public static readonly tag = 0x0ec3c86d;

    constructor(public readonly mode: SendMode, public readonly outMsg: MessageRelaxed) {}

    public serialize(): Cell {
        return beginCell()
            .storeUint(this.tag, 32)
            .storeUint(this.mode | SendMode.IGNORE_ERRORS, 8)
            .storeRef(beginCell().store(storeMessageRelaxed(this.outMsg)).endCell())
            .endCell();
    }
}

export function packActionsList(actions: (OutAction | ExtendedAction)[]): Cell {
    return packActionsListExtended(actions);
}
```

### 3.3 Bench Utilities for Authenticated Payloads

Utilities cover seqno tracking, action list assembly, and extension message envelopes—reuse them when porting behaviour.

```5:85:tests/05_wallet-v5/bench-utils.ts
export async function sendInternalMessageFromExtension(
    via: SandboxContract<TreasuryContract>,
    to: Address,
    opts: {
        value: bigint;
        body: Cell;
    }
) {
    return await via.send({
        to,
        value: opts.value,
        body: beginCell()
            .storeUint(Opcodes.auth_extension, 32)
            .storeUint(0, 64)
            .storeSlice(opts.body.asSlice())
            .endCell()
    });
}

export function createSeqnoCounter() {
    let seqno = 0n;
    let step = 0;
    return () => {
        if (step++ % 2 === 1) {
            return seqno++;
        } else {
            return seqno;
        }
    };
}
```

## 4. Test Suites as Usage Recipes

### 4.1 Gas Benchmark Flows

`wallet-v5-bench.spec.ts` demonstrates canonical external/internal transfers, extension authorisation, and gas logging. The `sendSignedActionBody` helper signs payloads based on the wrapper schemas, which is essential for sandbox emulation.

```37:166:tests/05_wallet-v5/wallet-v5-bench.spec.ts
async function sendSignedActionBody(walletAddress: Address, actions: Cell, kind: 'external' | 'internal') {
    const seqnoValue = seqno();
    const requestToSign = beginCell()
        .storeUint(kind === 'external' ? Opcodes.auth_signed : Opcodes.auth_signed_internal, 32)
        .storeUint(SUBWALLET_ID, 32)
        .storeUint(validUntil(), 32)
        .storeUint(seqnoValue, 32)
        .storeSlice(actions.asSlice());

    const operationHash = requestToSign.endCell().hash();
    const signature = sign(operationHash, keypair.secretKey);

    const dataCell = beginCell().storeBuffer(signature, 64).asSlice();
    const operationMsg = requestToSign.storeBuilder(dataCell.asBuilder()).endCell();

    return await (kind === 'external'
        ? blockchain.sendMessage(
              external({
                  to: walletAddress,
                  body: operationMsg,
              }),
          )
        : deployer.send({
              to: walletAddress,
              value: toNano('0.1'),
              body: operationMsg,
          }));
}
```

### 4.2 Extension Management Scenarios

The extension spec covers granting, revoking, and enforcing signature-mode toggles through sandbox interactions. These cases verify that message builders and contract logic stay in sync.

```100:365:tests/05_wallet-v5/wallet-v5-extensions.spec.ts
const receipt = await walletV5.sendInternalMessageFromExtension(sender, {
    value: toNano('0.1'),
    body: packActionsList([
        new ActionSetSignatureAuthAllowed(true),
        new ActionRemoveExtension(sender.address!),
    ]),
});

expect(receipt.transactions.length).toEqual(2);

const isSignatureAuthAllowed1 = await walletV5.getIsSignatureAuthAllowed();
expect(isSignatureAuthAllowed1).toEqual(-1);

const contract_seqno = await walletV5.getSeqno();
expect(contract_seqno).toEqual(seqno);
```

### 4.3 Error-Path Assurance

The external spec exercises negative cases for seqno, signature, and opcode mismatches, ensuring sandbox emulation surfaces the same exit codes.

```379:712:tests/05_wallet-v5/wallet-v5-external.spec.ts
const receipt = await walletV5.sendExternalSignedMessage(createBody(actionsList));

expect(
    (
        (receipt.transactions[0].description as TransactionDescriptionGeneric)
            .computePhase as TransactionComputeVm
    ).exitCode
).toEqual(ErrorsV5.invalid_c5);
```

## 5. Applying These Features to Another Contract

1. **Model Storage & Messages**: Define storage structs and TL-B-compatible message/extra-action schemas. Mirror lazy load/save patterns so the sandbox can reuse wrapper utilities.
2. **Reuse Compiler Driver**: Add a `<contract>.compile.ts` entry that points to your Tolk source. Invoke `activateTVM11` and `myCompile` in tests to maintain identical VM settings.
3. **Export Library Cell**: If the contract is library-aware, call `LibraryDeployer.exportLibCode` and register it via `buildBlockchainLibraries` before deploying in tests.
4. **Create Wrapper Helpers**: Clone `wallet-v5.ts` patterns—config cell builder, deployment helpers, typed senders, and getters—to guarantee consistent payload encoding.
5. **Build Action & Payload Factories**: Fork `actions.ts` and `bench-utils.ts` to reflect your contract’s opcode set, preserving validation rules (ordering, `SendMode` flags, snake chains).
6. **Author Scenario Tests**: Translate the provided spec flows (external, internal, extension, and failure cases) into your domain. Ensure each test signs payloads using the same auth structure so sandbox behaviour matches production.
7. **Track Gas & Code Size**: Adopt the gas benchmarking pattern to compare implementations across compiler revisions, just like the `bench-snapshots/05_wallet-v5.json` history.

Following these steps keeps the sandbox harness aligned with on-chain expectations, enabling high-fidelity emulation when porting Wallet v5 mechanics to new smart contracts.


