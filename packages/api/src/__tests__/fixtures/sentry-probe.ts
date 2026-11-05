/**
 * The API's Sentry setup, loaded the way the server loads it (instrument.ts first), in the env
 * its caller gives: it reports one error, flushes and exits. It runs as a process of its own,
 * since instrument.ts reads its env once and Sentry's client is process-global. The caller's
 * listener counts what arrives (packages/cli/src/__tests__/sandbox-embedded-sentry.test.ts).
 */

import '../../instrument';
import * as Sentry from '@sentry/bun';

Sentry.captureException(new Error('sentry probe'));
await Sentry.flush(5000);
process.exit(0);
