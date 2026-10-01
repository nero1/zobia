import { deriveNotificationActionUrl } from "../actionRoute";

describe("classroom event notification routes", () => {
  it("recording added opens the Events tab on the session", () => {
    expect(
      deriveNotificationActionUrl("classroom_recording_added", { classroomSlug: "math-101", eventId: "e1" })
    ).toBe("/c/math-101?tab=events&event=e1");
  });
  it("falls back to the classroom when there is no event id", () => {
    expect(deriveNotificationActionUrl("classroom_event_scheduled", { classroomSlug: "math-101" })).toBe(
      "/c/math-101?tab=events"
    );
  });
});
