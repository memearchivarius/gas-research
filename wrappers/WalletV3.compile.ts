import { CompilerConfig } from '@ton/blueprint';

export const compile: CompilerConfig = {
    lang: 'func',
    targets: ['contracts/imports/stdlib-v3.fc', 'contracts/wallets/wallet-v3.fc'],
};

export default compile;
