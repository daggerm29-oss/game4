import 'server-only'
import type { LeaderboardEntry } from '@/lib/shared/game'
import { redis } from './redis'

const TIME_CAP = 1e9 - 1

/** Higher level wins; within a level, lower time wins. */
function scoreOf(level: number, timeMs: number) {
  return level * 1e9 + (TIME_CAP - Math.min(Math.max(0, Math.round(timeMs)), TIME_CAP))
}

function decode(score: number) {
  const level = Math.floor(score / 1e9)
  const timeMs = TIME_CAP - (score - level * 1e9)
  return { level, timeMs }
}

const zkey = (scope: string) => `lb:${scope}`
const nameKey = 'lb:names'

export function scopesFor(chatId: number | null) {
  return chatId === null ? ['global'] : ['global', `group:${chatId}`]
}

export async function recordBest(playerId: string, name: string, chatId: number | null, level: number, timeMs: number) {
  const score = scoreOf(level, timeMs)
  const r = redis()
  await r.hset(nameKey, { [playerId]: name })
  await Promise.all(scopesFor(chatId).map((scope) => r.zadd(zkey(scope), { gt: true }, { score, member: playerId })))
}

export async function bestLevel(playerId: string) {
  const score = await redis().zscore(zkey('global'), playerId)
  return score === null ? 0 : decode(Number(score)).level
}

export async function topTen(scope: string, playerId: string | null) {
  const r = redis()
  const raw = (await r.zrange(zkey(scope), 0, 9, { rev: true, withScores: true })) as (string | number)[]
  const rows: { member: string; score: number }[] = []
  for (let i = 0; i < raw.length; i += 2) rows.push({ member: String(raw[i]), score: Number(raw[i + 1]) })

  const ids = rows.map((row) => row.member)
  if (playerId && !ids.includes(playerId)) ids.push(playerId)
  const names = ids.length ? ((await r.hmget(nameKey, ...ids)) as Record<string, string | null> | null) : null

  const entries: LeaderboardEntry[] = rows.map((row, index) => ({
    rank: index + 1,
    name: names?.[row.member] ?? 'Player',
    ...decode(row.score),
    isMe: row.member === playerId,
  }))

  let me: LeaderboardEntry | null = entries.find((entry) => entry.isMe) ?? null
  if (!me && playerId) {
    const [score, rank] = await Promise.all([r.zscore(zkey(scope), playerId), r.zrevrank(zkey(scope), playerId)])
    if (score !== null && rank !== null) {
      me = { rank: rank + 1, name: names?.[playerId] ?? 'You', ...decode(Number(score)), isMe: true }
    }
  }
  return { entries, me }
}
