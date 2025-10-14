import pluginJs from '@eslint/js';
import prettier from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';
import tsPlugin from 'typescript-eslint';

export default [
  // Global ignores
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'build/**',
      'coverage/**',
      '*.min.js',
      '*.config.js',
      '*.config.ts',
      'fift-output/**',
      'bench-snapshots/**'
    ]
  },

  // Base JavaScript rules
  pluginJs.configs.recommended,

  // TypeScript rules
  ...tsPlugin.configs.recommended.map(config => ({
    ...config,
    files: ['**/*.{ts,tsx}']
  })),

  // Project-specific configuration
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest
      },
      parser: tsPlugin.parser,
      parserOptions: {
        project: './tsconfig.json',
        ecmaVersion: 'latest',
        sourceType: 'module'
      }
    },
    plugins: {
      prettier: prettier,
      '@typescript-eslint': tsPlugin.plugin
    },
    rules: {
      // Prettier integration
      'prettier/prettier': 'error',

      // TypeScript specific rules
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_'
      }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-empty-function': 'warn',

      // General JavaScript rules
      'no-console': 'warn',
      'no-debugger': 'error',
      'prefer-const': 'error',
      'no-var': 'error',

      // Import/Export rules
      'no-duplicate-imports': 'error',

      // Code quality
      'eqeqeq': ['error', 'always'],
      'curly': ['error', 'all']
    }
  },

  // Disable ESLint rules that conflict with Prettier
  prettierConfig
];