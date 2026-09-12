/**
 * Component exports
 * Centralized barrel exports for cleaner imports
 */

// Base UI Components
export { Button } from "./ui/button";
export { Input } from "./ui/input";
export { Card } from "./ui/card";
export { Badge } from "./ui/badge";
export { Spinner } from "./ui/Spinner";

// Layout Components — legacy dashboard components have been removed
// See components/shared/ and components/ui/ for current component primitives
export { ToastContainer } from "./Toast";

// Theme Components
export { ThemeProvider } from "./ThemeProvider";
export { ThemeToggle } from "./ThemeToggle";

// Brand Components
export { BrandLogo } from "./BrandLogo";
export { Container } from "./Container";
export { SectionTitle } from "./SectionTitle";
export { Cta } from "./Cta";
