'use client';

import type { ReactNode } from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/lib/utils';

export interface TabItem {
  value: string;
  label: ReactNode;
  /** Server-rendered panel. Every panel stays in the HTML (forceMount), hidden until selected. */
  content: ReactNode;
}

interface TabsProps {
  tabs: TabItem[];
  /** Accessible name for the tab list. */
  label: string;
  className?: string;
}

const panelClass =
  'data-[state=inactive]:hidden focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-4 motion-safe:data-[state=active]:animate-fade-up';

/**
 * Finanza's service tabs (`.service .nav-pills`): a column of bordered buttons
 * that fill primary when selected, beside the selected panel.
 */
export function ServiceTabs({ tabs, label, className }: TabsProps) {
  return (
    <TabsPrimitive.Root
      defaultValue={tabs[0]?.value}
      orientation="vertical"
      className={cn('grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]', className)}
    >
      <TabsPrimitive.List aria-label={label} className="flex flex-col gap-4">
        {tabs.map((tab) => (
          <TabsPrimitive.Trigger
            key={tab.value}
            value={tab.value}
            className="group flex w-full items-center rounded-lg border border-brand-100 bg-white p-5 text-left font-display text-lg font-semibold text-finanza-dark transition-colors duration-500 hover:border-brand-500 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 data-[state=active]:border-brand-500 data-[state=active]:bg-brand-500 data-[state=active]:text-white lg:p-6"
          >
            {tab.label}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      <div>
        {tabs.map((tab) => (
          <TabsPrimitive.Content key={tab.value} value={tab.value} forceMount className={panelClass}>
            {tab.content}
          </TabsPrimitive.Content>
        ))}
      </div>
    </TabsPrimitive.Root>
  );
}

/** Finanza's About tabs (`.nav-tabs` inside a bordered box): Story / Mission / Vision. */
export function StoryTabs({ tabs, label, className }: TabsProps) {
  return (
    <TabsPrimitive.Root
      defaultValue={tabs[0]?.value}
      className={cn('rounded-lg border border-brand-100 p-5 sm:p-6', className)}
    >
      <TabsPrimitive.List aria-label={label} className="mb-4 flex flex-wrap border-b border-brand-100">
        {tabs.map((tab) => (
          <TabsPrimitive.Trigger
            key={tab.value}
            value={tab.value}
            className="-mb-px rounded-t-lg border border-transparent px-4 py-2 font-medium text-brand-500 transition-colors hover:text-brand-700 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 data-[state=active]:border-brand-100 data-[state=active]:border-b-white data-[state=active]:bg-white data-[state=active]:text-finanza-dark"
          >
            {tab.label}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {tabs.map((tab) => (
        <TabsPrimitive.Content
          key={tab.value}
          value={tab.value}
          forceMount
          className={cn(panelClass, 'space-y-3 leading-relaxed text-finanza-text')}
        >
          {tab.content}
        </TabsPrimitive.Content>
      ))}
    </TabsPrimitive.Root>
  );
}
