'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface ExpandableTextProps {
  children: React.ReactNode;
  /** Lines shown before clamping. */
  lines?: 1 | 2 | 3;
  className?: string;
}

/**
 * Long free-text in a dense table cell (a failure reason, remarks, an SMS
 * body). Previously these were `truncate` + `title=`, which is a desktop-only
 * affordance — a `title` tooltip needs hover, so on a phone or tablet the
 * hidden half of the text was simply unreachable
 * (UX_UI_OPTIMIZATION_AUDIT_2026-08.md M7).
 *
 * Clamps to `lines` and, only when the content actually overflows, becomes a
 * tap/click target that expands it in place. Measuring rather than always
 * rendering a button matters: a control that looks interactive but does
 * nothing is its own (smaller) version of the same problem.
 */
export function ExpandableText({ children, lines = 2, className }: ExpandableTextProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [overflows, setOverflows] = useState(false);
  const [expanded, setExpanded]   = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Only meaningful while clamped; once expanded the two heights match again.
    if (!expanded) setOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [children, expanded]);

  const clamp = expanded
    ? ''
    : lines === 1 ? 'line-clamp-1' : lines === 3 ? 'line-clamp-3' : 'line-clamp-2';

  const text = (
    <span ref={ref} className={cn('block', clamp, className)}>
      {children}
    </span>
  );

  if (!overflows && !expanded) return text;

  return (
    <button
      type="button"
      onClick={() => setExpanded((e) => !e)}
      aria-expanded={expanded}
      className="block w-full cursor-pointer text-left hover:opacity-80"
      title={expanded ? 'Show less' : 'Show more'}
    >
      {text}
    </button>
  );
}
