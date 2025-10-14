import { CompilerConfig } from '@ton/blueprint';

export const compile: CompilerConfig = {
    lang: 'func',
    targets: ['contracts/imports/stdlib-highload.fc', 'contracts/wallets/highload-wallet-v3.fc'],
};

export default compile;
