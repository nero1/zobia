"use client";

/**
 * components/moderation/CommunityNote.tsx
 *
 * Displays a community note with thumbs up/down vote buttons and counts.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Note {
  id: string;
  content: string;
  author_id: string;
  helpful_votes: number;
  unhelpful_votes: number;
  status: "pending" | "shown" | "hidden";
}

interface CommunityNoteProps {
  note: Note;
  onVote: (noteId: string, helpful: boolean) => void;
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

const STATUS_CLASSES: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  shown: "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300",
  hidden: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * CommunityNote — displays a community note with helpful/unhelpful voting.
 */
export function CommunityNote({ note, onVote, disabled = false }: CommunityNoteProps) {
  const totalVotes = note.helpful_votes + note.unhelpful_votes;
  const helpfulPct = totalVotes > 0 ? Math.round((note.helpful_votes / totalVotes) * 100) : null;

  return (
    <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800/40">
      {/* Header */}
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
            Community Note
          </span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${STATUS_CLASSES[note.status] ?? STATUS_CLASSES.pending}`}>
            {note.status}
          </span>
        </div>
        {helpfulPct !== null && (
          <span className={`text-xs font-semibold ${helpfulPct >= 50 ? "text-teal-600 dark:text-teal-400" : "text-red-600 dark:text-red-400"}`}>
            {helpfulPct}% helpful
          </span>
        )}
      </div>

      {/* Content */}
      <p className="mb-4 text-sm leading-relaxed text-neutral-800 dark:text-neutral-200">{note.content}</p>

      {/* Vote row */}
      <div className="flex items-center gap-3">
        {/* Thumbs up */}
        <button
          onClick={() => onVote(note.id, true)}
          disabled={disabled}
          className="flex items-center gap-1.5 rounded-xl border border-neutral-200 bg-white px-3 py-1.5 text-sm font-semibold text-neutral-700 transition-colors hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:border-teal-700 dark:hover:bg-teal-950/30 dark:hover:text-teal-300"
          aria-label="Mark as helpful"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" />
          </svg>
          <span>{note.helpful_votes.toLocaleString()}</span>
        </button>

        {/* Thumbs down */}
        <button
          onClick={() => onVote(note.id, false)}
          disabled={disabled}
          className="flex items-center gap-1.5 rounded-xl border border-neutral-200 bg-white px-3 py-1.5 text-sm font-semibold text-neutral-700 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:border-red-800 dark:hover:bg-red-950/30 dark:hover:text-red-400"
          aria-label="Mark as unhelpful"
        >
          <svg className="h-4 w-4 rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" />
          </svg>
          <span>{note.unhelpful_votes.toLocaleString()}</span>
        </button>

        {/* Total */}
        {totalVotes > 0 && (
          <span className="ml-1 text-xs text-neutral-400">{totalVotes.toLocaleString()} votes total</span>
        )}
      </div>
    </div>
  );
}
