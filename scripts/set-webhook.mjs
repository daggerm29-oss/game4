// Registers the Telegram webhook, bot commands and the private-chat menu button.
// Usage: node --env-file=.env.local scripts/set-webhook.mjs [https://your-app.vercel.app]
// Pass --delete to remove the webhook (e.g. before switching to a local tunnel).

const token = process.env.BOT_TOKEN
const secret = process.env.WEBHOOK_SECRET
const deleteMode = process.argv.includes('--delete')
const baseArg = process.argv.slice(2).find((arg) => arg.startsWith('http'))
const appUrl = (baseArg || process.env.APP_URL || '').replace(/\/$/, '')

if (!token) throw new Error('BOT_TOKEN is required')
if (!deleteMode && !secret) throw new Error('WEBHOOK_SECRET is required')
if (!deleteMode && !appUrl.startsWith('https://')) throw new Error('Pass an https:// app URL or set APP_URL')
if (secret && !/^[A-Za-z0-9_-]{1,256}$/.test(secret)) {
  throw new Error('WEBHOOK_SECRET may only contain A-Z, a-z, 0-9, _ and -')
}

async function call(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  const json = await res.json()
  if (!json.ok) throw new Error(`${method} failed: ${json.description}`)
  console.log(`${method}: ok`)
  return json.result
}

if (deleteMode) {
  await call('deleteWebhook', { drop_pending_updates: true })
  process.exit(0)
}

await call('setWebhook', {
  url: `${appUrl}/api/telegram/webhook`,
  secret_token: secret,
  allowed_updates: ['message'],
  drop_pending_updates: true,
  max_connections: 40,
})

const commands = [
  { command: 'startgame', description: 'Post a Play button for this chat' },
  { command: 'leaderboard', description: 'Top 10 survivors' },
  { command: 'help', description: 'How to play' },
]
await call('setMyCommands', { commands, scope: { type: 'default' } })
await call('setMyCommands', { commands, scope: { type: 'all_group_chats' } })

await call('setChatMenuButton', {
  menu_button: { type: 'web_app', text: 'Play', web_app: { url: appUrl } },
})

const info = await call('getWebhookInfo')
console.log(JSON.stringify(info, null, 2))
