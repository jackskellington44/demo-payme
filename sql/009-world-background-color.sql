-- Add background_color column to worlds table
-- This stores the world's background color (shown on loading page when no background image is set).
-- Defaults to white; when set without a font_color, client should use black as the font color.

alter table public.worlds
  add column if not exists background_color text;
