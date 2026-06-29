export function Steps({ labels, active }: { labels: string[]; active: number }) {
  return (
    <ol className="flex items-center gap-2">
      {labels.map((label, i) => {
        const done = i < active
        const current = i === active
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              className={`flex items-center gap-2 rounded-full px-3 py-1 text-[12px] font-medium ring-1 transition ${
                current
                  ? 'bg-iris-500/15 text-iris-300 ring-iris-500/40'
                  : done
                    ? 'bg-mint-500/10 text-mint-400 ring-mint-500/25'
                    : 'bg-void-850 text-fog-500 ring-void-700'
              }`}
            >
              <span className="font-mono text-[10px]">{done ? '✓' : i + 1}</span>
              {label}
            </span>
            {i < labels.length - 1 && <span className="h-px w-4 bg-void-700" />}
          </li>
        )
      })}
    </ol>
  )
}
