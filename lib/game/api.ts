import type { AnswerResponse, GatePassInput, LeaderboardResponse, RoundDTO, RunStartResponse } from '@/lib/shared/game'
import { telegram } from './telegram'

const GUEST_KEY = 'skywalk-guest-id'

function guestId() {
  try {
    let id = sessionStorage.getItem(GUEST_KEY)
    if (!id) {
      id = crypto.randomUUID().replace(/-/g, '').slice(0, 24)
      sessionStorage.setItem(GUEST_KEY, id)
    }
    return id
  } catch {
    return 'guestfallback01'
  }
}

export function authHeader() {
  return telegram.available ? `tma ${telegram.initData}` : `guest ${guestId()}`
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

async function request<T>(path: string, init: RequestInit & { retries?: number } = {}): Promise<T> {
  const { retries = 0, ...rest } = init
  let attempt = 0
  for (;;) {
    try {
      const res = await fetch(path, {
        ...rest,
        headers: { 'content-type': 'application/json', authorization: authHeader(), ...rest.headers },
        cache: 'no-store',
      })
      const json = (await res.json().catch(() => ({}))) as T & { error?: string }
      if (!res.ok) throw new ApiError(res.status, json.error ?? `Request failed (${res.status})`)
      return json
    } catch (error) {
      const retriable = !(error instanceof ApiError) || error.status >= 500
      if (!retriable || attempt >= retries) throw error
      attempt += 1
      await new Promise((r) => setTimeout(r, 300 * attempt))
    }
  }
}

export const api = {
  startRun: (startLevel?: number) =>
    request<RunStartResponse>('/api/run', { method: 'POST', body: JSON.stringify(startLevel ? { startLevel } : {}), retries: 1 }),
  round: (runId: string) =>
    request<RoundDTO>('/api/round', { method: 'POST', body: JSON.stringify({ runId }), retries: 2 }),
  gate: (body: GatePassInput) =>
    request<AnswerResponse>('/api/answer', { method: 'POST', body: JSON.stringify(body), retries: 2 }),
  leaderboard: (scope: 'global' | 'group') => request<LeaderboardResponse>(`/api/leaderboard?scope=${scope}`),
}
