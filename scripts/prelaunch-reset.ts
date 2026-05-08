import "dotenv/config";
import { db } from "@/lib/db";
import { knowledgeBase } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

async function main() {
  const settings = {
    aiEnabled: true,
    fallbackTimerSeconds: 60,
    historyRetentionMonths: 12,
    autoOpenOnFirstVisit: true,
    // Stored for operational consistency; consumers may be added post-launch.
    alertRetentionDays: 90,
    autoTicketOnEscalation: true,
  };

  await db
    .insert(knowledgeBase)
    .values({
      topic: "bot_settings",
      content: JSON.stringify(settings),
    })
    .onConflictDoUpdate({
      target: knowledgeBase.topic,
      set: {
        content: JSON.stringify(settings),
        updatedAt: new Date(),
      },
    });

  // eslint-disable-next-line no-console
  console.log("Updated bot_settings:", settings);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });

