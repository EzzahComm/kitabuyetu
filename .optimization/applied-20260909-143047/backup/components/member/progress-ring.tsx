import * as React from 'react';

interface ProgressRingProps {
  /** 0–100. */
  value: number;
  size?: number;
  stroke?: number;
  color?: string;
  trackColor?: string;
  children?: React.ReactNode;
  className?: string;
}

/**
 * Lightweight SVG progress ring — used for savings-goal completion and other
 * "how far along am I" visuals. Pure SVG (no chart lib) so it's tiny and crisp
 * on low-end mobile devices.
 */
export function ProgressRing({
  value, size = 64, stroke = 6, color = '#3CB043', trackColor = '#EAF7EC', children, className,
}: ProgressRingProps) {
  const clamped = Math.max(0, Math.min(100, value));
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (clamped / 100) * circumference;

  return (
    <div className={className} style={{ width: size, height: size, position: 'relative' }}>
      <svg width={size} height={size} className="-rotate-90" role="img" aria-label={`${Math.round(clamped)}% complete`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={trackColor} strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.6s cubic-bezier(0.16,1,0.3,1)' }}
        />
      </svg>
      {children && (
        <div className="absolute inset-0 flex items-center justify-center text-center">{children}</div>
      )}
    </div>
  );
}
