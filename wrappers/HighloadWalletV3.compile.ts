import { CompilerConfig } from '@ton/blueprint';

const compile: CompilerConfig = {
    lang: 'func',
    targets: ['contracts/imports/stdlib-highload.fc', 'contracts/wallets/highload-wallet-v3.fc'],
};

export { compile };
export default compile;
