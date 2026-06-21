-- SQL Migration script
-- Adds item_id to public.order_items table referencing public.menu_items(id)

ALTER TABLE public.order_items 
ADD COLUMN IF NOT EXISTS item_id uuid REFERENCES public.menu_items(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.order_items.item_id IS 'Ties order_items back to menu_items.id to prevent loose, untracked item sales.';
