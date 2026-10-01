-- ====================================================================
-- Phase 7: Menu Availability Source of Truth & Telegram Security
-- 1. Establish menu_items.status as the canonical Single Source of Truth
-- 2. Secure RLS policies on menu_items and categories
-- 3. Server-enforced RPCs for menu management
-- 4. Hardening and security revoke on send_telegram_message
-- ====================================================================

-- ----------------------------------------------------------------------------
-- 1. Secure RLS Policies on menu_items and categories
-- ----------------------------------------------------------------------------

ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

-- Drop insecure / legacy policies on menu_items
DROP POLICY IF EXISTS "Allow public insert menu" ON public.menu_items;
DROP POLICY IF EXISTS "Allow public read menu" ON public.menu_items;
DROP POLICY IF EXISTS "Allow public update menu" ON public.menu_items;
DROP POLICY IF EXISTS "anon update menu_items" ON public.menu_items;
DROP POLICY IF EXISTS "public read menu_items" ON public.menu_items;
DROP POLICY IF EXISTS "menu_items_select" ON public.menu_items;
DROP POLICY IF EXISTS "menu_items_staff_all" ON public.menu_items;

-- Recreate strict policies on menu_items
-- Anyone (anon and authenticated) can read menu items
CREATE POLICY "menu_items_select" ON public.menu_items
  FOR SELECT TO anon, authenticated
  USING (true);

-- Only authenticated staff (admin or casher) can insert/update/delete menu items
CREATE POLICY "menu_items_staff_all" ON public.menu_items
  FOR ALL TO authenticated
  USING (public.has_role('admin') OR public.has_role('casher'))
  WITH CHECK (public.has_role('admin') OR public.has_role('casher'));

-- Drop insecure / legacy policies on categories
DROP POLICY IF EXISTS "Allow public insert categories" ON public.categories;
DROP POLICY IF EXISTS "Allow public read categories" ON public.categories;
DROP POLICY IF EXISTS "Allow public update categories" ON public.categories;
DROP POLICY IF EXISTS "anon update categories" ON public.categories;
DROP POLICY IF EXISTS "public read categories" ON public.categories;
DROP POLICY IF EXISTS "categories_select" ON public.categories;
DROP POLICY IF EXISTS "categories_staff_all" ON public.categories;

-- Recreate strict policies on categories
CREATE POLICY "categories_select" ON public.categories
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "categories_staff_all" ON public.categories
  FOR ALL TO authenticated
  USING (public.has_role('admin') OR public.has_role('casher'))
  WITH CHECK (public.has_role('admin') OR public.has_role('casher'));

-- ----------------------------------------------------------------------------
-- 2. Authoritative Menu Management RPCs
-- ----------------------------------------------------------------------------

-- 2.1 Update Menu Item Status (available, out_of_stock, paused, hidden)
CREATE OR REPLACE FUNCTION public.update_menu_item_status(
  p_item_id uuid,
  p_status  text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_role  text;
  v_norm_status  text;
  v_item         public.menu_items%ROWTYPE;
BEGIN
  -- 1. Security Check: Require admin or casher role
  v_caller_role := public._require_staff_role(ARRAY['admin', 'casher']);

  -- 2. Normalize and validate status
  v_norm_status := lower(trim(COALESCE(p_status, 'available')));
  IF v_norm_status NOT IN ('available', 'out_of_stock', 'paused', 'hidden', 'unavailable') THEN
    RAISE EXCEPTION 'حالة الصنف غير صالحة: %', p_status USING ERRCODE = 'P0001';
  END IF;

  -- 3. Update menu item
  UPDATE public.menu_items
  SET
    status = v_norm_status,
    updated_at = now()
  WHERE id = p_item_id
  RETURNING * INTO v_item;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'الصنف غير موجود: %', p_item_id USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'id', v_item.id,
    'name', v_item.name,
    'status', v_item.status,
    'updated_at', v_item.updated_at
  );
END;
$$;

-- 2.2 Toggle Menu Item Availability (boolean toggle)
CREATE OR REPLACE FUNCTION public.toggle_menu_item_availability(
  p_item_id      uuid,
  p_is_available boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN public.update_menu_item_status(
    p_item_id,
    CASE WHEN p_is_available THEN 'available' ELSE 'out_of_stock' END
  );
END;
$$;

-- 2.3 Fetch Full Menu with Categories for Admin Dashboard
CREATE OR REPLACE FUNCTION public.get_menu_items_admin()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_items jsonb;
BEGIN
  -- Security check: Require admin or casher role
  PERFORM public._require_staff_role(ARRAY['admin', 'casher']);

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', m.id,
        'name', m.name,
        'description', m.description,
        'price', m.price,
        'status', COALESCE(m.status, 'available'),
        'isAvailable', (COALESCE(m.status, 'available') = 'available'),
        'imageUrl', m.image_url,
        'unitType', m.unit_type,
        'baseQty', m.base_qty,
        'isPopular', m.is_popular,
        'displayOrder', m.display_order,
        'categoryId', m.category_id,
        'categoryName', c.name,
        'categorySlug', c.slug,
        'categoryOrder', COALESCE(c.display_order, 999),
        'updatedAt', m.updated_at
      )
      ORDER BY COALESCE(c.display_order, 999) ASC, m.display_order ASC, m.name ASC
    ),
    '[]'::jsonb
  )
  INTO v_items
  FROM public.menu_items m
  LEFT JOIN public.categories c ON m.category_id = c.id;

  RETURN v_items;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. Telegram Notification Security Hardening
-- ----------------------------------------------------------------------------

-- 3.1 Revoke public/anon execute on send_telegram_message
REVOKE EXECUTE ON FUNCTION public.send_telegram_message(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.send_telegram_message(text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.send_telegram_message(text, text) FROM authenticated;

-- Allow only internal database execution / service_role / postgres
GRANT EXECUTE ON FUNCTION public.send_telegram_message(text, text) TO service_role, postgres;

-- 3.2 Secure search_path and error handling on send_telegram_message
CREATE OR REPLACE FUNCTION public.send_telegram_message(
  message text,
  photo_url text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  telegram_token   text;
  telegram_chat_id text;
  final_url        text;
BEGIN
  -- 1. Fetch token and chat ID from app_config (case-insensitive)
  SELECT value INTO telegram_token
  FROM public.app_config
  WHERE lower(key) = 'telegram_bot_token' OR lower(key) = 'telegram_token'
  LIMIT 1;

  SELECT value INTO telegram_chat_id
  FROM public.app_config
  WHERE lower(key) = 'telegram_chat_id'
  LIMIT 1;

  -- 2. Safety guard: If credentials missing or revoked, exit silently without breaking business flow
  IF telegram_token IS NULL OR telegram_chat_id IS NULL OR telegram_token ILIKE '%REVOKED%' THEN
    RAISE NOTICE 'Telegram notification skipped: Bot credentials not configured or revoked.';
    RETURN;
  END IF;

  -- 3. Send photo message or text message via pg_net
  IF photo_url IS NOT NULL AND photo_url <> '' THEN
    final_url := 'https://api.telegram.org/bot' || telegram_token || '/sendPhoto';

    BEGIN
      PERFORM net.http_post(
        url := final_url,
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body := jsonb_build_object(
          'chat_id', telegram_chat_id,
          'photo', photo_url,
          'caption', message,
          'parse_mode', 'Markdown'
        )
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Telegram sendPhoto failed: %', SQLERRM;
    END;
  ELSE
    final_url := 'https://api.telegram.org/bot' || telegram_token || '/sendMessage';

    BEGIN
      PERFORM net.http_post(
        url := final_url,
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body := jsonb_build_object(
          'chat_id', telegram_chat_id,
          'text', message,
          'parse_mode', 'Markdown'
        )
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Telegram sendMessage failed: %', SQLERRM;
    END;
  END IF;

EXCEPTION WHEN OTHERS THEN
  -- Never abort caller transaction on notification failure
  RAISE NOTICE 'Telegram notification error swallowed: %', SQLERRM;
END;
$$;

-- 3.3 Set explicit search_path on notification trigger functions
ALTER FUNCTION public.send_order_to_telegram_fn() SET search_path = public, pg_temp;
ALTER FUNCTION public.send_reservation_to_telegram_fn() SET search_path = public, pg_temp;
ALTER FUNCTION public.send_feedback_to_telegram_fn() SET search_path = public, pg_temp;
ALTER FUNCTION public._escape_telegram_markdown(text) SET search_path = public, pg_temp;
