import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { knowledgeBase } from "../db/schema";

const entries = [
  {
    topic: "return_policy",
    content: `Performance Cycle Return Policy:

- Items may be returned within 30 days of purchase for a full refund.
- Items must be in original, unused condition with all tags attached.
- Helmets that have been worn or had the visor removed cannot be returned for safety reasons.
- E-bike batteries and electrical components are non-returnable once opened.
- Clearance and final sale items are not eligible for return.
- Return shipping is the responsibility of the customer unless the item arrived damaged or defective.
- Exchanges are available for size/color within 45 days.
- Refunds are processed within 5-7 business days after the returned item is received and inspected.
- Original shipping charges are non-refundable.
- For damaged or defective items, contact us within 48 hours of delivery with photos.`,
  },
  {
    topic: "ebike_info",
    content: `E-Bike Information:

Performance Cycle carries e-bikes.

Available:
- Electric motorcycles and scooters
- E-bike batteries (lithium-ion, various voltages)
- E-bike chargers and accessories

All e-bikes come with manufacturer warranty.
E-bike service and repair is available through our service department.
Battery recycling program available for old e-bike batteries.

NOTE: We do NOT carry e-bike conversion kits. We do NOT offer in-store demos for e-bikes.`,
  },
  {
    topic: "service_info",
    content: `Service Department Information:

Performance Cycle offers motorcycle and powersport vehicle maintenance and repair.

Services available:
- Tire mounting and balancing
- Brake service and replacement
- Chain and sprocket replacement
- Suspension setup and service
- Electrical diagnostics
- Pre-purchase inspections
- Winterization and spring prep
- E-bike service and repair

NOTE: We do NOT offer oil changes, fluid services, engine rebuilds, custom exhaust installation, or dyno tuning.

Appointments:
- Service appointments can be scheduled by calling the store or visiting in person.
- Walk-in service is available for minor items (tire pressure, battery checks) on a first-come basis.
- Typical turnaround for standard service is 2-5 business days.
- Rush service available for an additional fee.

All service work comes with a 90-day warranty on parts and labor.`,
  },
  {
    topic: "store_hours",
    content: `Performance Cycle Store Hours & Location:

Location: Centennial, CO (Denver metro area)
Website: performancecycle.com

Hours:
Monday: 9:00 AM - 7:00 PM
Tuesday: 9:00 AM - 7:00 PM
Wednesday: 9:00 AM - 7:00 PM
Thursday: 9:00 AM - 7:00 PM
Friday: 9:00 AM - 8:00 PM
Saturday: 9:00 AM - 6:00 PM
Sunday: 10:00 AM - 5:00 PM

Holiday hours may vary. Check our website or social media for holiday schedule updates.
Service department closes 1 hour before the store.

IMPORTANT: For the exact street address and phone number, direct customers to performancecycle.com/contact. Do NOT guess or make up an address.`,
  },
];

export async function seedKnowledge() {
  const sql = neon(process.env.DATABASE_URL!);
  const db = drizzle(sql);

  for (const entry of entries) {
    await db
      .insert(knowledgeBase)
      .values(entry)
      .onConflictDoUpdate({
        target: knowledgeBase.topic,
        set: { content: entry.content, updatedAt: new Date() },
      });
  }

  console.log(`Seeded ${entries.length} knowledge base entries`);
}
