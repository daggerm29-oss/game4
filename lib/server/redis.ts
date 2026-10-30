import 'server-only'
import { Redis } from '@upstash/redis'

/** The subset of the Upstash client the game uses. */
export interface GameRedis {
  get<T>(key: string): Promise<T | null>
  set(key: string, value: unknown, opts?: { ex?: number }): Promise<unknown>
  incr(key: string): Promise<number>
  expire(key: string, seconds: number): Promise<unknown>
  hset(key: string, values: Record<string, string>): Promise<unknown>
  hmget(key: string, ...fields: string[]): Promise<Record<string, string | null> | null>
  zadd(key: string, opts: { gt: true }, entry: { score: number; member: string }): Promise<unknown>
  zscore(key: string, member: string): Promise<number | null>
  zrevrank(key: string, member: string): Promise<number | null>
  zrange(key: string, start: number, stop: number, opts: { rev: true; withScores: true }): Promise<(string | number)[]>
}

/**
 * Process-local stand-in used only when Upstash credentials are missing outside production,
 * so the game is playable in local dev and previews. Data does not survive a server restart.
 */
function createMemoryRedis(): GameRedis {
  const values = new Map<string, { value: unknown; expires: number }>()
  const hashes = new Map<string, Map<string, string>>()
  const sets = new Map<string, Map<string, number>>()
  const live = (key: string) => {
    const entry = values.get(key)
    if (entry && entry.expires && entry.expires < Date.now()) values.delete(key)
    return values.get(key)
  }
  const sorted = (key: string) => [...(sets.get(key) ?? new Map()).entries()].sort((a, b) => b[1] - a[1])
  return {
    async get<T>(key: string) {
      const entry = live(key)
      return entry ? (structuredClone(entry.value) as T) : null
    },
    async set(key, value, opts) {
      values.set(key, { value: structuredClone(value), expires: opts?.ex ? Date.now() + opts.ex * 1000 : 0 })
      return 'OK'
    },
    async incr(key) {
      const next = Number(live(key)?.value ?? 0) + 1
      values.set(key, { value: next, expires: values.get(key)?.expires ?? 0 })
      return next
    },
    async expire(key, seconds) {
      const entry = values.get(key)
      if (entry) entry.expires = Date.now() + seconds * 1000
      return 1
    },
    async hset(key, record) {
      const hash = hashes.get(key) ?? new Map<string, string>()
      for (const [field, value] of Object.entries(record)) hash.set(field, value)
      hashes.set(key, hash)
      return 1
    },
    async hmget(key, ...fields) {
      const hash = hashes.get(key)
      return Object.fromEntries(fields.map((f) => [f, hash?.get(f) ?? null]))
    },
    async zadd(key, _opts, { score, member }) {
      const set = sets.get(key) ?? new Map<string, number>()
      if (!set.has(member) || score > set.get(member)!) set.set(member, score)
      sets.set(key, set)
      return 1
    },
    async zscore(key, member) {
      return sets.get(key)?.get(member) ?? null
    },
    async zrevrank(key, member) {
      const index = sorted(key).findIndex(([m]) => m === member)
      return index < 0 ? null : index
    },
    async zrange(key, start, stop) {
      return sorted(key)
        .slice(start, stop + 1)
        .flatMap(([member, score]) => [member, score])
    },
  }
}

let client: GameRedis | null = null

export function redis(): GameRedis {
  if (!client) {
    const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL
    const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN
    if (url && token) {
      client = new Redis({ url, token }) as unknown as GameRedis
    } else if (
      process.env.NODE_ENV !== 'production' ||
      process.env.VERCEL_ENV === 'preview' ||
      process.env.ALLOW_MEMORY_STORE === 'true'
    ) {
      console.warn('[skywalk] Upstash Redis not configured, using in-memory store')
      // Route handlers can get separate module instances in dev; share one store across them.
      const g = globalThis as { __skywalkMemoryRedis?: GameRedis }
      g.__skywalkMemoryRedis ??= createMemoryRedis()
      client = g.__skywalkMemoryRedis
    } else {
      throw new Error('Upstash Redis credentials are missing (KV_REST_API_URL / KV_REST_API_TOKEN)')
    }
  }
  return client
}
