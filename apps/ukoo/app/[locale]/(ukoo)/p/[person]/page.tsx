'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

interface PersonData {
  id: string;
  displayName: string;
  sex: 'male' | 'female' | 'other';
  birthFuzzy?: { year: number; precision: string };
  deathFuzzy?: { year: number; precision: string };
  privacy: string;
}

export default function PersonPage() {
  const params = useParams();
  const personId = params.person as string;
  const [person, setPerson] = useState<PersonData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'story' | 'timeline' | 'photos' | 'memories' | 'family'>('story');

  useEffect(() => {
    async function fetchPerson() {
      try {
        const res = await fetch(`/api/ukoo/persons/${personId}`);
        const data = await res.json();
        setPerson(data);
      } catch (err) {
        console.error('Failed to fetch person:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchPerson();
  }, [personId]);

  if (loading) return <div className="p-4">Loading...</div>;
  if (!person) return <div className="p-4">Person not found</div>;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-4xl font-bold">{person.displayName}</h1>
        <p className="text-gray-600 mt-2">
          {person.birthFuzzy?.year}
          {person.deathFuzzy?.year && ` – ${person.deathFuzzy.year}`}
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-4 border-b mb-6">
        {(['story', 'timeline', 'photos', 'memories', 'family'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 ${
              tab === t
                ? 'border-b-2 border-blue-500 text-blue-600 font-semibold'
                : 'text-gray-600'
            }`}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="min-h-96">
        {tab === 'story' && (
          <div>
            <h2 className="text-2xl font-bold mb-4">Story</h2>
            <p className="text-gray-600">No story recorded yet.</p>
          </div>
        )}

        {tab === 'timeline' && (
          <div>
            <h2 className="text-2xl font-bold mb-4">Timeline</h2>
            <p className="text-gray-600">No life events recorded yet.</p>
          </div>
        )}

        {tab === 'photos' && (
          <div>
            <h2 className="text-2xl font-bold mb-4">Photos</h2>
            <p className="text-gray-600">No photos recorded yet.</p>
          </div>
        )}

        {tab === 'memories' && (
          <div>
            <h2 className="text-2xl font-bold mb-4">Memories</h2>
            <p className="text-gray-600">No memories recorded yet.</p>
          </div>
        )}

        {tab === 'family' && (
          <div>
            <h2 className="text-2xl font-bold mb-4">Family</h2>
            <p className="text-gray-600">Family relationships coming soon.</p>
          </div>
        )}
      </div>
    </div>
  );
}
