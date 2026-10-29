/** These qualification scripts temporarily exercise rollout switches in the shared SQL model.
 * Refuse to do that beside the running discovery API. Use an isolated CI/QA host.
 */
export async function assertDiscoveryQaIsolated() {
  let live=false;
  try {
    const response=await fetch('http://127.0.0.1:3300/api/viewer/v1/discovery/config',{signal:AbortSignal.timeout(1500)});
    live=response.ok&&(await response.json() as any)?.schemaVersion===1;
  }catch{}
  if(live)throw Error('Live discovery API detected on port3300. Run mutating discovery qualification on an isolated QA host; no fixture rows or rollout flags were changed.');
}
