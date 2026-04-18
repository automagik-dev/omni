export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'subject-case': [0],
  },
  ignores: [
    (message: string) => message.startsWith('[skip ci]'),
    (message: string) => message.startsWith('Merge'),
    // Skip bot/automation-authored commits (GitHub "Apply suggestion" UI, Dependabot, etc.)
    (message: string) => /^Update \S+/.test(message),
    (message: string) => /^(Bump|chore\(deps\))/.test(message),
    (message: string) => message.includes('[bot]'),
    (message: string) => message.includes('Co-authored-by: dependabot'),
    (message: string) => message.includes('Co-authored-by: gemini-code-assist'),
  ],
};
