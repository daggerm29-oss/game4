import 'server-only'
import { encodeChatPayload } from './crypto'
import { directLink, env } from './env'

export function escapeHtml(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function playButtonForChat(chatId: number, label = 'Play Skywalk') {
  return { inline_keyboard: [[{ text: label, url: directLink(encodeChatPayload(chatId)) }]] }
}

export function formatDuration(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return m > 0 ? `${m}m ${s.toString().padStart(2, '0')}s` : `${s}s`
}

/** Posts the run result back into the group that launched the game. */
export async function postResultToGroup(chatId: number, name: string, level: number, timeMs: number) {
  if (!env.botToken || !env.botUsername || !env.appShortName) return false
  const cleared = level - 1
  const text =
    `<b>${escapeHtml(name)}</b> fell from the Skywalk on <b>level ${level}</b>.\n` +
    `${cleared} level${cleared === 1 ? '' : 's'} cleared in ${formatDuration(timeMs)}. Think you can climb higher?`
  const res = await fetch(`https://api.telegram.org/bot${env.botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      reply_markup: playButtonForChat(chatId, 'Play'),
    }),
  })
  if (!res.ok) console.error('[skywalk] sendMessage failed', res.status, await res.text())
  return res.ok
}
