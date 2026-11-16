import { scoreBand, bandLabel } from './score.js';

// The fit dial: one ring for the overall quality score.

export default function FitDial({ score = 0, size = 168, label = 'Fit score', caption }) {
  const value = Math.max(0, Math.min(100, Math.round(score)));
  const stroke = Math.round(size * 0.085);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const band = scoreBand(value);
  return (
    <figure className={`fit-dial band-${band}`} style={{ width: size }} aria-label={`${label}: ${value} out of 100`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="fit-track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} fill="none" />
        <circle
          className="fit-value"
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${(value / 100) * c} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="fit-center">
        <strong>{value}</strong>
        <span>{label}</span>
      </div>
      <figcaption>{caption ?? bandLabel[band]}</figcaption>
    </figure>
  );
}

export function MeterRow({ icon: Icon, label, value, max = 100, display }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="meter-row">
      <div className="meter-label">
        {Icon ? <Icon size={16} aria-hidden="true" /> : null}
        <span>{label}</span>
        <strong>{display ?? `${value}%`}</strong>
      </div>
      <div className="meter-track" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
        <div className={`meter-fill band-${scoreBand(pct)}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
