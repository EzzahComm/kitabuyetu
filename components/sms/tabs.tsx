/**
 * Modularized SMS tab components.
 * Re-exports from tabs/ subdirectory for backwards compatibility.
 * Each tab is now in its own file for better code organization and lazy-loading.
 */
export {
  ComposeTab,
  CampaignsTab,
  TemplatesTab,
  SchedulesTab,
  LogsTab,
  OptOutsTab,
  TABS,
  TabKey,
  StatusBadge,
  CategoryBadge,
} from './tabs';
