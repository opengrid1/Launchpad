import { useState } from 'react'

export function NoteCard({ note }: { note: string }) {
  const [copied, setCopied] = useState(false)
  const [revealed, setRevealed] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(note)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      setRevealed(true)
    }
  }

  return (
    <div className="rounded-xl bg-void-950 p-3.5 ring-1 ring-iris-500/30">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-iris-400">Your secret note</span>
        <button
          onClick={() => setRevealed((v) => !v)}
          className="cursor-pointer font-mono text-[11px] text-fog-500 transition hover:text-fog-100"
        >
          {revealed ? 'hide' : 'reveal'}
        </button>
      </div>
      <p
        className={`mt-2 break-all font-mono text-[12px] leading-relaxed ${
          revealed ? 'text-fog-100' : 'select-none text-fog-100 blur-[5px]'
        }`}
      >
        {note}
      </p>
      <button
        onClick={copy}
        className="mt-3 w-full cursor-pointer rounded-lg bg-iris-500/15 py-2 text-[13px] font-semibold text-iris-300 ring-1 ring-iris-500/30 transition hover:bg-iris-500/25"
      >
        {copied ? '✓ Copied' : 'Copy note'}
      </button>
    </div>
  )
}
