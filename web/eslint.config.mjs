// Flat ESLint configuration (§98).
//
// Type-aware linting is enabled deliberately: most of the rules that catch real
// defects in this codebase -- floating promises, unsafe member access on `any`,
// unhandled union members -- require type information to work at all.

import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'coverage/**'],
  },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node, ...globals.browser },
    },

    rules: {
      // -- correctness -----------------------------------------------------
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],

      // -- §98: no unused code, but allow the _-prefixed escape hatch -------
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // -- security (§8, §9) -----------------------------------------------
      // Raw HTML injection is the single highest-value XSS vector in a product
      // that will render user-submitted articles, comments and ad creatives.
      // Banned outright rather than reviewed case by case.
      'react/no-danger': 'off', // not using the react plugin; covered below
      'no-restricted-syntax': [
        'error',
        {
          selector: 'JSXAttribute[name.name="dangerouslySetInnerHTML"]',
          message:
            'Raw HTML injection is prohibited (§8). Render text as text; if markup is genuinely required, sanitise server-side and document the decision in docs/DECISIONS.md.',
        },
        {
          selector: 'MemberExpression[property.name="innerHTML"]',
          message: 'Assigning innerHTML is prohibited (§8). Use text nodes.',
        },
        {
          selector: 'NewExpression[callee.name="Function"]',
          message: 'Dynamic code construction is prohibited (§8).',
        },
      ],
      'no-eval': 'error',
      'no-implied-eval': 'error',
    },
  },

  // The content accessors are async with no `await` on purpose. They are the
  // seam the Phase 1 database layer replaces (docs/ARCHITECTURE_AUDIT.md 4.4):
  // keeping the signatures async now means call sites do not change when the
  // fixtures become queries. Scoped to this one file so the rule keeps working
  // everywhere else.
  {
    files: ['src/lib/content.ts'],
    rules: { '@typescript-eslint/require-await': 'off' },
  },

  // Plain-JavaScript tooling is not part of the typed program.
  {
    files: ['*.mjs', '*.config.*', 'scripts/**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: { parserOptions: { projectService: false, project: false } },
  },
)
