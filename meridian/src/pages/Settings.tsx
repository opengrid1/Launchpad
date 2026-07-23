import { useState } from "react";
import { CHAINS } from "../lib/data";
import { shortAddr } from "../lib/format";
import { useApp } from "../lib/store";
import { Icon } from "../components/Icon";
import { Modal, ModalHeader, Toggle } from "../components/ui";

function Row({
  title,
  body,
  children,
}: {
  title: string;
  body?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="row between gap-4" style={{ padding: "16px 0", borderBottom: "1px solid var(--border)" }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>{title}</div>
        {body && <div className="muted" style={{ fontSize: "0.85rem", marginTop: 3 }}>{body}</div>}
      </div>
      {children}
    </div>
  );
}

export function Settings() {
  const { settings, updateSettings, chain, setChain, wallet, disconnect, toast } = useApp();
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <div className="page container" style={{ maxWidth: 720 }}>
      <h1 className="h2" style={{ marginBottom: 4 }}>Settings</h1>
      <p className="muted" style={{ fontSize: "0.92rem", marginBottom: 32 }}>
        Preferences are saved to this device.
      </p>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 className="h3" style={{ marginBottom: 6 }}>Preferences</h3>
        <Row title="Display currency" body="Prices and balances are shown in this currency.">
          <div className="seg">
            {(["USD", "EUR", "GBP"] as const).map((c) => (
              <button
                key={c}
                className={settings.currency === c ? "active" : ""}
                onClick={() => updateSettings({ currency: c })}
              >
                {c}
              </button>
            ))}
          </div>
        </Row>
        <Row title="Hide balances" body="Mask portfolio values across the app.">
          <Toggle on={settings.hideBalances} onChange={(v) => updateSettings({ hideBalances: v })} label="Hide balances" />
        </Row>
        <div style={{ borderBottom: "none" }}>
          <Row title="Show test networks" body="Include testnets in the chain selector.">
            <Toggle on={settings.testnets} onChange={(v) => updateSettings({ testnets: v })} label="Show test networks" />
          </Row>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 className="h3" style={{ marginBottom: 6 }}>Notifications</h3>
        <Row title="Transaction alerts" body="Get notified when a transaction confirms or fails.">
          <Toggle on={settings.txAlerts} onChange={(v) => updateSettings({ txAlerts: v })} label="Transaction alerts" />
        </Row>
        <Row title="Price alerts" body="Large moves on assets you hold.">
          <Toggle on={settings.priceAlerts} onChange={(v) => updateSettings({ priceAlerts: v })} label="Price alerts" />
        </Row>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 className="h3" style={{ marginBottom: 6 }}>Network</h3>
        <Row title="Active network" body="Where transactions are broadcast by default.">
          <div className="row gap-2 wrap" style={{ justifyContent: "flex-end" }}>
            {CHAINS.map((c) => (
              <button
                key={c.id}
                className={`badge${c.id === chain.id ? " accent" : ""}`}
                style={{ cursor: "pointer", height: 30 }}
                onClick={() => setChain(c.id)}
              >
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: c.color }} />
                {c.short}
              </button>
            ))}
          </div>
        </Row>
        <div style={{ borderBottom: "none" }}>
          <Row title="RPC endpoint" body="Meridian routes requests through redundant nodes.">
            <span className="badge">
              <span className="pulse-dot" />
              Healthy · {chain.latency}
            </span>
          </Row>
        </div>
      </div>

      {wallet && (
        <div className="card">
          <h3 className="h3" style={{ marginBottom: 6 }}>Wallet</h3>
          <Row title="Connected account" body={wallet.label}>
            <span className="badge mono">{shortAddr(wallet.address)}</span>
          </Row>
          <div className="row" style={{ paddingTop: 16 }}>
            <button className="btn btn-danger btn-sm" onClick={() => setConfirmOpen(true)}>
              <Icon name="x" size={15} />
              Disconnect wallet
            </button>
          </div>
        </div>
      )}

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <ModalHeader title="Disconnect wallet?" onClose={() => setConfirmOpen(false)} />
        <p className="muted" style={{ fontSize: "0.92rem", marginBottom: 24 }}>
          Your funds stay exactly where they are — disconnecting only removes
          this device's access to view your portfolio.
        </p>
        <div className="row gap-3">
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setConfirmOpen(false)}>
            Cancel
          </button>
          <button
            className="btn btn-danger"
            style={{ flex: 1 }}
            onClick={() => {
              setConfirmOpen(false);
              disconnect();
              toast({ kind: "info", title: "See you soon" });
            }}
          >
            Disconnect
          </button>
        </div>
      </Modal>
    </div>
  );
}
