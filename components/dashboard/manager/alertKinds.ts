export const KINDS = [
  {
    value: "queue_depth",
    label: "Queue depth",
    description: "Notify when too many customers are waiting for an agent",
    unit: "customers waiting",
    fixedComparator: ">=",
    sentence: {
      before: "Notify me when more than",
      after: "customers are waiting in the queue",
    },
    frequencyLabel: "Remind me at most:",
    hideNumber: false,
    lockedThreshold: null,
  },
  {
    value: "ai_failure_rate_pct",
    label: "AI failure rate (%)",
    description: "Notify when the AI is failing to answer too often",
    unit: "% of AI replies failing",
    fixedComparator: ">=",
    sentence: {
      before: "Notify me when more than",
      after: "% of AI replies are failing",
    },
    frequencyLabel: "Remind me at most:",
    hideNumber: false,
    lockedThreshold: null,
  },
  {
    value: "no_agents_online_during_hours",
    label: "No agents online during hours",
    description: "Notify when no agents are online during business hours",
    unit: null,
    fixedComparator: ">=",
    sentence: {
      before: "Notify me when no agents are online during business hours",
      after: "",
    },
    frequencyLabel: "Remind me at most:",
    hideNumber: true,
    lockedThreshold: 1,
  },
] as const;
