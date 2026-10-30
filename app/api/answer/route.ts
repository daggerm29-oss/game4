import { HttpError, authenticate, jsonError } from '@/lib/server/auth'
import { rateLimit } from '@/lib/server/rate-limit'
import { submitGate } from '@/lib/server/runs'

export const dynamic = 'force-dynamic'

/** Verifies the lane the runner passed through at one gate. */
export async function POST(req: Request) {
  try {
    const player = authenticate(req)
    await rateLimit('answer', player.id)
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (
      !body ||
      typeof body.runId !== 'string' ||
      typeof body.roundId !== 'string' ||
      typeof body.token !== 'string' ||
      !Number.isInteger(body.step) ||
      !Number.isInteger(body.lane) ||
      typeof body.clientMs !== 'number' ||
      !Number.isFinite(body.clientMs)
    ) {
      throw new HttpError(400, 'Malformed gate pass')
    }
    const result = await submitGate(player, {
      runId: body.runId,
      roundId: body.roundId,
      token: body.token,
      step: body.step as number,
      lane: body.lane as number,
      clientMs: body.clientMs as number,
    })
    return Response.json(result)
  } catch (error) {
    return jsonError(error)
  }
}
