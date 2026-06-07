/**
 * app/(admin)/admin/community-notes/page.tsx
 *
 * Community Notes moderation interface for approving/rejecting community-added notes on flagged messages.
 */

'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { apiClient } from '@/lib/api/client';

interface CommunityNote {
  id: string;
  message_id: string;
  author_id: string;
  content: string;
  status: 'pending' | 'approved' | 'rejected';
  helpful_votes: number;
  not_helpful_votes: number;
  created_at: string;
  message?: {
    id: string;
    content: string;
    sender: string;
  };
}

type FilterStatus = 'all' | 'pending' | 'approved' | 'rejected';

export default function CommunityNotesModeration() {
  const queryClient = useQueryClient();
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('pending');

  const { data: notes = [], isLoading } = useQuery({
    queryKey: ['community-notes', filterStatus],
    queryFn: async () => {
      const { data } = await apiClient.get('/api/admin/community-notes', {
        params: { status: filterStatus === 'all' ? undefined : filterStatus },
      });
      return data.notes as CommunityNote[];
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (noteId: string) => {
      await apiClient.post(`/api/admin/community-notes/${noteId}/approve`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['community-notes'] });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async (noteId: string) => {
      await apiClient.post(`/api/admin/community-notes/${noteId}/reject`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['community-notes'] });
    },
  });

  const getStatusBadge = (status: string) => {
    const classes: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-800',
      approved: 'bg-green-100 text-green-800',
      rejected: 'bg-red-100 text-red-800',
    };
    return classes[status] || classes.pending;
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-3xl font-bold mb-8">Community Notes Moderation</h1>

      {/* Filter Tabs */}
      <div className="flex gap-2 mb-8">
        {(['all', 'pending', 'approved', 'rejected'] as FilterStatus[]).map((status) => (
          <button
            key={status}
            onClick={() => setFilterStatus(status)}
            className={`px-4 py-2 rounded-lg font-semibold transition ${
              filterStatus === status
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
            }`}
          >
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </button>
        ))}
      </div>

      {/* Notes List */}
      {isLoading ? (
        <div className="text-center">Loading notes...</div>
      ) : notes.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-gray-600">No {filterStatus === 'all' ? 'community' : filterStatus} notes found.</p>
        </Card>
      ) : (
        <div className="space-y-6">
          {notes.map((note) => (
            <Card key={note.id} className="p-6">
              {/* Original Message */}
              {note.message && (
                <div className="mb-6 p-4 bg-gray-100 rounded-lg">
                  <p className="text-sm text-gray-600 mb-2">Original message from {note.message.sender}:</p>
                  <p className="text-gray-800">{note.message.content}</p>
                </div>
              )}

              {/* Community Note */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-semibold">Community Note</h3>
                  <span className={`px-3 py-1 rounded-full text-sm font-semibold ${getStatusBadge(note.status)}`}>
                    {note.status.toUpperCase()}
                  </span>
                </div>
                <p className="text-gray-800 mb-4">{note.content}</p>

                {/* Vote Stats */}
                <div className="flex gap-6 mb-4 text-sm text-gray-600">
                  <div>👍 {note.helpful_votes} found helpful</div>
                  <div>👎 {note.not_helpful_votes} found not helpful</div>
                  <div>Added {new Date(note.created_at).toLocaleDateString()}</div>
                </div>
              </div>

              {/* Actions */}
              {note.status === 'pending' && (
                <div className="flex gap-3 justify-end">
                  <Button
                    variant="secondary"
                    onClick={() => rejectMutation.mutate(note.id)}
                    disabled={rejectMutation.isPending}
                  >
                    Reject
                  </Button>
                  <Button
                    onClick={() => approveMutation.mutate(note.id)}
                    disabled={approveMutation.isPending}
                    className="bg-green-600 text-white hover:bg-green-700"
                  >
                    Approve
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
