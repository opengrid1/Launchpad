import type { Token } from "../lib/data";

export function TokenIcon({ token, size = 38 }: { token: Token; size?: number }) {
  return (
    <span
      className="token-icon"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.32,
        background: `linear-gradient(135deg, ${token.color}, ${token.colorB})`,
        boxShadow: `0 4px 14px -4px ${token.color}66`,
      }}
    >
      {token.symbol.slice(0, 3)}
    </span>
  );
}
