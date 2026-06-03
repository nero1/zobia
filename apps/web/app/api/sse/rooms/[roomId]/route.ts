/**
 * app/api/sse/rooms/[roomId]/route.ts
 *
 * Canonical SSE path per PRD §22: GET /api/sse/rooms/:roomId
 *
 * This is an alias that re-exports the handler from the primary SSE
 * implementation at /api/rooms/[roomId]/stream.
 *
 * Both paths are equivalent. Client code should use this canonical path.
 */

export { GET } from "@/app/api/rooms/[roomId]/stream/route";
