/**
 * components/ads/adEventQueue.ts
 *
 * Offline-friendly, batched impression/click reporting for the ad system
 * (PRD §17 Pillar 3). Events are queued in localStorage (so a flush is never
 * lost across reloads or brief network drops) and flushed in small batches
 * to POST /api/ads/events — this keeps ad tracking to a couple of requests
 * per session instead of one per impression.
 */

const QUEUE_KEY = "zobia_ad_event_queue_v1";
const MAX_BATCH = 20;
const FLUSH_DEBOUNCE_MS = 2500;

export interface QueuedAdEvent {
  receipt: string;
  creativeId: string;
  placementKey: string;
  type: "impression" | "click";
  clientEventId: string;
}

function readQueue(): QueuedAdEvent[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedAdEvent[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(events: QueuedAdEvent[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(events.slice(0, MAX_BATCH * 4)));
  } catch {
    /* localStorage unavailable/full — drop silently, non-critical telemetry */
  }
}

let flushing = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

export function enqueueAdEvent(event: Omit<QueuedAdEvent, "clientEventId">): void {
  if (typeof window === "undefined") return;
  const clientEventId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const queue = readQueue();
  queue.push({ ...event, clientEventId });
  writeQueue(queue);

  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => void flushAdEventQueue(), FLUSH_DEBOUNCE_MS);
}

export async function flushAdEventQueue(useBeacon = false): Promise<void> {
  if (typeof window === "undefined" || flushing) return;
  const batch = readQueue().filter(event=>typeof event.receipt==='string').slice(0,MAX_BATCH);
  if (!batch.length) { writeQueue([]);return; }
  if (useBeacon && navigator.sendBeacon) {
    // A beacon has no delivery acknowledgment. Keep stable IDs for a later retry.
    navigator.sendBeacon("/api/ads/events",new Blob([JSON.stringify({events:batch})],{type:"application/json"}));
    return;
  }
  flushing=true;
  try {
    const res=await fetch("/api/ads/events",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({events:batch})});
    if(res.ok) {
      const json=await res.json();
      const outcomes=json.data?.outcomes as Array<{clientEventId:string;status:string}>|undefined;
      if(!Array.isArray(outcomes)) return;
      const acknowledged=new Set(outcomes.filter(o=>["committed","duplicate","rejected"].includes(o.status)).map(o=>o.clientEventId));
      // Re-read so enqueues during the request are preserved.
      writeQueue(readQueue().filter(e=>!acknowledged.has(e.clientEventId)));
      if(readQueue().length) flushTimer=setTimeout(()=>void flushAdEventQueue(),FLUSH_DEBOUNCE_MS);
    }
  } catch { /* Keep unacknowledged events for retry. */ }
  finally {flushing=false;}
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => void flushAdEventQueue(true));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushAdEventQueue(true);
  });
  window.addEventListener("online", () => void flushAdEventQueue());
}
