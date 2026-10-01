'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import WikiEditor from '@/components/ukoo/WikiEditor';
import PresenceAvatars from '@/components/ukoo/PresenceAvatars';
import type { TiptapNode } from '@ukoo/core/util/tiptap-validator';

interface PageRecord {
  id: string;
  personId: string;
  bioMode: string;
  headRevId?: string;
  page_revision?: Array<{ id: string; content: TiptapNode }>;
}

export default function StoryEditPage() {
  const params = useParams();
  const personId = params.person as string;
  const [page, setPage] = useState<PageRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function fetchPage() {
      try {
        const res = await fetch(`/api/ukoo/pages?page_id=${personId}`);
        const data = await res.json();
        setPage(data.page);
      } catch (err) {
        console.error('Failed to fetch page:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchPage();
  }, [personId]);

  async function handleSave(content: TiptapNode, summary: string) {
    setSaving(true);
    try {
      const res = await fetch('/api/ukoo/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pageId: page?.id || personId,
          baseRevId: page?.headRevId,
          content,
          summary,
          createdBy: 'current-user-id', // TODO: Get from session
        }),
      });

      const data = await res.json();

      if (res.status === 409) {
        // Stale base: show conflict resolution UI
        console.error('Stale base conflict:', data);
        alert('Your changes conflict with recent edits. Please refresh and try again.');
      } else if (res.ok) {
        alert('Revision saved successfully');
        // Optionally refresh page
      } else {
        alert(`Error: ${data.error}`);
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="p-4">Loading...</div>;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Edit Biography</h1>
        {page && <PresenceAvatars pageId={page.id} currentUserId="current-user" currentSection="story" />}
      </div>

      {page && (
        <WikiEditor
          personId={personId}
          pageId={page.id}
          initialContent={page.page_revision?.[0]?.content}
          onSave={handleSave}
        />
      )}

      <div className="mt-6 p-4 bg-blue-50 rounded text-sm text-blue-800">
        <h3 className="font-semibold mb-2">About this editor (Phase 2)</h3>
        <ul className="list-disc list-inside space-y-1">
          <li>Allowed: paragraphs, h2-h3 headings, bold, italic, links, lists, blockquotes</li>
          <li>Person links: <code>[[@person-id]]</code></li>
          <li>Citations: link sources to relationships or events</li>
          <li>Stale base handling: conflict resolution for concurrent edits (see spec §6.2)</li>
          <li>Phase 3+: Tiptap visual editor, diff/merge UI</li>
        </ul>
      </div>
    </div>
  );
}
