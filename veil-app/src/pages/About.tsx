const STEPS = [
  {
    n: '01',
    title: 'Deposit a fixed amount',
    body: 'You lock a standard denomination (0.1 / 1 / 10 / 100 HYPE). Your client generates a secret + nullifier, hashes them into a commitment, and only the commitment goes on-chain — added as a leaf to a Merkle tree of all deposits.',
  },
  {
    n: '02',
    title: 'Keep the note',
    body: 'The note encodes your secret and nullifier. It is the only thing that can spend the deposit. There is no account and no recovery: hold it like cash.',
  },
  {
    n: '03',
    title: 'Withdraw with a proof',
    body: 'Later, you prove in zero knowledge that you know a secret for some leaf in the tree — without revealing which leaf. The contract checks the proof, records the nullifier so it can never be reused, and releases the funds.',
  },
  {
    n: '04',
    title: 'Land on a clean address',
    body: 'Send to a fresh address, optionally through a relayer that fronts the gas. Observers see a deposit here and a withdrawal there, but the set of equal-sized deposits makes the link ambiguous.',
  },
]

export function About() {
  return (
    <main className="rise-in mt-6 max-w-2xl">
      <h1 className="text-2xl font-bold tracking-tight">How Veil works</h1>
      <p className="mt-2 text-[14px] leading-relaxed text-fog-300">
        Veil is a non-custodial privacy pool, inspired by Veil Cash and the Tornado design. It
        breaks the on-chain link between where funds come from and where they go, using equal-sized
        pools and zero-knowledge proofs. Your keys, your note, your funds — no one holds them for you.
      </p>

      <ol className="mt-7 space-y-4">
        {STEPS.map((s) => (
          <li key={s.n} className="rounded-2xl bg-void-900 p-5 ring-1 ring-void-700">
            <div className="flex items-baseline gap-3">
              <span className="font-mono text-[12px] text-iris-400">{s.n}</span>
              <h2 className="text-[15px] font-semibold text-fog-100">{s.title}</h2>
            </div>
            <p className="mt-2 text-[13px] leading-relaxed text-fog-300">{s.body}</p>
          </li>
        ))}
      </ol>

      <div className="mt-7 rounded-2xl bg-iris-500/8 p-5 ring-1 ring-iris-500/20">
        <h2 className="text-[15px] font-semibold text-iris-300">What privacy depends on</h2>
        <ul className="mt-3 space-y-2 text-[13px] leading-relaxed text-fog-300">
          <li>· A large anonymity set — many equal deposits to hide among.</li>
          <li>· Time between deposit and withdrawal, so the crowd grows around you.</li>
          <li>· A fresh recipient address with no link back to your identity.</li>
          <li>· Not reusing the same note or address across actions.</li>
        </ul>
      </div>

      <div className="mt-5 rounded-2xl border border-dashed border-void-700 p-5 text-[13px] leading-relaxed text-fog-500">
        <span className="font-semibold text-fog-300">This is a frontend demo.</span> It models the
        protocol&apos;s flow — commitments, notes, nullifiers, relayer — but uses browser SHA-256
        instead of a real zk-SNARK and never touches a blockchain. Treat it as a UX prototype, not a
        privacy tool. A production build needs audited circuits, contracts, and a relayer network.
      </div>
    </main>
  )
}
