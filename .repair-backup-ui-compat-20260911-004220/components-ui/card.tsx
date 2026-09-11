"use client";

import React from "react";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "elevated" | "outlined";
  children: React.ReactNode;
}

/**
 * Card component for grouping related content
 * Supports multiple variants for different visual treatments
 */
const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ variant = "default", className, children, ...props }, ref) => {
    const variants = {
      default:
        "bg-white dark:bg-slate-800 rounded-md border border-slate-200 dark:border-slate-700",
      elevated:
        "bg-white dark:bg-slate-800 rounded-md shadow-md dark:shadow-lg",
      outlined:
        "bg-transparent border-2 border-slate-300 dark:border-slate-600 rounded-md",
    };

    return (
      <div
        ref={ref}
        className={`p-6 ${variants[variant]} ${className || ""}`}
        {...props}
      >
        {children}
      </div>
    );
  }
);

Card.displayName = "Card";

// CardHeader component
interface CardHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  subtitle?: string;
  children?: React.ReactNode;
}

const CardHeader = React.forwardRef<HTMLDivElement, CardHeaderProps>(
  ({ title, subtitle, children, className, ...props }, ref) => (
    <div ref={ref} className={`mb-4 ${className || ""}`} {...props}>
      {children ? (
        children
      ) : (
        <>
          {title && (
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
              {title}
            </h3>
          )}
          {subtitle && (
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              {subtitle}
            </p>
          )}
        </>
      )}
    </div>
  )
);

CardHeader.displayName = "CardHeader";

// CardContent component
interface CardContentProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

const CardContent = React.forwardRef<HTMLDivElement, CardContentProps>(
  ({ className, children, ...props }, ref) => (
    <div ref={ref} className={`${className || ""}`} {...props}>
      {children}
    </div>
  )
);

CardContent.displayName = "CardContent";

// CardFooter component
interface CardFooterProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

const CardFooter = React.forwardRef<HTMLDivElement, CardFooterProps>(
  ({ className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={`mt-6 pt-6 border-t border-slate-200 dark:border-slate-700 ${className || ""}`}
      {...props}
    >
      {children}
    </div>
  )
);

CardFooter.displayName = "CardFooter";

const CompoundCard = Card as typeof Card & {
  Header: typeof CardHeader;
  Content: typeof CardContent;
  Footer: typeof CardFooter;
};

CompoundCard.Header = CardHeader;
CompoundCard.Content = CardContent;
CompoundCard.Footer = CardFooter;

export { CompoundCard as Card, CardHeader, CardContent, CardFooter };
export default CompoundCard;
