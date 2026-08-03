export function ProgressBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value * 100));
  return (
    <div className="progress">
      <div className="progress-fill" style={{ width: pct + "%" }} />
    </div>
  );
}
