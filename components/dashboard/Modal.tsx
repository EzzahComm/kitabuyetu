"use client";

import { Fragment } from "react";
import { IconX } from "@tabler/icons-react";
import { Button } from "@/components/ui/Button";

interface ModalProps {
  isOpen: boolean;
  title: string;
  description?: string;
  children: React.ReactNode;
  onClose: () => void;
  actions?: {
    primary: { label: string; onClick: () => void; loading?: boolean };
    secondary?: { label: string; onClick: () => void };
  };
  size?: "sm" | "md" | "lg";
  closeOnBackdropClick?: boolean;
}

/**
 * Modal component
 * Displays content in a centered dialog with backdrop
 */
export function Modal({
  isOpen,
  title,
  description,
  children,
  onClose,
  actions,
  size = "md",
  closeOnBackdropClick = true,
}: ModalProps) {
  if (!isOpen) return null;

  const sizeClasses = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-lg",
  };

  return (
    <Fragment>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40 transition-opacity"
        onClick={() => closeOnBackdropClick && onClose()}
        aria-hidden="true"
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className={`${sizeClasses[size]} bg-white dark:bg-slate-800 rounded-lg shadow-xl overflow-hidden max-h-[90vh] overflow-y-auto`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-start justify-between p-6 border-b border-gray-200 dark:border-gray-700">
            <div className="flex-1">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                {title}
              </h2>
              {description && (
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  {description}
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              className="ml-4 p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors text-gray-600 dark:text-gray-400"
              aria-label="Close modal"
            >
              <IconX size={20} />
            </button>
          </div>

          {/* Content */}
          <div className="p-6">{children}</div>

          {/* Footer with Actions */}
          {actions && (
            <div className="flex gap-3 p-6 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 justify-end">
              {actions.secondary && (
                <Button
                  variant="outline"
                  size="md"
                  onClick={actions.secondary.onClick}
                >
                  {actions.secondary.label}
                </Button>
              )}
              <Button
                variant="primary"
                size="md"
                onClick={actions.primary.onClick}
                disabled={actions.primary.loading}
              >
                {actions.primary.loading ? "Loading..." : actions.primary.label}
              </Button>
            </div>
          )}
        </div>
      </div>
    </Fragment>
  );
}
