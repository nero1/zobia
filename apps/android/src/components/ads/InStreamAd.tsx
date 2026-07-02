/**
 * apps/android/src/components/ads/InStreamAd.tsx
 *
 * Mirrors apps/web/components/ads/InStreamAd.tsx — native ad interleaved
 * into a free Room's message stream (PRD §17 Pillar 3 — "in free rooms, ads
 * show after every 10 messages, inside the message stream"). Thin wrapper
 * around AdSlot styled to sit inline between message bubbles. Paid-plan
 * Rooms never mount this — see routes/rooms/$roomId.tsx, gated on
 * `room.type === "free_open"`.
 */

import AdSlot from './AdSlot';

export default function InStreamAd() {
  return (
    <div className="my-1">
      <AdSlot placement="room_instream" className="!min-h-[64px]" />
    </div>
  );
}
