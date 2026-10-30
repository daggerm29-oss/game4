import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'

export interface TelegramUser {
  id: number
  first_name: string
  last_name?: string
  username?: string
  language_code?: string
}

export interface ValidatedInitData {
  user: TelegramUser
  authDate: number
  startParam: string | null
}

export class InitDataError extends Error {}

/**
 * Validates Telegram Mini App initData using the HMAC-SHA256 scheme from
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function validateInitData(initData: string, botToken: string, maxAgeSec: number): ValidatedInitData {
  if (!initData || initData.length > 8192) throw new InitDataError('missing init data')
  const params = new URLSearchParams(initData)
  const hash = params.get('hash')
  if (!hash || !/^[a-f0-9]{64}$/.test(hash)) throw new InitDataError('missing hash')
  params.delete('hash')

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest()
  const expected = createHmac('sha256', secretKey).update(dataCheckString).digest()
  const received = Buffer.from(hash, 'hex')
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new InitDataError('bad signature')
  }

  const authDate = Number(params.get('auth_date'))
  const now = Math.floor(Date.now() / 1000)
  if (!Number.isFinite(authDate) || authDate <= 0) throw new InitDataError('missing auth_date')
  if (now - authDate > maxAgeSec) throw new InitDataError('stale auth_date')
  if (authDate - now > 60) throw new InitDataError('auth_date in the future')

  const rawUser = params.get('user')
  if (!rawUser) throw new InitDataError('missing user')
  let user: TelegramUser
  try {
    user = JSON.parse(rawUser) as TelegramUser
  } catch {
    throw new InitDataError('bad user payload')
  }
  if (!Number.isSafeInteger(user.id)) throw new InitDataError('bad user id')

  return { user, authDate, startParam: params.get('start_param') }
}
