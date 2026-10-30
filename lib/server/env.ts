import 'server-only'
import { createHash } from 'node:crypto'

export const env = {
  botToken: process.env.BOT_TOKEN ?? '',
  botUsername: (process.env.BOT_USERNAME ?? '').replace(/^@/, ''),
  appShortName: process.env.APP_SHORT_NAME ?? '',
  webhookSecret: process.env.WEBHOOK_SECRET ?? '',
  initDataMaxAgeSec: Number(process.env.INITDATA_MAX_AGE_SEC ?? 86400),
  // Guests (plain browser, no Telegram) are allowed locally and on Vercel preview deployments for phone testing.
  allowGuest:
    process.env.ALLOW_GUEST === 'true' ||
    process.env.NODE_ENV !== 'production' ||
    process.env.VERCEL_ENV === 'preview',
}

export function appUrl() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '')
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  return 'http://localhost:3000'
}

let cachedSecret: Buffer | null = null

/** Key for signing round tokens and launch payloads. Derived from BOT_TOKEN when GAME_SECRET is not set. */
export function gameSecret(): Buffer {
  if (cachedSecret) return cachedSecret
  const source = process.env.GAME_SECRET || (env.botToken ? `skywalk:${env.botToken}` : '')
  if (!source) {
    // Preview deployments only host unranked guest test runs, so a per-deployment fallback key is acceptable there.
    const preview = process.env.VERCEL_ENV === 'preview'
    if (process.env.NODE_ENV === 'production' && !preview) throw new Error('GAME_SECRET or BOT_TOKEN must be set')
    const fallback = preview ? `skywalk-preview:${process.env.VERCEL_DEPLOYMENT_ID ?? process.env.VERCEL_URL ?? ''}` : 'skywalk-dev-only-secret'
    cachedSecret = createHash('sha256').update(fallback).digest()
    return cachedSecret
  }
  cachedSecret = createHash('sha256').update(source).digest()
  return cachedSecret
}

export function directLink(payload?: string) {
  const base = `https://t.me/${env.botUsername}/${env.appShortName}`
  return payload ? `${base}?startapp=${payload}` : base
}
