import './RobinhoodFeather.css'

export function RobinhoodFeather({ size = 48 }: { size?: number }) {
  const s = size / 48  // scale factor

  return (
    <div className="rh-feather" style={{ '--s': s } as React.CSSProperties}>
      {/* main vane — left side */}
      <div className="rh-vane rh-vane-left" />
      {/* main vane — right side */}
      <div className="rh-vane rh-vane-right" />
      {/* rachis / quill stem */}
      <div className="rh-rachis" />
      {/* tip point */}
      <div className="rh-tip" />
    </div>
  )
}
