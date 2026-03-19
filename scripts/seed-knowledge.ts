import { seedKnowledge } from "../lib/knowledge/seedKnowledge";

seedKnowledge()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
