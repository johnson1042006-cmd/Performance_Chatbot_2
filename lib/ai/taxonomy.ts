/**
 * Static product taxonomy for Performance Cycle (performancecycle.com).
 *
 * This is the authoritative reference for which products, brands, and models
 * belong to which riding disciplines. It is injected into every system prompt
 * so the AI always has catalog context regardless of live search results.
 *
 * Update this file when the store adds or drops major product lines.
 */
export const PRODUCT_TAXONOMY = `
PERFORMANCE CYCLE — PRODUCT TAXONOMY
Source: performancecycle.com

### RIDING DISCIPLINES
- STREET: Road/commuting. Gear: helmets, jackets, boots, pants, gloves, heated gear, rain gear, race suits, luggage, backpacks, protection, accessories, glasses/goggles, women's, kids'.
- ADVENTURE (ADV/dual-sport touring): helmets, jackets, boots, gloves, pants, luggage, heated gear, accessories, women's.
- MOTOCROSS (MX/dirt track): helmets, boots, jerseys, pants, gloves, protection, parts.
- ENDURO/DUAL SPORT (trail/enduro): helmets, boots, gloves, hydration packs, protection.
- OFFROAD (dirt/trail): helmets, jerseys, pants, boots, gloves, goggles, jackets, gear bags, protection, women's, kids'.
- ONROAD: jackets, women's gear.

---

### HELMETS

STREET full-face (for road use):
- Shoei: RF-SR, RF-1400
- Arai: Quantum-X
- HJC: i71
- Icon: Airform, Airflite, Airflite Rubatone
- Scorpion: EXO-R420
- Bell: Qualifier
- LS2: FF807 Dragon

RACE (track/sport):
- Shoei: X-Fifteen
  NOTE: On performancecycle.com this helmet is listed as 'Shoei X-15' — correct product URL is /shoei-x-15-helmet/ — do NOT link to /shoei-x-fifteen-helmet/ as that returns a 404.
- Arai: Corsair-X
- KYT: NZ-Race, TT-Course, TT-Revo

ADVENTURE (ADV/touring):
- Scorpion: EXO-AT950
- Shoei: Hornet X2
- Klim: Krios Pro
- Arai: XD-5
- Airoh: Commander 2

MODULAR (flip-up):
- Shoei: Neotec 3, GT-Air 3
- Klim: GT1 Expedition

MOTO/OFFROAD — MX, dirt, snow — NEVER for street:
- Klim: F3, F3 Carbon, F3 Carbon ECE, F5
- Fox Racing: V1, V3
- Fly Racing: Kinetic, Formula, Formula CC
- 6D: ATR-2
- Troy Lee Designs: SE5, SE Ultra
- Alpinestars: SM5, SM8
- Fasthouse helmets
- Leatt: Moto 7.5

OPEN FACE:
- Bell: Custom 500
- Arai: Classic-V

---

### BOOTS

- Street/Sport (road): Alpinestars SMX / SP-1 / Faster series, Sidi street models, TCX street
- Race (track): Alpinestars Supertech R, Sidi Vortice / Rex
- MX/Offroad: Alpinestars Tech 7 / Tech 10, Fox MX boots, Fly MX boots, Gaerne offroad, Sidi Crossfire
- Adventure (ADV touring): Alpinestars Belize / Corozal, Sidi Adventure models
- Touring: Alpinestars touring line, Sidi touring line
- Shoes (casual/urban): street-style riding shoes

---

### RIDING GEAR (Jackets, Pants, Gloves, Jerseys)

- Street gear: Alpinestars street jackets/pants, Icon jackets, REV'IT jackets/pants/gloves, Scorpion jackets
- Offroad/MX gear: Fox Racing jerseys/pants/gloves, Fly Racing jerseys/pants/gloves, Troy Lee Designs jerseys/pants, Fasthouse jerseys/pants/gloves, Alpinestars moto jerseys/pants
- Adventure gear: Klim jackets/pants/gloves/packs, REV'IT adventure line
- Women's: available across street, adventure, and offroad disciplines
- Youth/Kids': helmets, protection, jerseys, pants

---

### TIRES

Categories: Adventure, ATV, Cruiser, Dual Sport, Offroad, Sport Touring, Sportbike, Inner Tubes
Brands: Michelin, Dunlop, Pirelli, Metzeler, Continental, Bridgestone, Shinko, Kenda, Sedona, IRC
Service: tire mounting and wheel services available in-store

---

### PARTS

Street parts: handlebars, mirrors, tie downs, motorcycle covers, fender eliminator kits, air filters, sprockets
Offroad parts: handlebars, mirrors, tie downs, number plates, bolt kits, sprockets, dirt bike air filters
Maintenance: air filters, spark plugs, gas cans, throttle tubes, fork seals, drain plugs, headlight bulbs, bearings, brake pads/shoes, batteries, oil filters, repair manuals
Chemicals (brand: Motorex): 4-stroke oil, 2-stroke pre-mix oil, gear oil, fork oil, chain lube, brake fluid, coolant, fuel treatment/stabilizer, air filter oil/cleaner, cleaners
Tools (brand: Motion Pro): brake tools, carburetor tools, chain tools, engine tools, flywheel pullers, suspension tools, tie downs/straps, tire/wheel tools, tool kits, hour meters
Controls: cables, foot pegs, phone mounts, shift levers
Stands: dirt stands, street stands
Other: suspension parts, chains, tubes

Note: For parts fitment questions (does this part fit my bike?), defer to the store at 303-744-2011 — fitment requires year/make/model expertise.

---

### ELECTRONICS

- Cardo: Freecom, Packtalk Edge, Packtalk Neo, Packtalk Pro (Bluetooth helmet comms)
- Sena: Bluetooth communication systems
- Garmin: GPS navigation
- Quadlock: phone mounts
- Ram Mount: device/phone mounts
- Insta360: action cameras

---

### E-BIKES

Performance Cycle carries electric bikes (NOT motorcycles):
- Stacyc: 12eDrive, 16eDrive (kids electric balance bikes — gateway to riding for children)
- Super73: electric bikes
- Stage2: electric bikes
- 79Bike: electric bikes
- E-Ride: electric bikes

---

### SNOW & WINTER

Snowmobile gear: snow jackets, snow pants/bibs, snow boots, snow gloves, women's snow gear, base layers, snow accessories, snow goggles
Snow plows: plow blades, plow mounts, winches, winch mounts, push tubes, manual lift kits (for ATVs/utility vehicles)
Backcountry gear
Primary brand: Klim

---

### HEATED GEAR

Heated jackets, heated pants, heated gloves, heated accessories
Available across street and adventure disciplines

---

### CASUAL / LIFESTYLE

Hats, hoodies, t-shirts, beanies, socks, sunglasses, backpacks, wallets, stickers, decor, guardian bells, nutrition, toys, DVDs

---

### PROTECTION

Chest protectors, elbow guards, knee braces, neck braces
Brands: Alpinestars Tech-Air, Leatt, Fox, 6D

---

### KEY BRAND DISCIPLINE MAP

PRIMARILY OFFROAD/MX (dirt/motocross/enduro customers only):
Fox Racing, Fly Racing, Troy Lee Designs, Fasthouse, 6D, Leatt, Moose Racing

PRIMARILY STREET/ROAD:
Icon, KYT, Bell (street line), LS2, Schuberth

PRIMARILY ADVENTURE/SNOW — NOT a street brand:
Klim (ADV touring and snowmobile; never route as a street brand)

ELECTRONICS:
Cardo, Sena, Garmin, Quadlock, Ram Mount, Insta360

MULTI-DISCIPLINE — specific model line determines discipline:
- Shoei: street (RF-SR, RF-1400) | race (X-Fifteen) | modular (Neotec 3, GT-Air 3) | adventure (Hornet X2)
- Arai: street (Quantum-X) | race (Corsair-X) | adventure (XD-5)
- Alpinestars: street AND MX AND race — discipline depends on specific model
- Scorpion: street (EXO-R420) | adventure (EXO-AT950)
- Sidi: street boots AND MX boots AND race boots — model determines discipline
- REV'IT: street and adventure
`.trim();
