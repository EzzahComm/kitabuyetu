'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

interface PresenceUser {
  userId: string;
  displayName: string;
  section?: string;
  status: 'viewing' | 'editing';
}

interface PresenceAvatarsProps {
  pageId: string;
  currentUserId: string;
  currentSection?: string;
}

export default function PresenceAvatars({ pageId, currentUserId, currentSection }: PresenceAvatarsProps) {
  const [presenceUsers, setPresenceUsers] = useState<PresenceUser[]>([]);

  useEffect(() => {
    const supabaseUrl = process.env.NEXT_PUBLIC_UKOO_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_UKOO_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) return;

    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    // Subscribe to presence channel
    const channel = supabase.channel(`page:${pageId}`, {
      config: {
        broadcast: { self: true },
        presence: { key: currentUserId },
      },
    });

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const users: PresenceUser[] = [];
        Object.entries(state).forEach(([_, presences]) => {
          if (Array.isArray(presences)) {
            presences.forEach((presence: any) => {
              if (presence.userId !== currentUserId) {
                users.push({
                  userId: presence.userId,
                  displayName: presence.displayName || 'Anonymous',
                  section: presence.section,
                  status: presence.editing ? 'editing' : 'viewing',
                });
              }
            });
          }
        });
        setPresenceUsers(users);
      })
      .on('presence', { event: 'join' }, ({ newPresences }) => {
        console.log('User joined:', newPresences);
      })
      .on('presence', { event: 'leave' }, ({ leftPresences }) => {
        console.log('User left:', leftPresences);
      })
      .subscribe(async status => {
        if (status === 'SUBSCRIBED') {
          // Broadcast current user's presence
          await channel.track({
            userId: currentUserId,
            displayName: 'You',
            section: currentSection,
            editing: true,
            timestamp: new Date().toISOString(),
          });
        }
      });

    return () => {
      channel.unsubscribe();
    };
  }, [pageId, currentUserId, currentSection]);

  if (presenceUsers.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 text-sm text-gray-600">
      <span>Editing:</span>
      {presenceUsers.map(user => (
        <div key={user.userId} className="flex items-center gap-1">
          <div className="w-6 h-6 rounded-full bg-blue-300 flex items-center justify-center text-xs font-bold">
            {user.displayName.charAt(0).toUpperCase()}
          </div>
          <span>{user.displayName}</span>
          {user.section && <span className="text-xs text-gray-500">({user.section})</span>}
        </div>
      ))}
    </div>
  );
}
