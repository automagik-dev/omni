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
    // PR #778 squash header: the 100-char PR title gained " (#778)" on merge → 109 chars.
    // The commit is immutable on dev; ignore it so rolling dev→main PRs lint clean.
    // Lesson: keep PR titles ≤ ~90 chars — GitHub appends " (#NNN)" to squash headers.
    (message: string) =>
      message.startsWith(
        'ci(test): execute S3/MinIO integration suites in CI; ungate dispatcher local tests (PR #770 H8, MED-4) (#778)',
      ),
    // PR #831 squash header/body: GitHub generated immutable lines over 100 chars.
    // The source commits were linted before merge; ignore this exact accepted squash commit
    // so environment promotion PRs can preserve dev ancestry without rewriting history.
    (message: string) =>
      message.startsWith(
        'feat(api): console-viewer/operator/admin key profiles + mint scope ceiling (OSS backend of #829) (#831)',
      ),
    // Immutable khal-ui promotion commits with >100-char headers/body lines.
    (message: string) => message.startsWith('fix(deps): pin @types/react 18 hoist fallback'),
  ],
};
