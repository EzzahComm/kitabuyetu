"use client";

import { useState, useCallback } from "react";
import { IconCheck, IconX, IconAlertCircle, IconInfoCircle } from "@tabler/icons-react";

export type ToastType = "success" | "error" | "warning" | "info";

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

interface ToastContextType {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, "id">) => string;
  removeToast: (id: string) => void;
}

/**
 * Toast notification component
 * Displays at bottom-right corner
 */
export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((toast: Omit<Toast, "id">) => {
    const id = Math.random().toString(36).substr(2, 9);
    const duration = toast.duration ?? 3000;
    const newToast: Toast = { ...toast, id, duration };

    setToasts((prev) => [...prev, newToast]);

    if (duration > 0) {
      setTimeout(() => {
        removeToast(id);
      }, duration);
    }

    return id;
  }, [removeToast]);

  const getIcon = (type: ToastType) => {
    const iconProps = { size: 20, className: "flex-shrink-0" };
    switch (type) {
      case "success":
        return (
          <IconCheck {...iconProps} className="text-success-600 dark:text-success-400" />
        );
      case "error":
        return (
          <IconX {...iconProps} className="text-error-600 dark:text-error-400" />
        );
      case "warning":
        return (
          <IconAlertCircle {...iconProps} className="text-warning-600 dark:text-warning-400" />
        );
      case "info":
      default:
        return (
          <IconInfoCircle {...iconProps} className="text-info-600 dark:text-info-400" />
        );
    }
  };

  const getBackgroundColor = (type: ToastType) => {
    switch (type) {
      case "success":
        return "bg-success-50 dark:bg-success-900/20 border-success-200 dark:border-success-800";
      case "error":
        return "bg-error-50 dark:bg-error-900/20 border-error-200 dark:border-error-800";
      case "warning":
        return "bg-warning-50 dark:bg-warning-900/20 border-warning-200 dark:border-warning-800";
      case "info":
      default:
        return "bg-info-50 dark:bg-info-900/20 border-info-200 dark:border-info-800";
    }
  };

  const getTextColor = (type: ToastType) => {
    switch (type) {
      case "success":
        return "text-success-900 dark:text-success-100";
      case "error":
        return "text-error-900 dark:text-error-100";
      case "warning":
        return "text-warning-900 dark:text-warning-100";
      case "info":
      default:
        return "text-info-900 dark:text-info-100";
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2 pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto max-w-sm p-4 rounded-lg border ${getBackgroundColor(
            toast.type
          )} ${getTextColor(toast.type)} shadow-lg animate-in slide-in-from-right-4 duration-200`}
          role="alert"
        >
          <div className="flex gap-3">
            {getIcon(toast.type)}
            <div className="flex-1">
              <h3 className="font-semibold">{toast.title}</h3>
              {toast.message && <p className="text-sm opacity-90 mt-1">{toast.message}</p>}
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              className="flex-shrink-0 hover:opacity-70 transition-opacity"
              aria-label="Close"
            >
              <IconX size={18} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * useToast hook
 * Usage: const { addToast } = useToast();
 */
export function useToast() {
  // Note: In a real app, you'd use Context/Provider
  // This is a simplified version. Production should use Context API or a state management library
  return {
    addToast: (toast: Omit<Toast, "id">) => {
      // Placeholder - implement with Context API in production
      console.log("Toast:", toast);
    },
  };
}
