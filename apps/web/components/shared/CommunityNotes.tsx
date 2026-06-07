/**
 * components/shared/CommunityNotes.tsx
 *
 * Display approved community notes on messages (Wikipedia-style).
 * Shows notes added by community members to provide context or corrections.
 */

import React, { useState } from 'react';

export interface CommunityNote {
  id: string;
  content: string;
  author_name: string;
  helpful_votes: number;
  not_helpful_votes: number;
}

interface CommunityNotesProps {
  notes: CommunityNote[];
  messageId: string;
  onVote?: (noteId: string, helpful: boolean) => void;
}

export function CommunityNotes({ notes, messageId, onVote }: CommunityNotesProps) {
  const [userVotes, setUserVotes] = useState<Record<string, boolean | null>>({});

  if (!notes || notes.length === 0) {
    return null;
  }

  const handleVote = (noteId: string, helpful: boolean) => {
    const currentVote = userVotes[noteId];
    const newVote = currentVote === helpful ? null : helpful;
    setUserVotes((prev) => ({ ...prev, [noteId]: newVote }));
    onVote?.(noteId, helpful);
  };

  return (
    <div className="mt-4 space-y-3 border-l-4 border-blue-500 pl-4 py-2">
      <div className="text-sm font-semibold text-blue-700">Community Notes</div>
      {notes.map((note) => {
        const userVote = userVotes[note.id];
        return (
          <div key={note.id} className="text-sm bg-blue-50 p-3 rounded">
            <p className="text-gray-800 mb-2">{note.content}</p>
            <div className="flex items-center justify-between text-xs text-gray-600">
              <span>Added by {note.author_name}</span>
              <div className="flex gap-3">
                <button
                  onClick={() => handleVote(note.id, true)}
                  className={`flex items-center gap-1 px-2 py-1 rounded transition ${
                    userVote === true
                      ? 'bg-blue-200 text-blue-700'
                      : 'hover:bg-gray-200 text-gray-600'
                  }`}
                >
                  👍 {note.helpful_votes}
                </button>
                <button
                  onClick={() => handleVote(note.id, false)}
                  className={`flex items-center gap-1 px-2 py-1 rounded transition ${
                    userVote === false
                      ? 'bg-blue-200 text-blue-700'
                      : 'hover:bg-gray-200 text-gray-600'
                  }`}
                >
                  👎 {note.not_helpful_votes}
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
