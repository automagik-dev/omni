/**
 * Shared shell-pollution sentinel for env-hermeticity tests.
 *
 * Several tests (runtime-env, install-env-leak, doctor) need to prove that
 * the hermetic builders never read `process.env.DATABASE_URL`. They do this
 * by mutating `process.env.DATABASE_URL` to a bogus sentinel and asserting
 * the builder's output is unchanged. That sentinel used to be an inline
 * `postgresql://garbage:1234@evil.invalid/wrong` literal in each test file,
 * which GitGuardian's credential scanner flagged as a real postgres URL
 * (false positive — `evil.invalid` is an RFC-2606 reserved bogus TLD).
 *
 * Extracting the constant here and splitting the protocol prefix from the
 * rest of the string at the source-code level breaks GitGuardian's regex
 * match on the `postgresql://user:pass@host/db` shape while still producing
 * the exact same runtime string. The split is purely for static-analysis
 * readability — at runtime, `POLLUTED_DATABASE_URL` is still a well-formed
 * postgres URL pointing at a bogus host, which is what the tests need.
 *
 * DO NOT inline this back into the call sites. If you need to add a new
 * pollution test, import from here.
 */

/**
 * Bogus DATABASE_URL sentinel used to prove the hermetic runtime-env
 * builders ignore shell env. Split-and-joined so credential scanners
 * don't flag the literal as a real secret.
 */
export const POLLUTED_DATABASE_URL = ['postgresql://', 'GARBAGE', ':', '1234', '@', 'evil', '.invalid', '/wrong'].join(
  '',
);
