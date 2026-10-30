import { authenticate, jsonError } from '@/lib/server/auth'
import { decodeChatPayload } from '@/lib/server/crypto'
import { rateLimit } from '@/lib/server/rate-limit'
import { startRun } from '@/lib/server/runs'
import { CART_RESPAWNS, type RunStartResponse, TEST_MAX_LEVEL } from '@/lib/shared/game'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const player = authenticate(req)
    await rateLimit('run', player.id)
    // start_param comes from the HMAC-verified initData, so the group id cannot be spoofed by the client.
    const chatId = decodeChatPayload(player.startParam)
    // Test shortcut for later levels (the /test page): local dev, Vercel preview deployments, or ENABLE_TEST_MODE=1.
    // Ignored on production. Runs started past level 1 are never ranked.
    let startLevel = 1
    const testMode =
      process.env.NODE_ENV !== 'production' ||
      process.env.VERCEL_ENV === 'preview' ||
      process.env.ENABLE_TEST_MODE === '1'
    if (testMode) {
      const body = (await req.json().catch(() => ({}))) as { startLevel?: unknown }
      if (Number.isInteger(body.startLevel) && (body.startLevel as number) >= 1 && (body.startLevel as number) <= TEST_MAX_LEVEL) {
        startLevel = body.startLevel as number
      }
    }
    const { run, round } = await startRun(player, chatId, startLevel)
    const body: RunStartResponse = {
      runId: run.runId,
      guest: player.guest,
      groupLaunch: run.chatId !== null,
      player: { name: player.name },
      round,
      respawns: run.respawnsLeft ?? CART_RESPAWNS,
    }
    return Response.json(body)
  } catch (error) {
    return jsonError(error)
  }
}
