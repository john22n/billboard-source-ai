/**
 * Shared Nutshell JSON-RPC transport. Callers interpret RPC errors and own
 * retry policy; automatically retrying a write can create duplicate records.
 */
export async function nutshellRequest(
  method: string,
  params: Record<string, unknown>,
  credentials: string,
) {
  const response = await fetch('https://app.nutshell.com/api/v1/json', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: crypto.randomUUID(),
      method,
      params,
    }),
    signal: AbortSignal.timeout(20_000),
    cache: 'no-store',
    redirect: 'error',
  })
  if (!response.ok)
    throw new Error(`Nutshell request failed (HTTP ${response.status}).`)
  return response.json()
}
