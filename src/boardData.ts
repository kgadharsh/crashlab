export async function fetchBoardEntries<T>(url: string, fetcher: typeof fetch = fetch): Promise<T[]> {
  const res = await fetcher(url)
  const data: unknown = await res.json()
  const body = data && typeof data === 'object' ? data as { entries?: unknown; error?: unknown } : null
  if (!res.ok || !Array.isArray(body?.entries)) {
    throw new Error(typeof body?.error === 'string' ? body.error : 'bad reply')
  }
  return body.entries as T[]
}
