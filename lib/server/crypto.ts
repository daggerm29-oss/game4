import 'server-only'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { gameSecret } from './env'

export function randomId(bytes = 12) {
  return randomBytes(bytes).toString('base64url')
}

export function sign(value: string, length = 22) {
  return createHmac('sha256', gameSecret()).update(value).digest('base64url').slice(0, length)
}

export function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

/** Cryptographically secure integer in [0, max). */
export function randInt(max: number) {
  const buf = randomBytes(4)
  return buf.readUInt32BE(0) % max
}

export function shuffle<T>(items: T[]) {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = randInt(i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

export function chance(p: number) {
  return randInt(10_000) < p * 10_000
}

/**
 * Launch payload for Direct Link Mini Apps: encodes the group chat id plus an HMAC so a
 * crafted start_param cannot make the bot post into arbitrary chats.
 * Format: <n|p><base36(|chatId|)>_<sig>, using only [A-Za-z0-9_-] as Telegram requires.
 */
export function encodeChatPayload(chatId: number) {
  const body = `${chatId < 0 ? 'n' : 'p'}${Math.abs(chatId).toString(36)}`
  return `${body}_${sign(`chat:${body}`, 12)}`
}

export function decodeChatPayload(payload: string | null | undefined): number | null {
  if (!payload || payload.length > 64) return null
  const match = /^([np])([0-9a-z]+)_([A-Za-z0-9_-]{12})$/.exec(payload)
  if (!match) return null
  const body = `${match[1]}${match[2]}`
  if (!safeEqual(sign(`chat:${body}`, 12), match[3])) return null
  const abs = Number.parseInt(match[2], 36)
  if (!Number.isSafeInteger(abs)) return null
  return match[1] === 'n' ? -abs : abs
}
