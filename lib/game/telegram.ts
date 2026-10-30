type ImpactStyle = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'
type NotificationType = 'error' | 'success' | 'warning'

interface SafeAreaInset {
  top: number
  bottom: number
  left: number
  right: number
}

interface TelegramWebApp {
  initData: string
  initDataUnsafe: { start_param?: string; user?: { first_name?: string } }
  version: string
  platform: string
  colorScheme: 'light' | 'dark'
  themeParams: Record<string, string | undefined>
  safeAreaInset?: SafeAreaInset
  contentSafeAreaInset?: SafeAreaInset
  isVersionAtLeast(version: string): boolean
  ready(): void
  expand(): void
  disableVerticalSwipes?(): void
  enableClosingConfirmation?(): void
  disableClosingConfirmation?(): void
  setHeaderColor?(color: string): void
  setBackgroundColor?(color: string): void
  setBottomBarColor?(color: string): void
  lockOrientation?(): void
  onEvent(event: string, cb: () => void): void
  offEvent(event: string, cb: () => void): void
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void }
  HapticFeedback?: {
    impactOccurred(style: ImpactStyle): void
    notificationOccurred(type: NotificationType): void
    selectionChanged(): void
  }
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp }
  }
}

const GAME_BG = '#07090d'

function webApp(): TelegramWebApp | null {
  if (typeof window === 'undefined') return null
  const app = window.Telegram?.WebApp
  // telegram-web-app.js defines WebApp everywhere; initData is only present inside Telegram.
  return app && app.initData ? app : null
}

function supports(app: TelegramWebApp, version: string) {
  try {
    return app.isVersionAtLeast(version)
  } catch {
    return false
  }
}

function applySafeArea(app: TelegramWebApp) {
  const root = document.documentElement
  const safe = app.safeAreaInset ?? { top: 0, bottom: 0, left: 0, right: 0 }
  const content = app.contentSafeAreaInset ?? { top: 0, bottom: 0, left: 0, right: 0 }
  root.style.setProperty('--tg-safe-top', `${safe.top + content.top}px`)
  root.style.setProperty('--tg-safe-bottom', `${safe.bottom + content.bottom}px`)
  root.style.setProperty('--tg-safe-left', `${safe.left + content.left}px`)
  root.style.setProperty('--tg-safe-right', `${safe.right + content.right}px`)
}

function applyTheme(app: TelegramWebApp) {
  const root = document.documentElement
  const accent = app.themeParams.button_color
  const accentText = app.themeParams.button_text_color
  if (accent) root.style.setProperty('--tg-button', accent)
  if (accentText) root.style.setProperty('--tg-button-text', accentText)
}

export const telegram = {
  get available() {
    return webApp() !== null
  },

  get initData() {
    return webApp()?.initData ?? ''
  },

  get startParam() {
    return webApp()?.initDataUnsafe.start_param ?? null
  },

  init() {
    const app = webApp()
    if (!app) return false
    app.ready()
    app.expand()
    if (supports(app, '7.7')) app.disableVerticalSwipes?.()
    if (supports(app, '6.1')) {
      app.setHeaderColor?.(GAME_BG)
      app.setBackgroundColor?.(GAME_BG)
    }
    if (supports(app, '7.10')) app.setBottomBarColor?.(GAME_BG)
    if (supports(app, '8.0')) app.lockOrientation?.()
    applySafeArea(app)
    applyTheme(app)
    const onSafe = () => applySafeArea(app)
    app.onEvent('safeAreaChanged', onSafe)
    app.onEvent('contentSafeAreaChanged', onSafe)
    app.onEvent('themeChanged', () => applyTheme(app))
    app.onEvent('viewportChanged', () => app.expand())
    return true
  },

  setClosingConfirmation(enabled: boolean) {
    const app = webApp()
    if (!app || !supports(app, '6.2')) return
    if (enabled) app.enableClosingConfirmation?.()
    else app.disableClosingConfirmation?.()
  },

  backButton(handler: (() => void) | null) {
    const app = webApp()
    if (!app || !supports(app, '6.1')) return () => {}
    if (!handler) {
      app.BackButton.hide()
      return () => {}
    }
    app.BackButton.onClick(handler)
    app.BackButton.show()
    return () => {
      app.BackButton.offClick(handler)
      app.BackButton.hide()
    }
  },

  impact(style: ImpactStyle) {
    const app = webApp()
    if (app?.HapticFeedback && supports(app, '6.1')) app.HapticFeedback.impactOccurred(style)
    else if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(style === 'heavy' || style === 'rigid' ? 40 : 15)
    }
  },

  notify(type: NotificationType) {
    const app = webApp()
    if (app?.HapticFeedback && supports(app, '6.1')) app.HapticFeedback.notificationOccurred(type)
    else if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(type === 'error' ? [60, 40, 120] : 25)
    }
  },

  selection() {
    const app = webApp()
    if (app?.HapticFeedback && supports(app, '6.1')) app.HapticFeedback.selectionChanged()
  },
}
