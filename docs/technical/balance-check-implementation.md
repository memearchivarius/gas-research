# Реализация автоматической проверки баланса и пополнения

## Что реализовано

### 1. Новый модуль `balanceChecker.ts`

Создан вспомогательный модуль `scripts/helpers/balanceChecker.ts` с функцией `ensureSufficientBalance()`, которая:

- **Проверяет состояние контракта** через TON Center API (`getAddressInformation`)
- **Определяет баланс** контракта по адресу, выведенному из мнемоники и stateInit
- **Автоматически пополняет** баланс через TonConnect, если:
  - Контракт не существует (`state === 'uninit'`)
  - Баланс ≤ 0.1 TON
  - Пополняет до 0.2 TON (`value = 0.2 - current_balance`)

### 2. Обновлены все run-скрипты

Все четыре скрипта теперь используют проверку баланса:

- `runWalletV3.ts`
- `runWalletV4.ts`
- `runWalletV5.ts`
- `runHighloadV3.ts`

### 3. Логика работы

```typescript
// 1. Вычисляется адрес контракта из мнемоники + stateInit
const wallet = WalletV5.create(...);

// 2. Проверяется состояние через API
const info = await getContractInfo(wallet.address, isTestnet);
// -> { state: 'uninit' | 'active' | 'frozen', balance: BigInt }

// 3. Если нужно, отправляется пополнение через TonConnect
if (!isDeployed && balance <= 0.1 TON) {
    await provider.sender().send({
        to: contractAddress,
        value: 0.2 TON - balance,
        bounce: false,
    });
}

// 4. Отправляется external-сообщение с/без stateInit
await provider.provider(wallet.address, isDeployed ? undefined : wallet.init).external(transfer);
```

## Использование

### Запуск с автоматическим пополнением

```bash
WALLET_MNEMONIC="your 24 words here" \
  npx blueprint run runWalletV5 --testnet --tonconnect simple
```

**Важно**: теперь всегда используется `--tonconnect` (не `--mnemonic`), чтобы при необходимости отправить пополнение.

### Примеры вывода

При первом запуске на новом адресе:

```
Checking contract state at EQAbc123...
Contract state: uninit
Current balance: 0.0000 TON
⚠️ Balance too low for deployment!
Topping up 0.2000 TON via TonConnect...
✓ Top-up transaction sent successfully
Waiting 10 seconds for confirmation...
New balance: 0.2000 TON
V5 wallet address: EQAbc123...
V5 simple message sent to EQAxyz789...
```

При повторном запуске:

```
Checking contract state at EQAbc123...
Contract state: active
Current balance: 0.1500 TON
V5 wallet address: EQAbc123...
V5 simple message sent to EQAxyz789...
```

## Настройки

В `balanceChecker.ts` определены константы:

```typescript
const MINIMUM_BALANCE = toNano('0.1');  // Порог для пополнения
const TARGET_BALANCE = toNano('0.2');   // Целевой баланс после пополнения
```

Эти значения можно изменить при необходимости.

## Обработка ошибок

- Если API недоступен → выбрасывается исключение с описанием
- Если пополнение не удалось → выбрасывается исключение с инструкцией для ручного пополнения
- После пополнения ждётся 10 секунд для подтверждения транзакции

## Преимущества

1. **Автоматизация**: не нужно вручную проверять баланс и отправлять средства
2. **Надёжность**: проверка через официальный API TON Center
3. **Гибкость**: можно избежать пополнения, отправив средства заранее
4. **Прозрачность**: все действия логируются в консоль

## Совместимость

- Работает с testnet и mainnet (автоматически определяет через `provider.network()`)
- Использует официальные API:
  - Testnet: `https://testnet.toncenter.com/api/v2`
  - Mainnet: `https://toncenter.com/api/v2`

