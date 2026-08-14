import { defineConfig } from 'eslint/config'
import globals from 'globals'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from 'eslint-config-prettier/flat'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'

export default defineConfig(
  {
    ignores: [
      '**/node_modules',
      '**/dist',
      '**/out',
      '**/build',
      '**/coverage',
      'resources',
      'pnpm-lock.yaml'
    ]
  },

  // TypeScript + base JS rules (typescript-eslint recommended under the hood)
  tseslint.configs.recommended,
  {
    rules: {
      // `_` prefix marks intentionally unused bindings (standard convention)
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_'
        }
      ],
      // Rely on inference; not part of typescript-eslint's recommended preset
      '@typescript-eslint/explicit-function-return-type': 'off'
    }
  },

  // Electron main / preload / shared: Node.js environment
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts', 'src/shared/**/*.ts'],
    languageOptions: {
      globals: globals.node
    }
  },

  // Renderer: React rules and browser globals scoped to where JSX lives
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    extends: [
      eslintPluginReact.configs.flat.recommended,
      eslintPluginReact.configs.flat['jsx-runtime']
    ],
    languageOptions: {
      globals: globals.browser
    },
    settings: {
      react: {
        version: 'detect'
      }
    },
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'error',
        { allowConstantExport: true, allowExportNames: ['buttonVariants'] }
      ]
    }
  },

  // Last: disable ESLint rules that conflict with Prettier.
  // Formatting is handled by `pnpm format` / `pnpm format:check`, not ESLint.
  eslintConfigPrettier
)
