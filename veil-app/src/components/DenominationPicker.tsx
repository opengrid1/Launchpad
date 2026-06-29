import { DENOMINATIONS, type Denomination } from '../lib/notes'
import { poolFor } from '../data/pool'

export function DenominationPicker({
  value,
  onChange,
}: {
  value: Denomination
  onChange: (d: Denomination) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
      {DENOMINATIONS.map((d) => {
        const pool = poolFor(d)
        const selected = d === value
        return (
          <button
            key={d}
            onClick={() => onChange(d)}
            className={`cursor-pointer rounded-xl p-3 text-left ring-1 transition ${
              selected
                ? 'bg-iris-500/15 ring-iris-500/50'
                : 'bg-void-850 ring-void-700 hover:ring-void-600'
            }`}
          >
            <span className={`block font-mono text-lg font-semibold ${selected ? 'text-iris-300' : 'text-fog-100'}`}>
              {d}
            </span>
            <span className="block text-[11px] text-fog-500">HYPE</span>
            <span className="mt-1.5 block text-[10px] text-fog-500">
              {pool.deposits.toLocaleString()} in set
            </span>
          </button>
        )
      })}
    </div>
  )
}
