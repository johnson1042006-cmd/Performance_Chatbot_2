export const KINDS = [
  {
    value: "queue_depth",
    label: "Queue depth",
    description: "Notify when too many customers are waiting for an agent",
    unit: "customers waiting",
  },
  {
    value: "ai_failure_rate_pct",
    label: "AI failure rate (%)",
    description: "Notify when the AI is failing to answer too often",
    unit: "% of AI replies failing",
  },
  {
    value: "no_agents_online_during_hours",
    label: "No agents online during hours",
    description: "Notify when no agents are online during business hours",
    unit: null,
  },
] as const;
