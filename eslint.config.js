import eslint from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

export default [
  { ignores: ["node_modules", "out", "dist", "**/*.d.ts", ".agents", "docs", ".pi-subagents"] },
  eslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsparser,
      parserOptions: { ecmaVersion: 2022, sourceType: "module", ecmaFeatures: { jsx: true } },
    },
    plugins: { "@typescript-eslint": tseslint },
    rules: {
      ...tseslint.configs.recommended.rules,
      // TypeScript's own checker resolves identifiers; the base rule only
      // produces false positives on TS globals (Buffer, document, React JSX transform).
      "no-undef": "off",
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
];
