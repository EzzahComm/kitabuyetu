'use client';

import { useCallback, useState } from 'react';
import { validateTiptapContent, type TiptapNode } from '@ukoo/core/util/tiptap-validator';

interface WikiEditorProps {
  personId: string;
  pageId: string;
  initialContent?: TiptapNode;
  onSave?: (content: TiptapNode, summary: string) => Promise<void>;
}

export default function WikiEditor({ personId, pageId, initialContent, onSave }: WikiEditorProps) {
  const [content, setContent] = useState<TiptapNode | null>(initialContent || null);
  const [summary, setSummary] = useState('');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [showDraft, setShowDraft] = useState(false);

  const handleContentChange = useCallback(
    (newContent: TiptapNode) => {
      setContent(newContent);
      // Validate as user types
      const validationErrors = validateTiptapContent(newContent);
      setErrors(validationErrors.map(e => e.message));
    },
    []
  );

  const handleSave = useCallback(async () => {
    if (!content) {
      setErrors(['Content is empty']);
      return;
    }

    const validationErrors = validateTiptapContent(content);
    if (validationErrors.length > 0) {
      setErrors(validationErrors.map(e => e.message));
      return;
    }

    setSaving(true);
    try {
      if (onSave) {
        await onSave(content, summary);
      }
      setSummary('');
      setShowDraft(false);
    } catch (err) {
      setErrors([String(err)]);
    } finally {
      setSaving(false);
    }
  }, [content, summary, onSave]);

  return (
    <div className="p-4 border rounded">
      <h2 className="text-xl font-bold mb-4">Edit Biography</h2>

      {/* Draft Indicator */}
      {showDraft && (
        <div className="mb-4 p-3 bg-yellow-100 border border-yellow-300 rounded text-sm">
          💾 Draft saved to browser. Not yet published.
        </div>
      )}

      {/* Error Messages */}
      {errors.length > 0 && (
        <div className="mb-4 p-3 bg-red-100 border border-red-300 rounded">
          {errors.map((err, i) => (
            <div key={i} className="text-sm text-red-700">
              {err}
            </div>
          ))}
        </div>
      )}

      {/* Editor */}
      <div className="mb-4 p-4 border rounded bg-gray-50 min-h-64">
        <div className="text-sm text-gray-600 mb-2">
          Allowed: paragraphs, headings (h2-h3), bold, italic, links, lists, blockquotes, person links, citations
        </div>
        <textarea
          className="w-full h-48 p-2 font-mono text-sm border rounded"
          value={JSON.stringify(content, null, 2)}
          onChange={(e) => {
            try {
              const parsed = JSON.parse(e.target.value);
              handleContentChange(parsed);
            } catch (err) {
              // Parse error, let user correct it
            }
          }}
          placeholder="Paste Tiptap JSON here (Phase 2 adds visual editor)"
        />
      </div>

      {/* Summary */}
      <div className="mb-4">
        <label className="block text-sm font-medium mb-2">Summary (optional)</label>
        <input
          type="text"
          className="w-full p-2 border rounded"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="What did you change?"
        />
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={saving || errors.length > 0}
          className="px-4 py-2 bg-blue-500 text-white rounded disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Revision'}
        </button>
        <button
          onClick={() => setShowDraft(true)}
          className="px-4 py-2 bg-gray-300 rounded"
        >
          Save Draft (Local)
        </button>
      </div>
    </div>
  );
}
