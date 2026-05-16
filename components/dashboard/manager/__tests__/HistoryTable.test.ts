import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// HistoryTable — buildCleanupBanner helper (Part 3 cleanup verification)
// ---------------------------------------------------------------------------

import { buildCleanupBanner } from "../cleanupBanner";
import { getHandlerStatus } from "../HistoryTable";

describe("buildCleanupBanner", () => {
  it("returns skipped variant when data.skipped is true", () => {
    const result = buildCleanupBanner({
      skipped: true,
      reason: "Retention disabled",
    });
    expect(result.variant).toBe("skipped");
    expect(result.message).toContain("Retention disabled");
    expect(result.isSkipped).toBe(true);
  });

  it("uses fallback reason text when reason is missing", () => {
    const result = buildCleanupBanner({ skipped: true });
    expect(result.variant).toBe("skipped");
    expect(result.message).toContain("Retention disabled");
  });

  it("returns success variant when sessions were deleted", () => {
    const result = buildCleanupBanner({
      deletedSessions: 3,
      deletedMessages: 12,
    });
    expect(result.variant).toBe("success");
    expect(result.message).toContain("3 session");
    expect(result.message).toContain("12 message");
  });

  it("returns empty variant when nothing was deleted", () => {
    const result = buildCleanupBanner({
      deletedSessions: 0,
      deletedMessages: 0,
    });
    expect(result.variant).toBe("empty");
    expect(result.message).toContain("Nothing deleted");
  });

  it("returns error variant when errorMsg is provided", () => {
    const result = buildCleanupBanner({}, "HTTP 500");
    expect(result.variant).toBe("error");
    expect(result.message).toBe("HTTP 500");
  });

  it("error variant takes precedence over any data fields", () => {
    const result = buildCleanupBanner(
      { deletedSessions: 5, deletedMessages: 20 },
      "Something broke"
    );
    expect(result.variant).toBe("error");
    expect(result.message).toBe("Something broke");
  });
});

// ---------------------------------------------------------------------------
// getHandlerStatus — handler derivation logic
// ---------------------------------------------------------------------------

describe("getHandlerStatus", () => {
  it("returns Human when humanInvolved=true and aiMessageCount=0", () => {
    expect(getHandlerStatus(0, true)).toBe("Human");
  });

  it("returns Mixed when humanInvolved=true and aiMessageCount>0", () => {
    expect(getHandlerStatus(5, true)).toBe("Mixed");
  });

  it("returns AI when humanInvolved=false and aiMessageCount>0", () => {
    expect(getHandlerStatus(5, false)).toBe("AI");
  });

  it("returns AI when humanInvolved=false and aiMessageCount=0", () => {
    expect(getHandlerStatus(0, false)).toBe("AI");
  });
});
