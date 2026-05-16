export type CleanupBannerVariant = "skipped" | "success" | "empty" | "error";

export interface CleanupBanner {
  variant: CleanupBannerVariant;
  message: string;
  isSkipped?: boolean;
}

export interface CleanupApiResponse {
  skipped?: boolean;
  reason?: string;
  deletedSessions?: number;
  deletedMessages?: number;
  error?: string;
}

export function buildCleanupBanner(
  data: CleanupApiResponse,
  errorMsg?: string
): CleanupBanner {
  if (errorMsg !== undefined) {
    return { variant: "error", message: errorMsg };
  }
  if (data.skipped) {
    return {
      variant: "skipped",
      message: `Cleanup skipped: ${data.reason ?? "Retention disabled"}.`,
      isSkipped: true,
    };
  }
  const sessions = data.deletedSessions ?? 0;
  const messages = data.deletedMessages ?? 0;
  if (sessions > 0 || messages > 0) {
    return {
      variant: "success",
      message: `Deleted ${sessions} session${sessions !== 1 ? "s" : ""} and ${messages} message${messages !== 1 ? "s" : ""}.`,
    };
  }
  return {
    variant: "empty",
    message: "No sessions met the retention cutoff. Nothing deleted.",
  };
}
