import WebSocket from 'ws'
import { notification } from './desktop.js'
import { buildEvidence } from './evidence.js'
import type { Activity } from './evidence.js'
import type { SharedAnswer } from './sharing.js'
import { localAnswer, redact } from './ollama.js'

type Ask = { type: 'ask'; askId: string; question: string; asker: string; purpose?: 'answer' | 'intent' }
type ServerToScout = Ask
  | { type: 'alert'; kind: 'collision' | 'fail'; text: string; other: string; area: string }
  | { type: 'overlap_ping'; overlapId: string; other: string; area: string; text: string }
  | { type: 'ping'; from: string; text?: string; at: string }
  | { type: 'asked_about_you'; asker: string; sent: string; at: string }
  | { type: 'incoming_call'; briefId: string; kind: 'assignment' | 'manager_digest' | 'catchup'; from: string; title: string }
type ScoutToServer = { type: 'summary'; askId: string; summary: { user: string; text: string; refs: string[]; at: string } }

export function connectScout(
  endpoint: URL,
  user: string,
  ollama: URL,
  freshActivity: (signal: AbortSignal) => Promise<Activity[]>,
  recordShare: (answer: SharedAnswer) => void
) {
  const url = new URL('/ws', endpoint)
  url.protocol = endpoint.protocol === 'https:' ? 'wss:' : 'ws:'
  url.searchParams.set('user', user)
  let stopped = false
  let retries = 0
  let retry: NodeJS.Timeout | undefined
  let socket: WebSocket | undefined
  let session: AbortController | undefined

  function connect() {
    const ws = socket = new WebSocket(url, {
      handshakeTimeout: 5_000,
      followRedirects: false,
      maxPayload: 64 * 1024
    })
    const disconnected = session = new AbortController()
    const activeAsks = new Set<string>()
    let alive = true
    let ping: NodeJS.Timeout | undefined
    ws.on('open', () => {
      retries = 0
      ping = setInterval(() => {
        if (!alive) return ws.terminate()
        alive = false
        ws.ping()
      }, 15_000)
    })
    ws.on('pong', () => { alive = true })
    ws.on('error', () => {
      if (!stopped) console.error('Zipline WebSocket unavailable.')
    })
    ws.on('close', () => {
      clearInterval(ping)
      disconnected.abort()
      if (!stopped) retry = setTimeout(connect, Math.min(15_000, 500 * 2 ** retries++))
    })

    function send(ask: Ask, text: string, refs: string[]) {
      if (ws.readyState !== WebSocket.OPEN || stopped) return
      const message: ScoutToServer = { type: 'summary', askId: ask.askId, summary: { user, text, refs, at: new Date().toISOString() } }
      ws.send(JSON.stringify(message), error => {
        if (error) {
          if (!stopped) console.error('Zipline summary delivery failed.')
          return
        }
        recordShare({ asker: redact(ask.asker), purpose: ask.purpose ?? 'answer', text, refs, at: message.summary.at })
      })
    }

    async function answer(ask: Ask) {
      const intent = ask.purpose === 'intent'
      const unavailable = 'A local work summary is temporarily unavailable.'
      if (activeAsks.has(ask.askId)) return
      if (activeAsks.size >= 2) {
        if (!intent) send(ask, unavailable, [])
        return
      }
      activeAsks.add(ask.askId)
      const request = new AbortController()
      const cancel = () => request.abort()
      const timeout = setTimeout(cancel, intent ? 7_500 : 8_500)
      disconnected.signal.addEventListener('abort', cancel, { once: true })
      const { signal } = request
      try {
        const { evidence, refs } = buildEvidence(await freshActivity(signal))
        if (!evidence.length) {
          if (!intent) send(ask, 'No recent local activity is available.', [])
          return
        }
        const result = await localAnswer(ollama, ask.question.slice(0, 2_000), intent, evidence, signal)
        signal.throwIfAborted()
        const selected = result.refs.flatMap(id => refs.get(id) ?? [])
        send(ask, result.text, [...new Set(selected)].slice(0, 5))
      } catch {
        if (!disconnected.signal.aborted) {
          console.error('Zipline local summary unavailable.')
          // A fabricated intent could incorrectly confirm a collision.
          if (!intent) send(ask, unavailable, [])
        }
      } finally {
        clearTimeout(timeout)
        disconnected.signal.removeEventListener('abort', cancel)
        activeAsks.delete(ask.askId)
      }
    }

    ws.on('message', (data, binary) => {
      if (binary || stopped) return
      let message: ServerToScout
      try {
        message = JSON.parse(data.toString())
      } catch {
        return
      }
      switch (message?.type) {
        case 'ask':
          if (typeof message.askId === 'string' && message.askId && typeof message.question === 'string' &&
              typeof message.asker === 'string' && [undefined, 'answer', 'intent'].includes(message.purpose)) {
            void answer(message)
          }
          break
        case 'ping':
          if (typeof message.from === 'string' && message.from.trim() && typeof message.at === 'string' &&
              (message.text === undefined || typeof message.text === 'string')) {
            notification('Zipline · Teammate ping', message.text?.trim()
              ? `${message.from}: ${message.text}` : `${message.from} pinged you.`)
          }
          break
        case 'asked_about_you':
          if (typeof message.asker === 'string' && typeof message.sent === 'string')
            notification('Zipline · Asked about you', `${message.asker}: ${message.sent}`)
          break
        case 'alert':
          if (typeof message.text === 'string' && ['collision', 'fail'].includes(message.kind))
            notification(message.kind === 'collision' ? 'Zipline · Work overlap' : 'Zipline · Alert', message.text)
          break
        case 'overlap_ping':
          if (typeof message.text === 'string') notification('Zipline · Same task?', message.text)
          break
        case 'incoming_call':
          if (typeof message.title === 'string' && typeof message.from === 'string')
            notification('Zipline · Incoming call', `${message.from}: ${message.title}`)
          break
      }
    })
  }

  connect()
  return () => {
    stopped = true
    session?.abort()
    clearTimeout(retry)
    socket?.terminate()
  }
}
