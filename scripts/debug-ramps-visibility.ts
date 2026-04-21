import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { getProductByNameLike } = await import("../lib/bigcommerce/client");

  const rampNames = [
    'Fly Folding Arched Aluminum Ramp 88"x11.5"',
    'Quadboss Quadlite Arched Aluminum Ramp 89"x12"',
    'RevArc ATV Loading Ramp 90"x55"',
    'Quadboss Xtreme Aluminum Ramp 89"x12"',
    "Moose Aluminum Folding Step Ramp",
    "Bikemaster Stair Ramp",
  ];

  for (const name of rampNames) {
    const products = await getProductByNameLike(name, 5);
    if (products.length > 0) {
      const p = products[0];
      console.log(`${p.name} (id=${p.id}): is_visible=${p.is_visible}, availability=${p.availability}, inventory_tracking=${p.inventory_tracking}, inventory_level=${p.inventory_level}`);
    } else {
      console.log(`${name}: NOT FOUND on BC`);
    }
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
