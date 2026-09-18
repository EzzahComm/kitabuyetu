'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface Donor {
  id: string;
  name: string;
  total_donated: number;
  donation_count: number;
  profile_image_url?: string;
  is_verified: boolean;
}

interface DonorLeaderboardProps {
  organizationId: string;
  limit?: number;
}

export function DonorLeaderboard({ organizationId, limit = 10 }: DonorLeaderboardProps) {
  const [donors, setDonors] = useState<Donor[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDonors = async () => {
      try {
        const response = await fetch(`/api/v1/donors?orgId=${organizationId}&limit=${limit}`);
        if (response.ok) {
          const { donors } = await response.json();
          setDonors(donors);
        }
      } catch (error) {
        console.error('Failed to fetch donors:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchDonors();
  }, [organizationId, limit]);

  if (loading) {
    return <div className="text-center py-8">Loading donors...</div>;
  }

  if (donors.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-gray-500">
          No donors yet. Be the first to support this program!
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Top Supporters</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {donors.map((donor, index) => (
            <div
              key={donor.id}
              className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition"
            >
              <div className="flex items-center gap-4 flex-1">
                <div className="flex-shrink-0 w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-bold">
                  {index + 1}
                </div>

                {donor.profile_image_url ? (
                  <Image
                    src={donor.profile_image_url}
                    alt={donor.name}
                    width={40}
                    height={40}
                    className="w-10 h-10 rounded-full"
                  />
                ) : (
                  <div className="w-10 h-10 bg-gray-300 rounded-full" />
                )}

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-gray-900 truncate">{donor.name}</p>
                    {donor.is_verified && (
                      <Badge variant="secondary" className="text-xs">
                        Verified
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-gray-500">{donor.donation_count} donation{donor.donation_count !== 1 ? 's' : ''}</p>
                </div>
              </div>

              <div className="text-right flex-shrink-0">
                <p className="font-bold text-green-600">KES {donor.total_donated.toLocaleString()}</p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
