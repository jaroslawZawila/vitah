-- Prod migration: thumbnails for project photos. Additive only; safe to
-- re-run. Photos uploaded before this keep a null size (no thumbnail) and
-- are served full size in the grids.
ALTER TABLE "project_photos" ADD COLUMN IF NOT EXISTS "thumb_size_bytes" integer;
