import { HttpError, authenticate, jsonError } from '@/lib/server/auth'
import { rateLimit } from '@/lib/server/rate-limit'
import { currentRound } from '@/lib/server/runs'

export const dynamic = 'force-dynamic'

/** Re-sends the active round of a run (recovery after a dropped response). */
export async function POST(req: Request) {
  try {
    const player = authenticate(req)
    await rateLimit('round', player.id)
    const body = (await req.json().catch(() => null)) as { runId?: unknown } | null
    if (!body || typeof body.runId !== 'string') throw new HttpError(400, 'runId required')
    return Response.json(await currentRound(player, body.runId))
  } catch (error) {
    return jsonError(error)
  }
}
