import js from "@eslint/js";
import globals from "globals";

// Flat config (ESLint 9). Three file groups:
//   - extension source runs in the browser / webextension context
//   - tests + config run in Node
//   - Python and generated assets are ignored
export default [
  {
    ignores: ["node_modules/", "scripts/**", "**/*.zip"],
  },
  js.configs.recommended,
  {
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.webextensions,
      },
    },
    rules: {
      // Unused function arguments are common in message-listener signatures
      // (msg, sender, sendResponse) — keep them for readability.
      "no-unused-vars": ["error", { args: "none" }],
    },
  },
  {
    files: ["test/**/*.js", "eslint.config.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
  },
];
