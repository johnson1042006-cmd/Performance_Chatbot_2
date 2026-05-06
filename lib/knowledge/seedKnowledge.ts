import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { knowledgeBase } from "../db/schema";

const entries = [
  {
    topic: "return_policy",
    content: `PERFORMANCE CYCLE RETURN & EXCHANGE POLICY (verbatim from performancecycle.com/returns-exchanges):

RETURN WINDOW:
- Most new, unused, and unaltered items can be returned within 60 DAYS of delivery for a full refund to the original payment method.

HELMETS — EXCHANGE ONLY (NOT REFUNDABLE):
- Helmets are NOT eligible for return/refund.
- Helmets ARE eligible for exchange (any size, color, model, or brand) AS LONG AS the helmet has NOT been ridden in.
- Must be shipped back in original condition with helmet bag, box, all original paperwork, AND accessories — including the original face shield sticker still attached.

WHAT IS NOT RETURNABLE:
- Any merchandise that has been "taken out for a ride" (this counts as used).
- Items showing signs of use: wear, bugs, dirt, smell, pet hair, scuffing, mounting, etc.
- Electronics with packaging removed or manufacturer seal broken.
- Hard parts that have been installed or show signs of installation attempts.
- Tools or chemicals that have been opened or have a broken seal.
- Tires that have been installed.
- Open box items where packaging has been destroyed.

APPAREL:
- Must be packed in original packaging with all original tags.
- Apparel returned with missing/damaged packaging, tags, components, or hangers may be returned to customer OR subject to a processing fee of up to 25% of merchandise cost.

REFUND PROCESSING:
- Once received and inspected, refunds are processed to the original payment method.
- Depending on the credit card company, it may take 2-10 ADDITIONAL business days for the credit to post after the refund is applied.

RETURN SHIPPING:
- Customer is responsible for ALL return shipping costs.
- Customer can use any carrier (UPS, USPS, FedEx).
- All shipments must be PREPAID; COD packages will be rejected.
- Refused/undelivered/abandoned packages are subject to a $10 service fee.

ORDER CANCELLATIONS / MODIFICATIONS:
- Orders can be modified or cancelled ONLY while status is "Awaiting Fulfillment."
- Once status is "Awaiting Shipment," the order CANNOT be cancelled or modified.

DAMAGED ITEMS ON ARRIVAL:
- Notify ASAP if items arrive damaged.
- Keep all original shipping containers and take pictures if possible.
- Damaged item claims are handled through the shipping carrier (UPS/FedEx/USPS); we assist customers in these claims.

DEFECTS & WARRANTY:
- Each manufacturer has its own warranty policy. Performance Cycle assists customers with warranty claims but does NOT provide a direct warranty.
- Warranty processing typically takes 4-8 weeks.
- Manufacturer warranties do NOT cover defects from normal wear or customer negligence.

RETURNS PROCESS (5 steps):
1. Download the Return Form: https://performancecycle.com/content/Online%20Return%20Form.pdf
2. Print the Return Form.
3. Fill out all required information.
4. Place the form in the box and ship via UPS, USPS, or FedEx (customer pays return shipping).
5. Allow 1-2 business days to process once delivered.

RETURN ADDRESS:
Performance Cycle of Colorado
Attn: Returns Department
7375 S Fulton St.
Centennial, CO 80112

Customer should retain return tracking. Performance Cycle is NOT responsible for packages lost during return shipment.

LINKS:
- Full Returns & Exchanges page: https://performancecycle.com/returns-exchanges/
- Return Form (PDF): https://performancecycle.com/content/Online%20Return%20Form.pdf
- Questions: 303-744-2011

CRITICAL FOR THE AI: Quote this policy VERBATIM. Do not paraphrase, summarize, or "round" any number. Specifically: the return window is 60 DAYS (NOT 30). Helmets are EXCHANGE ONLY (worn or unworn helmets cannot be refunded — exchange is allowed only for unworn helmets). There is NO 45-day exchange window — that is a hallucinated number, never use it. If a customer asks something not directly answered above, link them to the Returns & Exchanges page rather than guessing.`,
  },
  {
    topic: "ebike_info",
    content: `E-BIKE INFORMATION:

Performance Cycle DOES carry e-bikes. Catalog: https://performancecycle.com/ebikes/

GUIDANCE FOR THE AI:

When a customer asks about e-bikes, you MAY present specific products that appear in the RELEVANT PRODUCTS section of your prompt — those come from our live BigCommerce catalog and are accurate. Treat e-bike product recommendations the same way you treat helmet/jacket/boot recommendations: lead with real products from the prompt, include name, price, and link.

CRITICAL E-BIKE RULES:

1. NEVER name an e-bike brand or model that does NOT appear in the RELEVANT PRODUCTS section of the current prompt. Do NOT pull brand names from general knowledge — even if you've "heard of" them. Common e-bike brands like Super73, Specialized, Trek, Rad Power, Stage2 may or may not be carried — only name what's actually in the current prompt's product results.

2. If a customer asks about a specific brand or model NOT in the current prompt results, respond honestly: "I'm not finding [brand/model] in my current results — that doesn't necessarily mean we don't carry it, but it's not showing up. Our e-bikes page at https://performancecycle.com/ebikes/ shows current inventory, or our team at 303-744-2011 can confirm."

3. For questions about e-bike service, batteries, conversion kits, warranty terms, demos, or anything beyond product browsing, route them to the team: "For specifics on [topic], give us a call at 303-744-2011 or use our contact form at https://performancecycle.com/contact-us/ — our team handles e-bike service questions directly."

4. DO NOT speculate about e-bike specs (motor wattage, range, battery type, classification) unless that information appears in the product description provided in the prompt.`,
  },
  {
    topic: "service_info",
    content: `PERFORMANCE CYCLE SERVICE DEPARTMENT:

NOTE TO AI: Specific general service offerings, pricing, turnaround, scheduling process, and warranty terms have NOT yet been confirmed with the owner. Do NOT make up specific pricing or turnaround times for general service. The Tech-Air section below IS verified from the website and may be quoted with confidence.

TIRE & WHEEL SERVICES (verified — listed on website):
Performance Cycle offers tire mounting, balancing, and related wheel services in-store at the Centennial location. Full details: https://performancecycle.com/tire-and-wheel-services/. Specific pricing and turnaround for tire/wheel services have NOT been confirmed with the owner — for current rates, route the customer to the live service team via chat or have them call 303-744-2011.

HELMET FITTING (verified — listed on website):
Free in-store helmet fitting is available at the Centennial location during store hours. No appointment required.

BUY ONLINE, PICK UP IN STORE (verified — listed on website):
Customers can select pickup at checkout and collect their order at 7375 S Fulton St., Centennial, CO 80112 during store hours.

ALPINESTARS TECH-AIR SERVICE (FACTORY AUTHORIZED — verbatim from website):

Performance Cycle is one of only TWO Alpinestars Factory Authorized Tech-Air Service Centers in the United States. Our expert staff is fully trained to ensure downtime is kept to a minimum. In most cases, next business day turnaround on service items like cartridge replacements.

Tech-Air Service Request Process:

Step 1 — Complete the Tech-Air Service Request Form:
- Download the Service Request Form from the website.
- Complete all fields accurately.
- List airbag model and serial number.
- Clearly describe any issues or error lights.
- Select the requested service.
- Provide return shipping address.

Step 2 — Send the Airbag In:
- Include the completed Service Request in the box with the Tech-Air airbag.
- Ship to:
  Performance Cycle
  Attn: Tech-Air Service
  7375 S Fulton St
  Centennial, CO 80112
- A trackable shipping method is recommended.

Step 3 — Service Timelines:
- Canister Replacements: Processed and shipped back within 24-48 hours of arrival, assuming required parts are in stock.
- Troubleshooting: Email within 24-48 hours confirming status or next steps.
- Repairs Requiring Factory Service: If the issue cannot be solved in-store, the airbag is sent to the Alpinestars Service Center — this process can take up to 4 WEEKS.

Step 4 — Communication & Updates:
- Email confirmation when the airbag is checked in.
- Additional updates if the unit requires manufacturer service.
- Tracking number provided once service is complete and the unit ships back.

Step 5 — Return Shipping:
- Returned via insured ground shipping unless otherwise requested.
- Expedited return shipping available — note it on the intake form.

GENERAL SERVICE (NOT YET VERIFIED WITH OWNER):
Specific service offerings beyond Tech-Air, scheduling process, pricing, turnaround times, and service warranty terms have NOT been confirmed. For general service questions outside of Tech-Air, direct customers to call the store at 303-744-2011 or use the contact form at https://performancecycle.com/contact-us/ for current details. Do NOT invent specific service offerings, prices, or turnaround times.

CRITICAL FOR THE AI: When answering Tech-Air questions, you MAY quote the verified workflow above. When asked about other service (oil changes, tire mounting cost, scheduling, etc.), respond honestly: "I don't have current details on [topic] in my notes. The team at 303-744-2011 can give you the right info, or use https://performancecycle.com/contact-us/." DO NOT make up service details that aren't in this entry.`,
  },
  {
    topic: "store_hours",
    content: `PERFORMANCE CYCLE STORE INFORMATION (verbatim from contact-us page):

ADDRESS:
Performance Cycle of Colorado
7375 S Fulton St.
Centennial, CO 80112
(Denver metro area)

PHONE: 303-744-2011

HOURS OF OPERATION (from the official Contact Us page):
- Monday: 9:00 AM - 6:00 PM MST
- Tuesday: 9:00 AM - 6:00 PM MST
- Wednesday: 9:00 AM - 6:00 PM MST
- Thursday: 9:00 AM - 6:00 PM MST
- Friday: 9:00 AM - 6:00 PM MST
- Saturday: 9:00 AM - 5:00 PM MST
- Sunday: NOT LISTED on contact page (verify with owner — assume CLOSED until confirmed otherwise)

Holiday hours may vary. Customers should check the website for holiday schedule updates.

Service department: closing time relative to the storefront has NOT been verified — do not state a specific service department closing time.

CONTACT:
- Phone: 303-744-2011 (during business hours)
- Contact form: https://performancecycle.com/contact-us/
- Weekend contact form submissions may not receive a response until Monday morning.

Website: performancecycle.com

CRITICAL FOR THE AI: Quote hours and address VERBATIM from above. If asked about Sunday hours, say "I don't have Sunday hours listed — give the store a call at 303-744-2011 or check performancecycle.com to confirm." Do NOT invent Sunday hours or service department hours.`,
  },
  {
    topic: "store_catalog",
    content: `Performance Cycle Product Catalog — Full Store Menu

Performance Cycle is Colorado's largest independent motorcycle gear, parts, and accessories retailer. Below is the complete category structure with browse links. Use this to guide customers to the right products and categories.

HELMETS — https://performancecycle.com/helmets/
  Street Helmets — https://performancecycle.com/helmets/street/
  Adventure Helmets — https://performancecycle.com/helmets/adventure/
  Race Helmets — https://performancecycle.com/helmets/race/
    NOTE: "Sport helmet" and "sports helmet" are common customer terms for race/track helmets. When a customer says "sport helmet" or "sports helmet," treat it as a request for race-category helmets (Shoei X-15, Arai Corsair-X, KYT NZ-Race, etc.).
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
  {
    topic: "what_we_sell",
    content: `WHAT PERFORMANCE CYCLE SELLS:

Performance Cycle is a motorcycle GEAR, PARTS, and ACCESSORIES retailer in Centennial, CO. We are NOT a motorcycle dealership.

WE SELL:
- Helmets (street, full-face, modular, open-face, off-road/MX, adventure, race)
- Jackets, pants, suits, vests
- Boots, gloves
- Body armor and protection (chest protectors, back protectors, knee guards, neck braces)
- Tech-Air airbag systems (we are a Factory Authorized Tech-Air Service Center)
- Tires (sportbike, sport-touring, cruiser, dual-sport, adventure, offroad/MX, ATV, inner tubes)
- Parts — extensive catalog including: chains, sprockets, brake pads and rotors, batteries, levers, mirrors, controls, foot pegs, handlebars, exhaust systems, suspension parts, plastics, fender eliminator kits, motorcycle covers, stands
- Maintenance — oil filters, air filters, spark plugs, chemicals, repair manuals, tools (Motion Pro, etc.)
- Communication systems (Cardo, Sena intercoms and headsets)
- Electronics (Garmin GPS, Insta360 cameras, Quadlock, Ram Mount)
- Snow gear and snow plows
- E-bikes (Stacyc, Super73, Stage2, 79Bike, E-Ride — see ebike_info KB entry)

WE ALSO OFFER LIMITED IN-STORE SERVICES (verified — listed on website):
- **Tire & Wheel Services** — mounting, balancing, tube installation. Details: https://performancecycle.com/tire-and-wheel-services/
- **Helmet Fitting** — free in-store sizing assistance during store hours
- **Tech-Air Service** — Factory Authorized service center for Alpinestars Tech-Air airbags (see service_info KB entry for the verified workflow)
- **Buy Online, Pick Up In Store** — available at checkout

We do NOT operate a full motorcycle service department. We do NOT do oil changes, engine work, suspension rebuilds, or general bike service like a dealership shop. For service questions outside Tech-Air and Tire & Wheel, route to the live service team via chat handoff.

WE DO NOT SELL:
- Motorcycles. We are NOT a motorcycle dealership. We sell GEAR, PARTS, and ACCESSORIES for motorcycles, not the motorcycles themselves.
- Cars, ATVs (gear yes, vehicles no), side-by-sides, dirt bikes (the vehicles), or scooters (other than e-scooters in the e-bike section).
- Used gear or used parts — everything we sell is new.
- Bicycle (non-motorized) parts or accessories.

CRITICAL FOR THE AI: When a customer asks "what's a good bike?" or "what motorcycle should I get?" or "do you carry [motorcycle brand/model]?" the correct response is to clarify the boundary: "We don't sell motorcycles — we're a gear and parts shop. But if you've got a bike or are picking one out, I can help you with helmets, jackets, gloves, tires, parts, and accessories. What are you looking for?"

Do NOT offer to help them pick out a motorcycle. Do NOT compare motorcycle models. Do NOT recommend motorcycle dealerships by name.`,
  },
  {
    topic: "arai_vas_system",
    content: `What is the Arai VAS system?

VAS stands for **Variable Axis System** — Arai's face shield mounting/pivot system. The side pods that hold the shield pivot were redesigned so the pivot point sits closer to the bottom edge of the shell. This keeps the helmet's outer surface as smooth and continuous as possible, which is core to Arai's safety philosophy: a rounder, less interrupted shell is better at deflecting glancing blows and redirecting impact energy. VAS appears on Arai's premium full-face helmets including the Corsair-X, Quantum-X, Signet-X, Defiant-X, Regent-X, and DT-X.

Importantly, VAS is NOT a sun visor or peak. Internal drop-down sun visors (common on other brands) sit between the outer and inner shell, and Arai believes that interferes with how the shell absorbs impact. With VAS, all sun protection is handled by accessories that mount externally:

- The **Arai Pro Shade System** is a SEPARATE accessory — an external flip-down peak that bolts onto VAS-equipped helmets. Sold at Performance Cycle as the "VAS-V Max Vision Pro Shade System" — $96.95.
- **Replacement face shields** for VAS-equipped helmets are sold separately. Performance Cycle stocks the "VAS-V Max Vision Face Shield" — $57.95 — in Silver Mirror, Red Mirror, Clear, and Dark Smoke.

CRITICAL FOR THE AI: Do NOT describe VAS itself as a "peak," "sun visor," "sun shade," or anything that "flips down." That is the Pro Shade System (a separate accessory). VAS itself is the face shield mounting system. When a customer asks about VAS, lead with that distinction.`,
  },
  {
    topic: "shipping_policy",
    content: `PERFORMANCE CYCLE SHIPPING POLICY (verbatim from performancecycle.com/shipping-info/ and FAQ):

FREE SHIPPING:
- Most orders over $99.00 ship FREE within the contiguous United States.

EXCEPTIONS TO FREE SHIPPING (still ship, just not free):
- Tires: $12.95 PER TIRE shipping charge, regardless of order total.
- Oversize items.
- Overweight items.
- Hazardous materials (chemicals, batteries).
These items require specialized packaging and shipping procedures and incur additional charges shown at checkout.

ORDERS UNDER $99:
- Standard shipping charges apply, calculated at checkout based on weight and destination.

PROCESSING:
- Orders are typically processed within 1-2 business days.
- Order status progresses: Awaiting Fulfillment → Awaiting Shipment → Shipped.
- Once an order is in "Awaiting Shipment" status, it CANNOT be modified or cancelled.

CARRIERS:
- Standard ground shipping via UPS, FedEx, or USPS depending on item and destination.

INTERNATIONAL / OUTSIDE CONTIGUOUS US:
- Not confirmed in current notes. If asked, route to the live service team or direct the customer to call 303-744-2011 or use https://performancecycle.com/contact-us/.

BUY ONLINE, PICK UP IN STORE:
- Available at the Centennial, CO storefront. Customer selects the option at checkout and picks up at 7375 S Fulton St., Centennial, CO 80112 during store hours.

LINKS:
- Full Shipping Info: https://performancecycle.com/shipping-info/
- FAQ: https://performancecycle.com/faq/
- Contact: 303-744-2011 or https://performancecycle.com/contact-us/

CRITICAL FOR THE AI: When asked about shipping, lead with the $99 free shipping threshold and the per-tire surcharge if relevant. NEVER invent international rates, expedited rates, or specific delivery times — those are not in this entry. If a customer asks about something not covered above (international, expedited, specific transit time), say "I don't have specifics on [topic] in my notes — give the team a call at 303-744-2011 or check https://performancecycle.com/shipping-info/" rather than guessing.`,
  },
];

export async function seedKnowledge() {
  const sql = neon(process.env.DATABASE_URL!);
  const db = drizzle(sql);

  for (const entry of entries) {
    await db
      .insert(knowledgeBase)
      .values(entry)
      // Seed is first-run only. Edit KB via the dashboard.
      .onConflictDoNothing();
  }

  console.log(`Seeded ${entries.length} knowledge base entries`);
}
