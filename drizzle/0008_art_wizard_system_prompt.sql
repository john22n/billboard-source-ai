-- The Creative Studio is now driven by one editable wizard system prompt.
-- The previous image-only prompt has no meaning for the new role, so the row is
-- removed and the code-owned original prompt applies until an admin saves one.
ALTER TABLE "art_wizard_settings" RENAME COLUMN "image_generation_prompt" TO "system_prompt";
DELETE FROM "art_wizard_settings";
