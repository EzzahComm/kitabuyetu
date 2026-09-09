"use client";

import React from "react";

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "primary" | "success" | "warning" | "error" | "slate";
  size?: "sm" | "md";
  children: React.ReactNode;
}

/**
 * Badge component for displaying small labels and status indicators
 * Supports multiple semantic variants for different meanings
 */
const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ variant = "default", size = "md", className, children, ...props }, ref) => {
    const variants = {
      default:
        "bg-slate-100 text-slate-900 dark:bg-slate-700 dark:text-slate-50",
      primary:
        "bg-primary-100 text-primary-900 dark:bg-primary-900/30 dark:text-primary-400",
      success:
        "bg-success-100 text-success-900 dark:bg-success-900/30 dark:text-success-400",
      warning:
        "bg-warning-100 text-warning-900 dark:bg-warning-900/30 dark:text-warning-400",
      error:
        "bg-error-100 text-error-900 dark:bg-error-900/30 dark:text-error-400",
      slate: "bg-slate-200 text-slate-700 dark:bg-slate-600 dark:text-slate-200",
    };

    const sizes = {
      sm: "px-2 py-1 text-xs font-medium rounded",
      md: "px-3 py-1.5 text-sm font-medium rounded-md",
    };

    return (
      <span
        ref={ref}
        className={`inline-block ${variants[variant]} ${sizes[size]} ${className || ""}`}
        {...props}
      >
        {children}
      </span>
    );
  }
);

Badge.displayName = "Badge";

export { Badge };
export default Badge;
