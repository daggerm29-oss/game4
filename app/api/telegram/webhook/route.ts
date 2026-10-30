import { webhookCallback } from 'grammy'
import { getBot } from '@/lib/server/bot'
import { env } from '@/lib/server/env'

export const dynamic = 'force-dynamic'
export const maxDuration = 20

let handler: ((req: Request) => Promise<Response>) | null = null

export async function POST(req: Request) {
  if (!env.botToken || !env.webhookSecret) {
    return Response.json({ error: 'Bot is not configured' }, { status: 503 })
  }
  if (!handler) {
    // secretToken makes grammY reject requests lacking X-Telegram-Bot-Api-Secret-Token.
    handler = webhookCallback(getBot(), 'std/http', { secretToken: env.webhookSecret })
  }
  return handler(req)
}

export function GET() {
  return Response.json({ ok: true, configured: Boolean(env.botToken && env.webhookSecret) })
}
