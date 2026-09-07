/**
 * Format utilities
 * Common formatting functions for display
 */

/**
 * Format number as currency (Kenyan Shilling)
 * @param amount - Number to format
 * @param currency - Currency code (default: KES)
 * @returns Formatted currency string
 */
export function formatCurrency(
  amount: number | string,
  currency: string = "KES"
): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;

  if (isNaN(num)) return `${currency} 0`;

  return `${currency} ${num.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

/**
 * Format number with thousand separators
 * @param num - Number to format
 * @returns Formatted number string
 */
export function formatNumber(num: number | string): string {
  const n = typeof num === "string" ? parseFloat(num) : num;
  if (isNaN(n)) return "0";
  return n.toLocaleString("en-US");
}

/**
 * Format date
 * @param date - Date to format
 * @param locale - Locale (default: en-US)
 * @returns Formatted date string
 */
export function formatDate(
  date: Date | string,
  locale: string = "en-US"
): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "Invalid date";

  return d.toLocaleDateString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Format time
 * @param date - Date to format
 * @returns Formatted time string
 */
export function formatTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "Invalid time";

  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * Format relative time (e.g., "2 hours ago")
 * @param date - Date to format
 * @returns Relative time string
 */
export function formatRelativeTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "Invalid date";

  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);

  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;

  return formatDate(d);
}

/**
 * Format percentage
 * @param value - Value to format
 * @param decimals - Number of decimal places (default: 1)
 * @returns Formatted percentage string
 */
export function formatPercentage(value: number | string, decimals: number = 1): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "0%";

  return `${num.toFixed(decimals)}%`;
}

/**
 * Format phone number
 * @param phone - Phone number to format
 * @returns Formatted phone number
 */
export function formatPhoneNumber(phone: string): string {
  // Remove non-digit characters
  const cleaned = phone.replace(/\D/g, "");

  // Format as +254 XXX XXXXXX
  if (cleaned.length === 12 && cleaned.startsWith("254")) {
    return `+${cleaned.slice(0, 3)} ${cleaned.slice(3, 6)} ${cleaned.slice(6)}`;
  }

  // Format as +254 XXX XXXXXX (if missing +)
  if (cleaned.length === 10) {
    return `+254 ${cleaned.slice(0, 3)} ${cleaned.slice(3)}`;
  }

  return phone;
}

/**
 * Format email (truncate if too long)
 * @param email - Email to format
 * @param maxLength - Maximum length (default: 30)
 * @returns Formatted email
 */
export function formatEmail(email: string, maxLength: number = 30): string {
  if (email.length <= maxLength) return email;
  return `${email.slice(0, maxLength - 3)}...`;
}

/**
 * Truncate text
 * @param text - Text to truncate
 * @param maxLength - Maximum length
 * @returns Truncated text with ellipsis
 */
export function truncateText(text: string, maxLength: number = 50): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}

/**
 * Capitalize first letter
 * @param text - Text to capitalize
 * @returns Capitalized text
 */
export function capitalize(text: string): string {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

/**
 * Format loan status
 * @param status - Status string
 * @returns Formatted status
 */
export function formatLoanStatus(status: string): string {
  const statusMap: Record<string, string> = {
    active: "Active",
    pending: "Pending",
    completed: "Completed",
    defaulted: "Defaulted",
  };
  return statusMap[status.toLowerCase()] || capitalize(status);
}

/**
 * Usage examples:
 *
 * formatCurrency(250000) // "KES 250,000"
 * formatNumber(1234567) // "1,234,567"
 * formatDate("2026-09-06") // "Sep 6, 2026"
 * formatTime("2026-09-06T14:30:00") // "02:30 PM"
 * formatRelativeTime(new Date(Date.now() - 3600000)) // "1 hours ago"
 * formatPercentage(12.5) // "12.5%"
 * formatPhoneNumber("254712345678") // "+254 712 345678"
 * truncateText("Very long text here", 10) // "Very lon..."
 */
