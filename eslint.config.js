import js from "@eslint/js";
import ts from "@typescript-eslint/eslint-plugin";

export default [
  js.configs.recommended,
  ...ts.configs["flat/recommended"],
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
      "no-control-regex": "off"
    }
  }
];
