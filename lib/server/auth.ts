import 'server-only'
import { env } from './env'
import { InitDataError, validateInitData } from './telegram-auth'

export interface Player {
  id: string
  name: string
  guest: boolean
  startParam: string | null
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

function displayName(first: string, last?: string, username?: string) {
  const full = [first, last].filter(Boolean).join(' ').trim()
  return (full || username || 'Player').slice(0, 48)
}

/**
 * Reads `Authorization: tma <initData>` and returns the verified Telegram player.
 * Outside production (or with ALLOW_GUEST=true) a guest identity is accepted for browser testing;
 * guests never touch the leaderboards or group chats.
 */
export function authenticate(req: Request): Player {
  const header = req.headers.get('authorization') ?? ''
  const [scheme, ...rest] = header.split(' ')
  const value = rest.join(' ')

  if (scheme === 'tma' && value) {
    if (!env.botToken) throw new HttpError(500, 'BOT_TOKEN is not configured')
    try {
      const data = validateInitData(value, env.botToken, env.initDataMaxAgeSec)
      return {
        id: String(data.user.id),
        name: displayName(data.user.first_name, data.user.last_name, data.user.username),
        guest: false,
        startParam: data.startParam,
      }
    } catch (error) {
      if (error instanceof InitDataError) throw new HttpError(401, `Telegram auth failed: ${error.message}`)
      throw error
    }
  }

  if (scheme === 'guest' && env.allowGuest && /^[A-Za-z0-9_-]{8,40}$/.test(value)) {
    return { id: `guest:${value}`, name: 'Guest', guest: true, startParam: null }
  }

  throw new HttpError(401, 'Open the game from Telegram to play')
}

export function jsonError(error: unknown) {
  if (error instanceof HttpError) {
    return Response.json({ error: error.message }, { status: error.status })
  }
  console.error('[skywalk] unhandled error', error)
  return Response.json({ error: 'Internal error' }, { status: 500 })
}
