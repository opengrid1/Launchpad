export function Logo({ size = 30 }: { size?: number }) {
  return (
    <span className="row gap-3" style={{ fontWeight: 800, fontSize: "1.15rem", letterSpacing: "-0.03em" }}>
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="9" fill="#11151C" stroke="rgba(255,255,255,0.1)" />
        <path
          d="M9 22V10l7 8 7-8v12"
          stroke="url(#mlg)"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <defs>
          <linearGradient id="mlg" x1="9" y1="10" x2="23" y2="22">
            <stop stopColor="#3DE8B0" />
            <stop offset="1" stopColor="#4DD6E8" />
          </linearGradient>
        </defs>
      </svg>
      Meridian
    </span>
  );
}
