import { useState } from "react";
import { useApp } from "../lib/store";
import { CHAINS } from "../lib/data";
import { portfolioValue } from "../lib/data";
import { fmtUsd, shortAddr } from "../lib/format";
import { useDismiss } from "../lib/hooks";
import { Icon } from "./Icon";
import { Modal, ModalHeader } from "./ui";

const WALLET_OPTIONS = [
  { id: "aperture", label: "Aperture Wallet", hue: "#3DE8B0", mark: "A" },
  { id: "browser", label: "Browser Wallet", hue: "#F7B84B", mark: "B" },
  { id: "walletlink", label: "WalletLink", hue: "#5B8DEF", mark: "W" },
  { id: "hardware", label: "Hardware Device", hue: "#9CA8B8", mark: "H" },
];

export function WalletModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { connect, connecting } = useApp();

  return (
    <Modal open={open} onClose={onClose}>
      <ModalHeader title="Connect a wallet" onClose={onClose} />
      <p className="muted" style={{ fontSize: "0.9rem", marginBottom: 18 }}>
        Your keys stay on your device. Meridian never has custody of your funds.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {WALLET_OPTIONS.map((w) => (
          <button
            key={w.id}
            className="dropdown-item"
            style={{
              border: "1px solid var(--border)",
              borderRadius: "var(--r-md)",
              padding: "13px 14px",
              background: "var(--surface-2)",
            }}
            disabled={connecting !== null}
            onClick={async () => {
              await connect(w.id, w.label);
              onClose();
            }}
          >
            <span
              className="token-icon"
              style={{
                width: 34,
                height: 34,
                fontSize: 14,
                background: `linear-gradient(135deg, ${w.hue}, ${w.hue}88)`,
              }}
            >
              {w.mark}
            </span>
            <span style={{ flex: 1 }}>{w.label}</span>
            {connecting === w.id ? (
              <span className="spin" style={{ color: "var(--accent)", display: "inline-flex" }}>
                <Icon name="spinner" size={18} />
              </span>
            ) : (
              <span className="faint">
                <Icon name="chevron" size={16} className="" strokeWidth={2} />
              </span>
            )}
          </button>
        ))}
      </div>
      <p className="faint" style={{ fontSize: "0.78rem", marginTop: 18, textAlign: "center" }}>
        By connecting you agree to the Meridian Terms of Use.
      </p>
    </Modal>
  );
}

export function WalletButton() {
  const { wallet, disconnect, toast } = useApp();
  const [modalOpen, setModalOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const ref = useDismiss<HTMLDivElement>(menuOpen, () => setMenuOpen(false));

  if (!wallet) {
    return (
      <>
        <button className="btn btn-primary btn-sm" onClick={() => setModalOpen(true)}>
          <Icon name="wallet" size={16} />
          Connect
        </button>
        <WalletModal open={modalOpen} onClose={() => setModalOpen(false)} />
      </>
    );
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        className="btn btn-soft btn-sm"
        onClick={() => setMenuOpen((v) => !v)}
        style={{ gap: 10 }}
      >
        <span className="pulse-dot" />
        <span className="mono">{shortAddr(wallet.address)}</span>
        <Icon name="chevron" size={14} strokeWidth={2} />
      </button>
      {menuOpen && (
        <div className="dropdown" style={{ minWidth: 260 }}>
          <div style={{ padding: "12px 12px 10px" }}>
            <div className="card-title">Portfolio</div>
            <div className="tnum" style={{ fontSize: "1.5rem", fontWeight: 700, marginTop: 2 }}>
              {fmtUsd(portfolioValue())}
            </div>
            <div className="muted" style={{ fontSize: "0.8rem", marginTop: 2 }}>
              {wallet.label}
            </div>
          </div>
          <hr className="divider" style={{ margin: "4px 0" }} />
          <button
            className="dropdown-item"
            onClick={() => {
              navigator.clipboard?.writeText(wallet.address).catch(() => {});
              toast({ kind: "success", title: "Address copied" });
              setMenuOpen(false);
            }}
          >
            <Icon name="copy" size={17} />
            Copy address
          </button>
          <button
            className="dropdown-item"
            onClick={() => {
              toast({ kind: "info", title: "Opening explorer", body: shortAddr(wallet.address) });
              setMenuOpen(false);
            }}
          >
            <Icon name="external" size={17} />
            View on explorer
          </button>
          <button
            className="dropdown-item"
            style={{ color: "var(--down)" }}
            onClick={() => {
              disconnect();
              setMenuOpen(false);
            }}
          >
            <Icon name="x" size={17} />
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

export function ChainSelector() {
  const { chain, setChain } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button className="btn btn-soft btn-sm" onClick={() => setOpen((v) => !v)} style={{ gap: 8 }}>
        <span
          style={{
            width: 9,
            height: 9,
            borderRadius: "50%",
            background: chain.color,
            boxShadow: `0 0 8px ${chain.color}99`,
          }}
        />
        <span className="hide-narrow">{chain.name}</span>
        <Icon name="chevron" size={14} strokeWidth={2} />
      </button>
      {open && (
        <div className="dropdown">
          {CHAINS.map((c) => (
            <button
              key={c.id}
              className={`dropdown-item${c.id === chain.id ? " selected" : ""}`}
              onClick={() => {
                setChain(c.id);
                setOpen(false);
              }}
            >
              <span
                style={{ width: 9, height: 9, borderRadius: "50%", background: c.color }}
              />
              <span style={{ flex: 1 }}>{c.name}</span>
              <span className="faint" style={{ fontSize: "0.75rem" }}>{c.latency}</span>
              {c.id === chain.id && (
                <span style={{ color: "var(--accent)" }}>
                  <Icon name="check" size={15} strokeWidth={2.2} />
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function NetworkBadge() {
  const { chain } = useApp();
  return (
    <span className="badge accent">
      <span className="pulse-dot" style={{ background: chain.color }} />
      {chain.name} · live
    </span>
  );
}
