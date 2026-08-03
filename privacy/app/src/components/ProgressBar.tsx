export function ProgressBar({ value, soft }: { value: number; soft?: number }) {
  const pct = Math.max(0, Math.min(100, value * 100));
  return (
    <div className="progress">
      <div className="progress-fill" style={{ width: pct + "%" }} />
      {soft !== undefined && soft > 0 && soft < 1 && (
        <div className="progress-soft" style={{ left: soft * 100 + "%" }} title="soft cap" />
      )}
    </div>
  );
}
