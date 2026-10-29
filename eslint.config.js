import js from '@eslint/js';
import ts from 'typescript-eslint';
import globals from 'globals';
export default ts.config({ ignores: ['dist/**', 'node_modules/**'] }, js.configs.recommended, ...ts.configs.recommended, {
  languageOptions: { globals: { ...globals.browser, ...globals.node } },
}, {
  files: ['server/**/*.ts', 'shared/**/*.ts'],
  rules: { 'no-restricted-properties': ['error', { object: 'Math', property: 'random', message: 'Use the injected restorable seeded PRNG in simulation code.' }] },
});
