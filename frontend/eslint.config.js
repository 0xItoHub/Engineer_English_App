import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  // ビルド成果物や依存パッケージは対象外
  globalIgnores(['build', 'dist', 'coverage', 'node_modules']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    rules: {
      // React Compiler 向けのルールは、コンポーネント構成を見直す段階で有効化する
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/refs': 'off',
    },
  },
  {
    // テストと設定ファイルは Node / Vitest のグローバルも利用する
    files: ['**/*.test.{ts,tsx}', 'src/setupTests.ts', 'vite.config.ts'],
    languageOptions: {
      globals: { ...globals.node, ...globals.vitest },
    },
  },
]);
