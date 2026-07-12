-- Color search (Jacob #1): color-driven product retrieval.
-- Adds a generated tsvector over product_colorways.colorway_lower so the search
-- pipeline can find color-matching bc_product_ids BEFORE the candidate pool is
-- truncated (previously color was only a weak post-slice re-rank, which
-- collapsed rare-color/broad-category results — e.g. "green jacket" → 1 of 4).
--
-- 'simple' config (no stemming) so color tokens match verbatim and word-level
-- containment works: to_tsquery('simple','green') matches "oil green".
--
-- Separators are normalized to spaces FIRST because the default parser tokenizes
-- slash-joined colorways as one token ('black/green' → a single lexeme), which
-- would never match to_tsquery('green'). regexp_replace splits them so
-- "Black/Green", "Red/Blue" etc. index as individual color words. Mirrors the
-- messages.content_tsv precedent (0004_phase5.sql).

ALTER TABLE "product_colorways"
  ADD COLUMN IF NOT EXISTS "colorway_tsv" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple', regexp_replace("colorway_lower", '[/_,-]+', ' ', 'g'))
  ) STORED;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_colorways_colorway_tsv_idx"
  ON "product_colorways" USING GIN("colorway_tsv");
