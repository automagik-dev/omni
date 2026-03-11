export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'subject-case': [0],
  },
  ignores: [(message: string) => message.startsWith('[skip ci]'), (message: string) => message.startsWith('Merge')],
};
