/** Token metadata carried by LaunchToken.tokenURI(). */
export type TokenMetadata = {
  name?: string
  description?: string
  image?: string
  website?: string
  twitter?: string
  telegram?: string
}

const IPFS_GATEWAY = 'https://ipfs.io/ipfs/'
const cache = new Map<string, TokenMetadata>()

/** Resolve ipfs:// to a public gateway; pass through http(s) and data URIs. */
export function resolveUri(uri: string): string {
  if (uri.startsWith('ipfs://')) return IPFS_GATEWAY + uri.slice('ipfs://'.length)
  return uri
}

/**
 * Parse a tokenURI into metadata. Handles base64/plain data: URIs synchronously and
 * fetches ipfs:// / http(s) JSON. Never throws — bad metadata renders as empty.
 */
export async function parseTokenURI(uri: string): Promise<TokenMetadata> {
  if (!uri) return {}
  const hit = cache.get(uri)
  if (hit) return hit

  let meta: TokenMetadata = {}
  try {
    if (uri.startsWith('data:')) {
      meta = parseDataUri(uri)
    } else if (uri.startsWith('ipfs://') || uri.startsWith('http://') || uri.startsWith('https://')) {
      const res = await fetch(resolveUri(uri), { signal: AbortSignal.timeout(8000) })
      if (res.ok) meta = sanitize(await res.json())
    }
  } catch {
    meta = {}
  }
  cache.set(uri, meta)
  return meta
}

function parseDataUri(uri: string): TokenMetadata {
  const comma = uri.indexOf(',')
  if (comma < 0) return {}
  const header = uri.slice(0, comma)
  const payload = uri.slice(comma + 1)
  const raw = header.includes('base64') ? base64ToUtf8(payload) : decodeURIComponent(payload)
  return sanitize(JSON.parse(raw))
}

function sanitize(value: unknown): TokenMetadata {
  if (typeof value !== 'object' || value === null) return {}
  const obj = value as Record<string, unknown>
  const pick = (key: string) => (typeof obj[key] === 'string' ? (obj[key] as string) : undefined)
  return {
    name: pick('name'),
    description: pick('description'),
    image: pick('image'),
    website: pick('website') ?? pick('websiteUrl'),
    twitter: pick('twitter'),
    telegram: pick('telegram'),
  }
}

/** Build a fully on-chain data URI for a new launch (no IPFS dependency). */
export function buildTokenURI(meta: TokenMetadata): string {
  const clean = Object.fromEntries(Object.entries(meta).filter(([, v]) => v && String(v).trim() !== ''))
  return `data:application/json;base64,${utf8ToBase64(JSON.stringify(clean))}`
}

function utf8ToBase64(s: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(s)))
}

function base64ToUtf8(b64: string): string {
  return new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))
}
