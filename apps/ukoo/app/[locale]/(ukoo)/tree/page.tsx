'use client';

import { useSearchParams } from 'next/navigation';
import { useState, useEffect } from 'react';
import TreeCanvas from '@/components/ukoo/TreeCanvas';
import TreeList from '@/components/ukoo/TreeList';

export default function TreePage() {
  const searchParams = useSearchParams();
  const focusPersonId = searchParams.get('focus') || 'default';
  const [viewMode, setViewMode] = useState<'canvas' | 'list'>('canvas');
  const [spaceId, setSpaceId] = useState<string | null>(null);

  useEffect(() => {
    // TODO: Get current space from context/session
    // For now, stub with hardcoded space
    setSpaceId('stub-space-id');
  }, []);

  if (!spaceId) {
    return <div className="p-4">Loading...</div>;
  }

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Family Tree</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setViewMode('canvas')}
            className={`px-4 py-2 rounded ${viewMode === 'canvas' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
          >
            Canvas View
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`px-4 py-2 rounded ${viewMode === 'list' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
          >
            List View
          </button>
        </div>
      </div>

      {viewMode === 'canvas' ? (
        <TreeCanvas spaceId={spaceId} focusPersonId={focusPersonId} />
      ) : (
        <TreeList spaceId={spaceId} focusPersonId={focusPersonId} />
      )}
    </div>
  );
}
