'use client';

import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, ChevronDown, Search, LogOut, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth/context';
import { authApi } from '@/lib/api/endpoints';
import { Input } from '@/components/ui/input';

export interface PortalNavItem {
  href:   string;
  label:  string;
  icon:   React.ElementType;
  badge?: number;
  /**
   * Turns this item into a collapsible group instead of a direct link —
   * SIMPLIFICATION_AND_RBAC_AUDIT.md §3's "More"/overflow primitive.
   * `href` is ignored for a group (nothing to navigate to); it stays
   * required on the type so every item can still be used as a plain link
   * when `children` is omitted, without a second interface to keep in sync.
   */
  children?: PortalNavItem[];
}

export interface PortalNavSection {
  /** null renders the items with no section heading. */
  title: string | null;
  items: PortalNavItem[];
}

/**
 * Shared shell for the admin (light) and dashboard (dark) sidebars — the
 * mobile-overlay / active-link / sign-out mechanics were fully duplicated
 * between them. Every class below is variant-keyed verbatim from the two
 * originals so the merge is invisible: the admin console keeps its collapse
 * toggle, nav search, and red-hover sign-out; the dashboard keeps its dark
 * theme and larger touch targets.
 */
const V = {
  light: {
    overlay:        'bg-black/40',
    aside:          'bg-white border-r border-gray-200 transition-all duration-200',
    headerExpanded: 'flex items-center justify-between h-14 px-3 border-b border-gray-200 shrink-0',
    headerCollapsed:'flex flex-col items-center gap-1 py-2 border-b border-gray-200 shrink-0',
    closeBtn:       'lg:hidden p-1 rounded text-gray-400 hover:text-gray-600',
    closeIcon:      16,
    nav:            'flex-1 overflow-y-auto py-3 px-2 space-y-4',
    sectionTitle:   'text-[10px] font-semibold text-gray-400 uppercase tracking-widest px-2 mb-1',
    sectionWrap:    '',
    itemsWrap:      'space-y-0.5',
    link:           'flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm font-medium transition-colors group',
    linkActive:     'bg-blue-50 text-blue-700',
    linkInactive:   'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
    iconActive:     'text-blue-600',
    iconInactive:   'text-gray-400 group-hover:text-gray-600',
    iconSize:       16,
    footer:         'px-2 py-3 border-t border-gray-200 shrink-0',
    footerCollapsed:'px-1',
    signOut:        'w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm font-medium text-gray-500 hover:bg-red-50 hover:text-red-600 transition-colors',
    signOutIcon:    15,
    subGroupBorder: 'border-gray-200',
  },
  dark: {
    overlay:        'bg-black/50',
    aside:          'bg-gray-900 text-white transition-transform duration-300',
    headerExpanded: 'flex items-center justify-between px-4 h-16 border-b border-gray-700',
    headerCollapsed:'flex items-center justify-between px-4 h-16 border-b border-gray-700',
    closeBtn:       'lg:hidden text-gray-400 hover:text-white',
    closeIcon:      18,
    nav:            'flex-1 overflow-y-auto px-3 py-4 space-y-1',
    sectionTitle:   'px-3 pb-1 text-xs font-semibold text-gray-500 uppercase tracking-wider',
    sectionWrap:    'pt-3',
    itemsWrap:      '',
    link:           'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
    linkActive:     'bg-brand-500 text-white',
    linkInactive:   'text-gray-300 hover:bg-gray-800 hover:text-white',
    iconActive:     '',
    iconInactive:   '',
    iconSize:       18,
    footer:         'px-3 py-4 border-t border-gray-700 space-y-1',
    footerCollapsed:'',
    signOut:        'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-gray-300 hover:bg-gray-800 hover:text-white transition-colors',
    signOutIcon:    18,
    subGroupBorder: 'border-gray-700',
  },
} as const;

interface PortalSidebarProps {
  open:      boolean;
  onClose:   () => void;
  variant:   'light' | 'dark';
  sections:  PortalNavSection[];
  isActive:  (href: string) => boolean;
  /** Brand/logo block; receives the collapsed state (always false unless collapsible). */
  logo:      (collapsed: boolean) => React.ReactNode;
  /** Desktop collapse-to-icons toggle (admin console). */
  collapsible?: boolean;
  /** Nav filter input under the header (admin console). */
  searchable?:  boolean;
  /** Rendered between header and nav (dashboard's GroupSwitcher). */
  preNav?:   React.ReactNode;
  /** Rendered in the footer above the sign-out button. */
  footer?:   (collapsed: boolean) => React.ReactNode;
  /** Expanded/collapsed width classes. */
  widthExpanded:  string;
  widthCollapsed?: string;
}

export function PortalSidebar({
  open, onClose, variant, sections, isActive, logo,
  collapsible = false, searchable = false, preNav, footer,
  widthExpanded, widthCollapsed,
}: PortalSidebarProps) {
  const { logout, refreshToken } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [query, setQuery] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const v = V[variant];

  const handleLogout = async () => {
    try { await authApi.logout(refreshToken ?? undefined); } catch {}
    logout();
  };

  const filtered: PortalNavSection[] = useMemo(() => {
    if (!searchable || !query) return sections;
    return sections.map((s) => ({
      ...s,
      items: s.items.filter((i) =>
        i.label.toLowerCase().includes(query.toLowerCase()) ||
        i.children?.some((c) => c.label.toLowerCase().includes(query.toLowerCase())),
      ),
    })).filter((s) => s.items.length > 0);
  }, [sections, searchable, query]);

  // Auto-expand (never auto-collapse) any group containing the active route,
  // so landing on a "More"-bucketed page doesn't hide the very link that got
  // you there.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const section of sections) {
        for (const item of section.items) {
          if (item.children?.some((c) => isActive(c.href)) && !next.has(item.label)) {
            next.add(item.label);
            changed = true;
          }
        }
      }
      return changed ? next : prev;
    });
  }, [sections, isActive]);

  const toggleGroup = (label: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label); else next.add(label);
      return next;
    });
  };

  return (
    <>
      {open && (
        <div className={cn('fixed inset-0 z-40 lg:hidden', v.overlay)} onClick={onClose} />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex flex-col lg:static lg:z-auto',
          v.aside,
          collapsed && widthCollapsed ? widthCollapsed : widthExpanded,
          open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        )}
      >
        {/* Header */}
        <div className={collapsed ? v.headerCollapsed : v.headerExpanded}>
          {logo(collapsed)}
          <div className={cn('flex items-center gap-1')}>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close sidebar"
              title="Close sidebar"
              className={v.closeBtn}
            >
              <X size={v.closeIcon} />
            </button>
            {collapsible && (
              <button
                type="button"
                onClick={() => setCollapsed((c) => !c)}
                aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                className="hidden lg:flex p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              >
                {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
              </button>
            )}
          </div>
        </div>

        {/* Search */}
        {searchable && !collapsed && (
          <div className="px-3 py-2 border-b border-gray-100">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search navigation…"
                className="h-7 pl-7 text-xs bg-gray-50 border-gray-200"
              />
            </div>
          </div>
        )}

        {preNav}

        {/* Nav */}
        <nav className={v.nav}>
          {filtered.map((section, si) => (
            <div key={section.title ?? si} className={cn(section.title && v.sectionWrap)}>
              {section.title && !collapsed && (
                <p className={v.sectionTitle}>{section.title}</p>
              )}
              <div className={v.itemsWrap}>
                {section.items.map((item) => {
                  const Icon = item.icon;

                  if (item.children) {
                    const expanded    = expandedGroups.has(item.label);
                    const groupActive = item.children.some((c) => isActive(c.href));
                    return (
                      <div key={item.label}>
                        <button
                          type="button"
                          onClick={() => toggleGroup(item.label)}
                          title={collapsed ? item.label : undefined}
                          aria-expanded={expanded}
                          className={cn(
                            v.link, 'w-full',
                            groupActive ? v.linkActive : v.linkInactive,
                            collapsed && 'justify-center',
                          )}
                        >
                          <Icon size={v.iconSize} className={cn(groupActive ? v.iconActive : v.iconInactive)} />
                          {!collapsed && <span className="flex-1 truncate text-left">{item.label}</span>}
                          {!collapsed && (
                            <ChevronDown
                              size={14}
                              className={cn('shrink-0 transition-transform', expanded && 'rotate-180')}
                            />
                          )}
                        </button>
                        {expanded && !collapsed && (
                          <div className={cn('ml-4 mt-0.5 space-y-0.5 border-l pl-3', v.subGroupBorder)}>
                            {item.children.map((child) => {
                              const ChildIcon   = child.icon;
                              const childActive = isActive(child.href);
                              return (
                                <Link
                                  key={child.href}
                                  href={child.href}
                                  onClick={onClose}
                                  className={cn(
                                    v.link,
                                    childActive ? v.linkActive : v.linkInactive,
                                  )}
                                >
                                  <ChildIcon size={v.iconSize - 2} className={cn(childActive ? v.iconActive : v.iconInactive)} />
                                  <span className="flex-1 truncate">{child.label}</span>
                                </Link>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  }

                  const active = isActive(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onClose}
                      title={collapsed ? item.label : undefined}
                      className={cn(
                        v.link,
                        active ? v.linkActive : v.linkInactive,
                        collapsed && 'justify-center',
                      )}
                    >
                      <Icon size={v.iconSize} className={cn(active ? v.iconActive : v.iconInactive)} />
                      {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                      {!collapsed && item.badge != null && item.badge > 0 && (
                        <span className="ml-auto text-[10px] font-semibold bg-red-100 text-red-600 rounded-full px-1.5 py-0.5 leading-none">
                          {item.badge}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className={cn(v.footer, collapsed && v.footerCollapsed)}>
          {footer?.(collapsed)}
          <button
            type="button"
            onClick={handleLogout}
            title={collapsed ? 'Sign out' : undefined}
            className={cn(v.signOut, collapsed && 'justify-center')}
          >
            <LogOut size={v.signOutIcon} />
            {!collapsed && <span>Sign out</span>}
          </button>
        </div>
      </aside>
    </>
  );
}
