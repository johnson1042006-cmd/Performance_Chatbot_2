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

IMPORTANT: For the exact street address and phone number, direct customers to the [Contact Us page](https://performancecycle.com/contact-us/). Do NOT guess or make up an address or phone number.`,
  },
  {
    topic: "store_catalog",
    content: `Performance Cycle Product Catalog — Full Store Menu

Performance Cycle is Colorado's largest independent motorcycle gear, parts, and accessories retailer. Below is the complete category structure with browse links. Use this to guide customers to the right products and categories.

HELMETS — https://performancecycle.com/helmets/
  Street Helmets — https://performancecycle.com/helmets/street/
  Adventure Helmets — https://performancecycle.com/helmets/adventure/
  Race Helmets — https://performancecycle.com/helmets/race/
  Modular Helmets — https://performancecycle.com/helmets/modular/
  Moto (MX/Offroad) Helmets — https://performancecycle.com/helmets/moto/
  Open Face Helmets — https://performancecycle.com/helmets/open-face/
  Brands: AGV, Airoh, Alpinestars, Arai, Bell, Biltwell, Daytona, Fly Racing, Highway 21, HJC, Icon, KYT, Leatt, LS2, Shoei

BOOTS — https://performancecycle.com/boots/
  Adventure Boots — https://performancecycle.com/boots/adventure/
  Race Boots — https://performancecycle.com/boots/race/
  Moto (MX/Offroad) Boots — https://performancecycle.com/boots/moto/
  Sport Boots — https://performancecycle.com/boots/sport/
  Shoes — https://performancecycle.com/boots/shoes/
  Touring Boots — https://performancecycle.com/boots/touring/
  Brands: Alpinestars, Fly Racing, Forma, Fox Racing, Gaerne, Icon, Klim, Leatt, Noru, REV'IT!, Sidi

TIRES — https://performancecycle.com/tires/
  Adventure Tires — https://performancecycle.com/tires/adventure/
  ATV Tires — https://performancecycle.com/tires/atv/
  Cruiser Tires — https://performancecycle.com/tires/cruiser/
  Dual Sport Tires — https://performancecycle.com/dual-sport/
  Offroad Tires — https://performancecycle.com/tires/offroad/
  Sport Touring Tires — https://performancecycle.com/tires/sport-touring/
  Sportbike Tires — https://performancecycle.com/tires/sportbike/
  Inner Tubes — https://performancecycle.com/tires/inner-tubes/
  Brands: Continental, Dunlop, Metzeler, Michelin, MotoZ, Shinko
  Tire mounting and balancing service available — see Service Department info.

ELECTRONICS — https://performancecycle.com/electronics/
  Communication systems, GPS, action cameras, phone mounts.
  Cardo — Bluetooth communication/intercoms
  Sena — Bluetooth communication/intercoms
  Garmin — GPS navigation
  Insta360 — Action cameras
  Quadlock — Phone mounts
  Ram Mount — Device mounts

RIDING GEAR — https://performancecycle.com/riding-gear/
  By riding style:
    Adventure Gear — https://performancecycle.com/riding-gear/adventure/
    Dual Sport Gear — https://performancecycle.com/riding-gear/dual-sport/
    Street Gear — https://performancecycle.com/riding-gear/street/
    Moto (MX/Offroad) Gear — https://performancecycle.com/riding-gear/moto/
    Race Gear — https://performancecycle.com/riding-gear/race/
    Sport Gear — https://performancecycle.com/riding-gear/sport/
    Women's Gear — https://performancecycle.com/riding-gear/womens/
  Product types: Jackets, Pants, Gloves, Jerseys, Suits, Vests, Base Layers, Armor/Protection
  Goggles — https://performancecycle.com/riding-gear/goggles/
  Brands: Alpinestars, Fasthouse, Fly Racing, Fox Racing, Icon, Klim, Leatt, Noru, REV'IT!, RST, Troy Lee Designs

E-BIKES — https://performancecycle.com/ebikes/
  Electric motorcycles, scooters, and e-bikes.
  79Bike — Electric dirt bikes
  E-Ride — Electric motorcycles/scooters
  Stacyc — Kids' electric balance bikes
  Stage2 — Electric bikes
  Super73 — Electric cruiser bikes
  We do NOT carry e-bike conversion kits.

PARTS — https://performancecycle.com/parts/
  Street Parts — Handlebars, Mirrors, Tie Downs, Motorcycle Covers, Fender Eliminator Kits, Air Filters, Sprockets
  Offroad Parts — Offroad-specific components
  Stands — Motorcycle stands and lifts
  Maintenance — Oil, filters, chain lube, cleaning products
  Tools — Specialty motorcycle tools
  Controls — Levers, grips, cables

SNOW — https://performancecycle.com/snow/
  Backcountry Gear — Avalanche safety and backcountry equipment
  Snow Plows — Plow Blades, Plow Mounts, Winches, Winch Mounts, Push Tubes, Manual Lift Kits
  Snowmobile Gear — Helmets, jackets, pants, gloves, boots for snowmobiling

SALE / CLEARANCE — https://performancecycle.com/sale/
  Discounted items: Street Helmets, Moto Helmets, Boots, Street Gear, Offroad Gear, Casual Apparel
  Note: Clearance/final sale items are not eligible for return.

WHAT WE DO NOT CARRY:
  - Full motorcycles or powersport vehicles (gear, parts, and accessories only)
  - E-bike conversion kits
  - Bicycle (non-motorized) parts or accessories
  - Car or truck parts

POPULAR BRANDS: AGV, Airoh, Alpinestars, Arai, Bell, Cardo, Continental, Dunlop, Fasthouse, Fly Racing, Forma, Fox Racing, Gaerne, Garmin, HJC, Icon, Insta360, Klim, KYT, Leatt, LS2, Metzeler, Michelin, Noru, Quadlock, Ram Mount, REV'IT!, RST, Sena, Shinko, Shoei, Sidi, Super73, Troy Lee Designs`,
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
