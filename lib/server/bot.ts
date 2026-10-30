import 'server-only'
import { Bot, type Context, InlineKeyboard } from 'grammy'
import { encodeChatPayload } from './crypto'
import { appUrl, directLink, env } from './env'
import { topTen } from './leaderboard'
import { escapeHtml, formatDuration } from './telegram-api'

let bot: Bot | null = null

const INTRO =
  '<b>SKYWALK</b>\nA steel walkway, hundreds of meters up. Memorize the faces on the sign, then walk through the doors in that exact order.\nOne wrong door and the floor opens.'

function isGroup(ctx: Context) {
  return ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup'
}

async function replyWithLaunch(ctx: Context) {
  if (!ctx.chat) return
  if (isGroup(ctx)) {
    // web_app buttons are not allowed in groups, so we link to the Direct Link Mini App instead.
    const keyboard = new InlineKeyboard().url('Play Skywalk', directLink(encodeChatPayload(ctx.chat.id)))
    await ctx.reply(`${INTRO}\n\nScores from this launch count for this group's leaderboard.`, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    })
    return
  }
  const keyboard = new InlineKeyboard().webApp('Play Skywalk', appUrl())
  await ctx.reply(INTRO, { parse_mode: 'HTML', reply_markup: keyboard })
}

async function replyWithLeaderboard(ctx: Context) {
  if (!ctx.chat) return
  const scope = isGroup(ctx) ? `group:${ctx.chat.id}` : 'global'
  const { entries } = await topTen(scope, null)
  const title = isGroup(ctx) ? 'Group leaderboard' : 'Global leaderboard'
  const lines = entries.length
    ? entries.map((e) => `${e.rank}. ${escapeHtml(e.name)} - level ${e.level} (${formatDuration(e.timeMs)})`)
    : ['Nobody has survived yet. Be the first.']
  const keyboard = isGroup(ctx)
    ? new InlineKeyboard().url('Play', directLink(encodeChatPayload(ctx.chat.id)))
    : new InlineKeyboard().webApp('Play', appUrl())
  await ctx.reply(`<b>${title}</b>\n${lines.join('\n')}`, { parse_mode: 'HTML', reply_markup: keyboard })
}

export function getBot() {
  if (bot) return bot
  if (!env.botToken) throw new Error('BOT_TOKEN is not configured')
  bot = new Bot(env.botToken)

  // grammY matches /cmd and /cmd@botusername automatically for these handlers.
  bot.command(['start', 'startgame', 'play'], replyWithLaunch)
  bot.command(['leaderboard', 'top'], replyWithLeaderboard)
  bot.command('help', (ctx) =>
    ctx.reply(
      '/startgame - post a Play button for this chat\n/leaderboard - top 10 survivors\n\nIn groups the game opens as a Mini App and the result is posted back here.',
    ),
  )

  bot.catch((err) => console.error('[skywalk] bot error', err.error))
  return bot
}
