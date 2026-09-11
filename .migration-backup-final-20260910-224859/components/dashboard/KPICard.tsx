import React from "react";
import { Card } from "@/components/ui/Card";

interface KPICardProps {
  title: string;
  value: string | number;
  unit?: string;
  trend?: {
    value: number;
    direction: "up" | "down";
  };
  icon?: React.ReactNode;
  color?: "primary" | "success" | "warning" | "error" | "slate";
}

/**
 * KPI Card component
 * Displays a key performance indicator with value, trend, and optional icon
 */
export function KPICard({
  title,
  value,
  unit,
  trend,
  icon,
  color = "primary",
}: KPICardProps) {
  const colorClasses = {
    primary: "bg-primary-50 dark:bg-primary-900/30 border-primary-200 dark:border-primary-800",
    success: "bg-success-50 dark:bg-success-900/30 border-success-200 dark:border-success-800",
    warning: "bg-warning-50 dark:bg-warning-900/30 border-warning-200 dark:border-warning-800",
    error: "bg-error-50 dark:bg-error-900/30 border-error-200 dark:border-error-800",
    slate: "bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700",
  };

  const trendColorClasses = {
    up: "text-success-600 dark:text-success-400",
    down: "text-error-600 dark:text-error-400",
  };

  return (
    <Card variant="outlined" className={colorClasses[color]}>
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
            {title}
          </p>
        </div>
        {icon && <div className="flex-shrink-0">{icon}</div>}
      </div>

      <div className="mb-2">
        <div className="flex items-baseline gap-1">
          <span className="text-3xl font-bold text-gray-900 dark:text-white">
            {value}
          </span>
          {unit && (
            <span className="text-sm font-medium text-gray-500 dark:text-gray-400">
              {unit}
            </span>
          )}
        </div>
      </div>

      {trend && (
        <div className={`text-sm font-medium ${trendColorClasses[trend.direction]}`}>
          <span>{trend.direction === "up" ? "↑" : "↓"}</span>
          <span className="ml-1">{trend.value}%</span>
          <span className="text-gray-600 dark:text-gray-400 ml-1">vs last month</span>
        </div>
      )}
    </Card>
  );
}
