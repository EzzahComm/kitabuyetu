"use client";

import { useState } from "react";
import {
  IconBell,
  IconAlertCircle,
  IconCheck,
  IconInfoCircle,
  IconX,
} from "@tabler/icons-react";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/dashboard";

interface Notification {
  id: string;
  title: string;
  message: string;
  type: "alert" | "warning" | "success" | "info";
  timestamp: string;
  read: boolean;
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([
    {
      id: "1",
      title: "Loan Default Alert",
      message: "David Brown's loan (L004) is now overdue by 2 weeks.",
      type: "alert",
      timestamp: "2 hours ago",
      read: false,
    },
    {
      id: "2",
      title: "New Contribution Received",
      message: "John Doe contributed KES 5,000 to the group savings.",
      type: "success",
      timestamp: "4 hours ago",
      read: false,
    },
    {
      id: "3",
      title: "Meeting Scheduled",
      message: "Monthly group meeting scheduled for September 15 at 2:00 PM.",
      type: "info",
      timestamp: "1 day ago",
      read: true,
    },
    {
      id: "4",
      title: "Low Savings Warning",
      message: "Jane Smith's savings are below the minimum required amount.",
      type: "warning",
      timestamp: "2 days ago",
      read: true,
    },
    {
      id: "5",
      title: "New Member Joined",
      message: "Welcome! Peter Johnson has joined the group.",
      type: "info",
      timestamp: "3 days ago",
      read: true,
    },
  ]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const markAsRead = (id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
  };

  const deleteNotification = (id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  const getIcon = (type: string) => {
    const baseClasses = "flex-shrink-0";
    switch (type) {
      case "alert":
        return <IconAlertCircle size={20} className={`${baseClasses} text-error-600 dark:text-error-400`} />;
      case "warning":
        return <IconAlertCircle size={20} className={`${baseClasses} text-warning-600 dark:text-warning-400`} />;
      case "success":
        return <IconCheck size={20} className={`${baseClasses} text-success-600 dark:text-success-400`} />;
      case "info":
        return <IconInfoCircle size={20} className={`${baseClasses} text-info-600 dark:text-info-400`} />;
      default:
        return <IconBell size={20} className={baseClasses} />;
    }
  };

  const getBgColor = (type: string, read: boolean) => {
    if (read) return "bg-white dark:bg-slate-800";
    switch (type) {
      case "alert":
        return "bg-error-50 dark:bg-error-900/20";
      case "warning":
        return "bg-warning-50 dark:bg-warning-900/20";
      case "success":
        return "bg-success-50 dark:bg-success-900/20";
      case "info":
        return "bg-info-50 dark:bg-info-900/20";
      default:
        return "bg-gray-50 dark:bg-gray-800";
    }
  };

  return (
    <div>
      {/* Page Header */}
      <PageHeader
        title="Notifications"
        description={`You have ${unreadCount} unread notification${unreadCount !== 1 ? "s" : ""}`}
      />

      {/* Filter Tabs */}
      <div className="flex gap-4 mb-6 border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
        {["all", "unread", "alerts", "updates"].map((filter) => (
          <button
            key={filter}
            className="px-4 py-3 font-medium text-sm border-b-2 border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 transition-colors"
          >
            {filter === "all" && "All"}
            {filter === "unread" && "Unread"}
            {filter === "alerts" && "Alerts"}
            {filter === "updates" && "Updates"}
          </button>
        ))}
      </div>

      {/* Notifications List */}
      <div className="space-y-3">
        {notifications.length === 0 ? (
          <Card className="text-center py-12">
            <div className="flex justify-center mb-4">
              <IconBell size={32} className="text-gray-400 dark:text-gray-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              All caught up!
            </h3>
            <p className="text-gray-600 dark:text-gray-400">
              You have no notifications at this time.
            </p>
          </Card>
        ) : (
          notifications.map((notification) => (
            <Card
              key={notification.id}
              className={`${getBgColor(notification.type, notification.read)} border-l-4 ${
                notification.type === "alert"
                  ? "border-error-500"
                  : notification.type === "warning"
                    ? "border-warning-500"
                    : notification.type === "success"
                      ? "border-success-500"
                      : "border-info-500"
              } ${!notification.read ? "ring-1 ring-current" : ""}`}
            >
              <div className="p-4 flex gap-4">
                {/* Icon */}
                <div className="flex items-start pt-1">
                  {getIcon(notification.type)}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start gap-2">
                    <h3
                      className={`font-semibold ${
                        notification.read
                          ? "text-gray-900 dark:text-white"
                          : "text-gray-900 dark:text-white font-bold"
                      }`}
                    >
                      {notification.title}
                    </h3>
                    {!notification.read && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 flex-shrink-0">
                        New
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                    {notification.message}
                  </p>
                  <div className="flex items-center justify-between mt-3">
                    <p className="text-xs text-gray-500 dark:text-gray-500">
                      {notification.timestamp}
                    </p>
                    {!notification.read && (
                      <button
                        onClick={() => markAsRead(notification.id)}
                        className="text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline"
                      >
                        Mark as read
                      </button>
                    )}
                  </div>
                </div>

                {/* Delete Button */}
                <button
                  onClick={() => deleteNotification(notification.id)}
                  className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex-shrink-0"
                  aria-label="Delete notification"
                >
                  <IconX size={18} />
                </button>
              </div>
            </Card>
          ))
        )}
      </div>

      {/* Footer */}
      {notifications.length > 0 && (
        <div className="mt-6 text-center">
          <button className="text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200">
            Clear all notifications
          </button>
        </div>
      )}
    </div>
  );
}
