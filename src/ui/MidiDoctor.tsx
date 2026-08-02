/**
 * Why the keyboard is not working.
 *
 * "It did not work" covers at least four unrelated failures — the page not being
 * secure, the browser having no MIDI at all, permission refused, a device that
 * enumerates but sends nothing — and they need completely different fixes. Asking
 * someone to describe which one they hit is slower and less reliable than showing
 * them all four at once.
 *
 * It opens its own MIDI access rather than reusing the session's. That is the
 * point: when the app's own plumbing is a suspect, a report that runs through the
 * same plumbing cannot clear it.
 *
 * The raw monitor is the part that earns its place. A keyboard idling sends
 * active sensing and nothing else — indisputably connected, and indistinguishable
 * from a dead cable everywhere else in the app, because everything else only
 * reacts to notes.
 */

import { useEffect, useState } from 'react'
import { diagnoseMidi, midiReport, watchRaw, type MidiReport, type RawMessage } from '../io/midi'

interface Props {
  onClose(): void
}

const MAX_LOG = 12

export function MidiDoctor({ onClose }: Props) {
  const [report, setReport] = useState<MidiReport | null>(null)
  const [log, setLog] = useState<RawMessage[]>([])
  const [count, setCount] = useState(0)
  const [watchError, setWatchError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const refresh = () => {
    setReport(null)
    void midiReport().then(setReport)
  }

  useEffect(refresh, [])

  useEffect(() => {
    let stop: (() => void) | undefined
    let cancelled = false

    void watchRaw((message) => {
      setCount((c) => c + 1)
      // Newest first, and capped: a keyboard idling on active sensing produces
      // hundreds a second, and an unbounded list would be the only thing this
      // screen ever did.
      setLog((list) => [message, ...list].slice(0, MAX_LOG))
    })
      .then((off) => {
        if (cancelled) off()
        else stop = off
      })
      .catch((error: unknown) => {
        setWatchError(error instanceof Error ? error.message : 'Could not listen.')
      })

    return () => {
      cancelled = true
      stop?.()
    }
  }, [])

  const verdict = report ? diagnoseMidi(report, count) : null

  const copy = () => {
    if (!report) return
    void navigator.clipboard
      ?.writeText(asText(report, count, log))
      .then(() => setCopied(true))
      .catch(() => setCopied(false))
  }

  return (
    <div className="doctor" role="dialog" aria-label="Keyboard diagnostics">
      <div className="doctor__panel">
        <header className="doctor__head">
          <h2>Keyboard diagnostics</h2>
          <button className="read__btn read__btn--text" onClick={onClose}>
            Close
          </button>
        </header>

        {!report ? (
          <p className="doctor__verdict">Checking…</p>
        ) : (
          <>
            {verdict && (
              <p className={`doctor__verdict doctor__verdict--${verdict.tone}`}>{verdict.text}</p>
            )}

            <dl className="doctor__grid">
              <Row label="Page" value={report.origin} ok={report.secure} />
              <Row
                label="Secure context"
                value={report.secure ? 'yes' : 'no — MIDI is blocked before it is asked'}
                ok={report.secure}
              />
              <Row
                label="Web MIDI"
                value={report.hasApi ? 'available' : 'not implemented by this browser'}
                ok={report.hasApi}
              />
              <Row label="Permission" value={report.permission} ok={report.permission !== 'denied'} />
              {report.accessError && <Row label="Access" value={report.accessError} ok={false} />}
              <Row
                label="Inputs"
                value={
                  report.inputs.length === 0
                    ? 'none'
                    : report.inputs
                        .map((p) => `${p.name || p.id} (${p.state}, ${p.connection})`)
                        .join(' · ')
                }
                ok={report.inputs.length > 0}
              />
              <Row
                label="Outputs"
                value={
                  report.outputs.length === 0
                    ? 'none'
                    : report.outputs.map((p) => p.name || p.id).join(' · ')
                }
                ok={report.outputs.length > 0}
              />
              <Row
                label="Messages seen"
                value={watchError ? watchError : `${count}`}
                ok={count > 0}
              />
            </dl>

            <div className="doctor__log">
              {log.length === 0 ? (
                <p className="doctor__empty">
                  Nothing yet. Press a key — anything at all here means the cable and the
                  browser are fine.
                </p>
              ) : (
                log.map((message, i) => (
                  <div className="doctor__line" key={`${message.at}-${i}`}>
                    <span className="doctor__kind">{message.kind}</span>
                    <span className="doctor__hex">{message.hex}</span>
                    <span className="doctor__port">{message.port}</span>
                  </div>
                ))
              )}
            </div>

            <div className="doctor__actions">
              <button className="pill pill--solid" onClick={refresh}>
                Check again
              </button>
              <button className="pill pill--solid" onClick={copy}>
                {copied ? 'Copied' : 'Copy report'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Row({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className={ok ? '' : 'doctor__bad'}>{value}</dd>
    </>
  )
}

/** The whole report as text, for pasting into a message. */
function asText(report: MidiReport, count: number, log: RawMessage[]): string {
  return [
    `origin: ${report.origin}`,
    `secure: ${report.secure}`,
    `web midi: ${report.hasApi}`,
    `permission: ${report.permission}`,
    `access error: ${report.accessError ?? 'none'}`,
    `inputs (${report.inputs.length}): ${report.inputs.map((p) => `${p.name} [${p.manufacturer}] ${p.state}/${p.connection}`).join('; ') || 'none'}`,
    `outputs (${report.outputs.length}): ${report.outputs.map((p) => p.name).join('; ') || 'none'}`,
    `messages: ${count}`,
    `recent: ${log.map((m) => `${m.kind} ${m.hex}`).join(' | ') || 'none'}`,
    `ua: ${report.userAgent}`,
  ].join('\n')
}
