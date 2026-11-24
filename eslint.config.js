import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', '.last-deploy.json']
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    }
  },
  {
    // Type-aware promise safety on production sources (PLAN §1).
    files: ['src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error'
    }
  },
  {
    files: ['scripts/**/*.ts', 'tests/**/*.ts', 'vitest.config.ts'],
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      // Hand-rolled fakes are async without awaiting and throw arbitrary
      // values on purpose (e.g. a fake Discord 10062 error object).
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/only-throw-error': 'off'
    }
  },
  {
    // The flat config itself is plain JS outside the TS project.
    files: ['eslint.config.js'],
    ...tseslint.configs.disableTypeChecked
  }
)
