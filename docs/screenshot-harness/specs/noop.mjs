/**
 * No-op spec. Bootstraps the stack (postgres, redis, backend, dashboard,
 * admin, unlock) and exits. Useful together with SKIP_TEARDOWN=1 to hold
 * the stack up for running other test suites against it.
 *
 * Usage:
 *   SKIP_TEARDOWN=1 node docs/screenshot-harness/run.mjs noop
 *   ./tests/e2e-smoke.sh
 *   node docs/screenshot-harness/run.mjs noop   # without SKIP_TEARDOWN to tear down
 */

export async function run(_ctx) {
  console.log('\n(noop spec — stack is up and bootstrapped)');
}
