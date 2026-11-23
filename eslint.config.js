import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', 'docs/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['packages/shared/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@gksk/server', '@gksk/client', '**/server/**', '**/client/**'],
              message: 'packages/shared không được import từ server hoặc client.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['server/**/*.ts', 'tools/**/*.ts', 'scripts/**/*.{ts,mjs,js}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
    },
  },
  {
    files: ['tools/mock-gksk-api/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@gksk/server', '@gksk/client', '**/server/**', '**/client/**'],
              message:
                'tools/mock-gksk-api không được dùng chung code với server hoặc client (chỉ dùng @gksk/shared).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['client/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@gksk/server', '**/server/**'],
              message: 'client chỉ được import từ @gksk/shared, không được import server.',
            },
          ],
        },
      ],
    },
  },
  prettierConfig,
);
