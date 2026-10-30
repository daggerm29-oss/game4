import 'server-only'
import { HttpError } from './auth'
import { redis } from './redis'

const LIMITS = {
  run: { max: 12, windowSec: 60 },
  round: { max: 40, windowSec: 60 },
  answer: { max: 180, windowSec: 60 },
  leaderboard: { max: 40, windowSec: 60 },
} as const

export type RateBucket = keyof typeof LIMITS

/** Fixed-window limiter keyed by player id. Throws 429 when exceeded. */
export async function rateLimit(bucket: RateBucket, playerId: string) {
  const { max, windowSec } = LIMITS[bucket]
  const window = Math.floor(Date.now() / 1000 / windowSec)
  const key = `rl:${bucket}:${playerId}:${window}`
  const count = await redis().incr(key)
  if (count === 1) await redis().expire(key, windowSec + 5)
  if (count > max) throw new HttpError(429, 'Too many requests, slow down')
}
