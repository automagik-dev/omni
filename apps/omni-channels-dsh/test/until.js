// Until `done()` holds, looking again after each turn of the event loop; throws once `ms` of
// real time passed without it, so a slow machine waits longer and a broken run fails, rather
// than either going on half done.
export async function until(done, ms = 5000) {
  const deadline = performance.now() + ms
  while (!done()) {
    if (performance.now() > deadline) throw new Error(`until: not done after ${ms} ms: ${String(done).slice(0, 200)}`)
    await new Promise(resolve => setImmediate(resolve))
  }
}
