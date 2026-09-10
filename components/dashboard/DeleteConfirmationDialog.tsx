"use client";

import { useState } from "react";
import { IconAlertTriangle } from "@tabler/icons-react";
import { Modal } from "./Modal";
import { Button } from "@/components/ui/Button";

interface DeleteConfirmationDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  itemName?: string;
  onClose: () => void;
  onConfirm: () => void;
  isLoading?: boolean;
  isDangerous?: boolean; // Makes delete button red if true
}

/**
 * Delete Confirmation Dialog
 * Confirmation modal for destructive actions
 */
export function DeleteConfirmationDialog({
  isOpen,
  title,
  message,
  itemName,
  onClose,
  onConfirm,
  isLoading = false,
  isDangerous = true,
}: DeleteConfirmationDialogProps) {
  return (
    <Modal
      isOpen={isOpen}
      title={title}
      onClose={onClose}
      size="sm"
      closeOnBackdropClick={false}
      actions={{
        primary: {
          label: "Delete",
          onClick: onConfirm,
          loading: isLoading,
        },
        secondary: {
          label: "Cancel",
          onClick: onClose,
        },
      }}
    >
      <div className="flex gap-4">
        <div className="flex-shrink-0 mt-0.5">
          <IconAlertTriangle
            size={24}
            className="text-error-600 dark:text-error-400"
          />
        </div>
        <div>
          <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">
            {message}
          </p>
          {itemName && (
            <div className="p-3 bg-error-50 dark:bg-error-900/20 border border-error-200 dark:border-error-800 rounded text-sm text-error-900 dark:text-error-100">
              <strong>{itemName}</strong>
            </div>
          )}
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
            This action cannot be undone.
          </p>
        </div>
      </div>
    </Modal>
  );
}
