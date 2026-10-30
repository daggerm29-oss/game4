import { authenticate, jsonError } from '@/lib/server/auth'
import { decodeChatPayload } from '@/lib/server/crypto'
import { topTen } from '@/lib/server/leaderboard'
import { rateLimit } from '@/lib/server/rate-limit'
import type { LeaderboardResponse } from '@/lib/shared/game'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const player = authenticate(req)
    await rateLimit('leaderboard', player.id)
    const url = new URL(req.url)
    const wantsGroup = url.searchParams.get('scope') === 'group'
    const chatId = wantsGroup ? decodeChatPayload(player.startParam) : null
    const scope = chatId !== null ? 'group' : 'global'
    const { entries, me } = await topTen(chatId !== null ? `group:${chatId}` : 'global', player.guest ? null : player.id)
    const body: LeaderboardResponse = { scope, entries, me }
    return Response.json(body, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    return jsonError(error)
  }
}
