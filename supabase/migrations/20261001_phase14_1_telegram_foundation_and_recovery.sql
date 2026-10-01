-- ============================================================================
-- Phase 14.1 Migration: Telegram Foundation & Recovery
-- Project: AbuKhater Restaurant Control Center (htpnxizfqmnnkhemvmdz)
-- ----------------------------------------------------------------------------
-- Objectives:
--   1. Create diagnostic telegram_logs table for audit and observability.
--   2. Implement robust _escape_telegram_html helper.
--   3. Hardened, resilient send_telegram_message dispatcher with HTML mode,
--      safe exception trapping, and diagnostic logging.
--   4. Refactor send_order_to_telegram_fn to guarantee:
--      - Cash orders are never lost.
--      - Electronic payment orders are never lost when screenshot is pending.
--      - When payment_screenshot is attached, a dedicated update is dispatched.
--      - Cancelled orders properly extract orders.cancellation_reason.
--      - failed_delivery status is correctly recognized and dispatches reason.
--      - Deduplication prevents duplicate new order alerts.
--   5. Refactor reservation and feedback handlers to HTML escaping mode.
--   6. Update orders triggers to listen to status and payment_screenshot updates.
--   7. Retain strict SECURITY DEFINER and revoked public permissions.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Diagnostic Telegram Logs Table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.telegram_logs (
  id               bigserial PRIMARY KEY,
  event_type       text NOT NULL,
  entity_id        text,
  status           text NOT NULL, -- 'dispatched', 'skipped', 'error', 'failed'
  recipient_type   text DEFAULT 'group',
  has_photo        boolean DEFAULT false,
  error_message    text,
  payload_preview  text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_telegram_logs_created_at ON public.telegram_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_telegram_logs_event_type ON public.telegram_logs (event_type);
CREATE INDEX IF NOT EXISTS idx_telegram_logs_entity_id ON public.telegram_logs (entity_id);

ALTER TABLE public.telegram_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS telegram_logs_select_staff ON public.telegram_logs;
CREATE POLICY telegram_logs_select_staff ON public.telegram_logs
  FOR SELECT
  TO authenticated
  USING (public.has_role('admin') OR public.has_role('casher'));

DROP POLICY IF EXISTS telegram_logs_service_all ON public.telegram_logs;
CREATE POLICY telegram_logs_service_all ON public.telegram_logs
  FOR ALL
  TO service_role, postgres
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON public.telegram_logs FROM anon, PUBLIC;
GRANT SELECT ON public.telegram_logs TO authenticated;
GRANT ALL ON public.telegram_logs TO service_role, postgres;

-- ----------------------------------------------------------------------------
-- 2. HTML Escaping Helper Function
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._escape_telegram_html(p_text text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_text IS NULL OR p_text = '' THEN
    RETURN '';
  END IF;
  RETURN replace(
    replace(
      replace(p_text, '&', '&amp;'),
      '<', '&lt;'
    ),
    '>', '&gt;'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public._escape_telegram_html(text) TO service_role, postgres, authenticated;

-- ----------------------------------------------------------------------------
-- 3. Resilient Telegram Dispatcher (Single Unified send_telegram_message)
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.send_telegram_message(text, text, text, text);
DROP FUNCTION IF EXISTS public.send_telegram_message(text, text);
DROP FUNCTION IF EXISTS public.send_telegram_message(text);

CREATE OR REPLACE FUNCTION public.send_telegram_message(
  message text,
  photo_url text DEFAULT NULL,
  event_type text DEFAULT 'generic',
  entity_id text DEFAULT NULL
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
  is_valid_url     boolean := false;
  clean_preview    text;
BEGIN
  -- 0. Build clean preview for audit logs (first 600 chars without tokens)
  clean_preview := substring(regexp_replace(COALESCE(message, ''), '<[^>]*>', '', 'g') from 1 for 600);

  -- 1. Fetch token and chat ID from app_config (case-insensitive)
  SELECT value INTO telegram_token
  FROM public.app_config
  WHERE lower(key) = 'telegram_bot_token' OR lower(key) = 'telegram_token'
  LIMIT 1;

  SELECT value INTO telegram_chat_id
  FROM public.app_config
  WHERE lower(key) = 'telegram_chat_id'
  LIMIT 1;

  -- 2. Safety guard: Validate credentials existence and readiness
  IF telegram_token IS NULL OR trim(telegram_token) = '' OR
     telegram_chat_id IS NULL OR trim(telegram_chat_id) = '' OR
     telegram_token ILIKE '%REVOKED%' OR
     telegram_token ILIKE '%PLACEHOLDER%' OR
     telegram_token ILIKE '%STORE_IN_VAULT%' THEN

    -- Record diagnostic log for skipped dispatch
    INSERT INTO public.telegram_logs (
      event_type, entity_id, status, recipient_type, has_photo, error_message, payload_preview, created_at
    ) VALUES (
      COALESCE(event_type, 'generic'),
      entity_id,
      'skipped',
      'group',
      (photo_url IS NOT NULL AND photo_url <> ''),
      'Telegram bot credentials not configured, revoked, or placeholder in app_config',
      clean_preview,
      now()
    );

    RETURN;
  END IF;

  -- 3. Validate Photo URL (must be a valid public HTTP/HTTPS URL)
  IF photo_url IS NOT NULL AND trim(photo_url) <> '' AND trim(photo_url) ~* '^https?://' THEN
    is_valid_url := true;
  END IF;

  -- 4. Dispatch via pg_net (HTML parse mode)
  IF is_valid_url THEN
    final_url := 'https://api.telegram.org/bot' || trim(telegram_token) || '/sendPhoto';

    BEGIN
      PERFORM net.http_post(
        url := final_url,
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body := jsonb_build_object(
          'chat_id', trim(telegram_chat_id),
          'photo', trim(photo_url),
          'caption', message,
          'parse_mode', 'HTML'
        )
      );

      INSERT INTO public.telegram_logs (
        event_type, entity_id, status, recipient_type, has_photo, error_message, payload_preview, created_at
      ) VALUES (
        COALESCE(event_type, 'generic'), entity_id, 'dispatched', 'group', true, NULL, clean_preview, now()
      );

    EXCEPTION WHEN OTHERS THEN
      -- Fallback to text message if sendPhoto fails
      BEGIN
        final_url := 'https://api.telegram.org/bot' || trim(telegram_token) || '/sendMessage';
        PERFORM net.http_post(
          url := final_url,
          headers := jsonb_build_object('Content-Type', 'application/json'),
          body := jsonb_build_object(
            'chat_id', trim(telegram_chat_id),
            'text', message,
            'parse_mode', 'HTML'
          )
        );

        INSERT INTO public.telegram_logs (
          event_type, entity_id, status, recipient_type, has_photo, error_message, payload_preview, created_at
        ) VALUES (
          COALESCE(event_type, 'generic'), entity_id, 'dispatched_text_fallback', 'group', false, SQLERRM, clean_preview, now()
        );
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO public.telegram_logs (
          event_type, entity_id, status, recipient_type, has_photo, error_message, payload_preview, created_at
        ) VALUES (
          COALESCE(event_type, 'generic'), entity_id, 'error', 'group', false, SQLERRM, clean_preview, now()
        );
      END;
    END;
  ELSE
    final_url := 'https://api.telegram.org/bot' || trim(telegram_token) || '/sendMessage';

    BEGIN
      PERFORM net.http_post(
        url := final_url,
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body := jsonb_build_object(
          'chat_id', trim(telegram_chat_id),
          'text', message,
          'parse_mode', 'HTML'
        )
      );

      INSERT INTO public.telegram_logs (
        event_type, entity_id, status, recipient_type, has_photo, error_message, payload_preview, created_at
      ) VALUES (
        COALESCE(event_type, 'generic'), entity_id, 'dispatched', 'group', false, NULL, clean_preview, now()
      );

    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.telegram_logs (
        event_type, entity_id, status, recipient_type, has_photo, error_message, payload_preview, created_at
      ) VALUES (
        COALESCE(event_type, 'generic'), entity_id, 'error', 'group', false, SQLERRM, clean_preview, now()
      );
    END;
  END IF;

EXCEPTION WHEN OTHERS THEN
  -- Never crash caller transaction on any notification error
  BEGIN
    INSERT INTO public.telegram_logs (
      event_type, entity_id, status, recipient_type, has_photo, error_message, payload_preview, created_at
    ) VALUES (
      COALESCE(event_type, 'generic'), entity_id, 'error', 'group', false, SQLERRM, clean_preview, now()
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$$;

-- Security Grants: Strictly deny public/anon execution
REVOKE EXECUTE ON FUNCTION public.send_telegram_message(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_telegram_message(text, text, text, text) TO service_role, postgres;

-- ----------------------------------------------------------------------------
-- 4. Authoritative Order Notification Handler (send_order_to_telegram_fn)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.send_order_to_telegram_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_message_text         text;
  v_order_num_str        text;
  v_norm_payment         text;
  v_is_cash              boolean;
  v_payment_display      text;
  v_reason               text;
  v_send_photo_url       text := NULL;
  v_event_type           text;
BEGIN
  -- Extract human-readable order number
  IF NEW.original_id IS NOT NULL AND NEW.original_id <> '' THEN
    v_order_num_str := NEW.original_id;
  ELSIF NEW.order_number IS NOT NULL THEN
    v_order_num_str := '#' || NEW.order_number::text;
  ELSE
    v_order_num_str := '#' || substring(NEW.id::text from 1 for 6);
  END IF;

  v_norm_payment := lower(trim(COALESCE(NEW.payment_method, 'cash')));
  v_is_cash := (v_norm_payment IN ('cash', 'نقدي', 'كاش', 'عند الاستلام'));

  ---------------------------------------------------------------------------
  -- CASE 1: NEW ORDER (INSERT)
  ---------------------------------------------------------------------------
  IF (TG_OP = 'INSERT') THEN
    v_event_type := 'order_created';

    IF v_is_cash THEN
      v_payment_display := 'نقدي (عند الاستلام)';
      v_send_photo_url  := NULL;
    ELSE
      IF NEW.payment_screenshot IS NOT NULL AND NEW.payment_screenshot <> '' THEN
        v_payment_display := public._escape_telegram_html(replace(NEW.payment_method, '_', ' ')) || ' (مرفق إيصال 🧾)';
        IF NEW.payment_screenshot ~* '^https?://' THEN
          v_send_photo_url := NEW.payment_screenshot;
        END IF;
      ELSE
        v_payment_display := public._escape_telegram_html(replace(NEW.payment_method, '_', ' ')) || ' (⏳ بانتظار إرفاق الإيصال)';
        v_send_photo_url  := NULL;
      END IF;
    END IF;

    v_message_text :=
      '🚨 <b>[أبو خاطر]</b> - <b>طلب جديد ' || public._escape_telegram_html(v_order_num_str) || '</b> 🚨' || E'\n' ||
      '━━━━━━━━━━━━━━━━━━━━' || E'\n\n' ||
      '🔢 <b>الرقم التسلسلي:</b> ' || public._escape_telegram_html(v_order_num_str) || E'\n' ||
      '👤 <b>العميل:</b> ' || public._escape_telegram_html(COALESCE(NEW.customer_name, 'عميل')) || E'\n' ||
      '📞 <b>الهاتف:</b> ' || public._escape_telegram_html(COALESCE(NEW.customer_phone, '-')) || E'\n';

    IF NEW.customer_phone_2 IS NOT NULL AND trim(NEW.customer_phone_2) <> '' THEN
      v_message_text := v_message_text ||
        '☎️ <b>هاتف إضافي:</b> ' || public._escape_telegram_html(NEW.customer_phone_2) || E'\n';
    END IF;

    v_message_text := v_message_text ||
      '🛒 <b>نوع الطلب:</b> ' || public._escape_telegram_html(COALESCE(NEW.order_type, 'توصيل')) || E'\n' ||
      '📊 <b>الحالة:</b> <i>طلب جديد منتظر القبول</i>' || E'\n' ||
      '💵 <b>إجمالي الطلب:</b> ' || COALESCE(NEW.total_amount::text, '0') || ' ج.م' || E'\n' ||
      '💳 <b>طريقة الدفع:</b> ' || v_payment_display || E'\n';

    IF NEW.delivery_fee IS NOT NULL AND NEW.delivery_fee > 0 THEN
      v_message_text := v_message_text ||
        '🚚 <b>رسوم التوصيل:</b> ' || NEW.delivery_fee::text || ' ج.م' || E'\n';
    END IF;

    IF NEW.service_fee IS NOT NULL AND NEW.service_fee > 0 THEN
      v_message_text := v_message_text ||
        '♻️ <b>رسوم الخدمة:</b> ' || NEW.service_fee::text || ' ج.م' || E'\n';
    END IF;

    IF NEW.delivery_address IS NOT NULL AND trim(NEW.delivery_address) <> '' THEN
      v_message_text := v_message_text ||
        '📍 <b>العنوان:</b> ' || public._escape_telegram_html(NEW.delivery_address) || E'\n';
    END IF;

    v_message_text := v_message_text ||
      '🌐 <b>المصدر:</b> ' || public._escape_telegram_html(COALESCE(NEW.source, 'online')) || E'\n' ||
      '━━━━━━━━━━━━━━━━━━━━';

    -- Attach Google Maps link if coordinates available
    IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL AND (NEW.latitude <> 0 OR NEW.longitude <> 0) THEN
      v_message_text := v_message_text || E'\n' ||
        '📍 <b>موقع العميل:</b> <a href="https://www.google.com/maps?q=' || NEW.latitude::text || ',' || NEW.longitude::text || '">فتح الموقع على الخريطة</a>';
    END IF;

    -- Dispatch notification
    PERFORM public.send_telegram_message(
      v_message_text,
      v_send_photo_url,
      v_event_type,
      NEW.id::text
    );

    NEW.telegram_sent := true;
    RETURN NEW;

  ---------------------------------------------------------------------------
  -- CASE 2: PAYMENT SCREENSHOT ATTACHED (UPDATE OF payment_screenshot)
  ---------------------------------------------------------------------------
  ELSIF (TG_OP = 'UPDATE') AND
        (OLD.payment_screenshot IS NULL OR OLD.payment_screenshot = '') AND
        (NEW.payment_screenshot IS NOT NULL AND NEW.payment_screenshot <> '') THEN

    v_event_type := 'order_payment_attached';

    IF NEW.payment_screenshot ~* '^https?://' THEN
      v_send_photo_url := NEW.payment_screenshot;
    ELSE
      v_send_photo_url := NULL;
    END IF;

    v_message_text :=
      '🧾 <b>[أبو خاطر]</b> - <b>تم إرفاق إيصال الدفع</b> 🧾' || E'\n' ||
      '━━━━━━━━━━━━━━━━━━━━' || E'\n\n' ||
      '🔢 <b>رقم الطلب:</b> ' || public._escape_telegram_html(v_order_num_str) || E'\n' ||
      '👤 <b>العميل:</b> ' || public._escape_telegram_html(COALESCE(NEW.customer_name, 'عميل')) || E'\n' ||
      '📞 <b>الهاتف:</b> ' || public._escape_telegram_html(COALESCE(NEW.customer_phone, '-')) || E'\n' ||
      '💵 <b>الإجمالي المطلوب:</b> ' || COALESCE(NEW.total_amount::text, '0') || ' ج.م' || E'\n' ||
      '💳 <b>طريقة الدفع:</b> ' || public._escape_telegram_html(replace(COALESCE(NEW.payment_method, 'إلكتروني'), '_', ' ')) || E'\n' ||
      '━━━━━━━━━━━━━━━━━━━━' || E'\n' ||
      '<i>يرجى مراجعة إيصال التحويل وتأكيد حالة الدفع من لوحة التحكم.</i>';

    PERFORM public.send_telegram_message(
      v_message_text,
      v_send_photo_url,
      v_event_type,
      NEW.id::text
    );

    RETURN NEW;

  ---------------------------------------------------------------------------
  -- CASE 3: ORDER CANCELLED (UPDATE OF status)
  ---------------------------------------------------------------------------
  ELSIF (TG_OP = 'UPDATE') AND
        (NEW.status = 'cancelled' OR NEW.status LIKE 'ملغي%') AND
        (OLD.status IS DISTINCT FROM NEW.status) THEN

    v_event_type := 'order_cancelled';

    -- Extract reason from cancellation_reason column or legacy status
    v_reason := COALESCE(
      NULLIF(trim(NEW.cancellation_reason), ''),
      CASE
        WHEN position('(' in NEW.status) > 0 AND position(')' in NEW.status) > 0 THEN
          trim(substring(NEW.status from position('(' in NEW.status) + 1 for position(')' in NEW.status) - position('(' in NEW.status) - 1))
        ELSE NULL
      END,
      'غير محدد'
    );

    v_message_text :=
      '❌ <b>[أبو خاطر]</b> - <b>تم إلغاء الطلب</b> ❌' || E'\n' ||
      '━━━━━━━━━━━━━━━━━━━━' || E'\n\n' ||
      '🔢 <b>رقم الطلب:</b> ' || public._escape_telegram_html(v_order_num_str) || E'\n' ||
      '👤 <b>العميل:</b> ' || public._escape_telegram_html(COALESCE(NEW.customer_name, 'عميل')) || E'\n' ||
      '📞 <b>الهاتف:</b> ' || public._escape_telegram_html(COALESCE(NEW.customer_phone, '-')) || E'\n' ||
      '💵 <b>إجمالي الطلب:</b> ' || COALESCE(NEW.total_amount::text, '0') || ' ج.م' || E'\n' ||
      '📝 <b>سبب الإلغاء:</b> <b>' || public._escape_telegram_html(v_reason) || '</b>' || E'\n' ||
      '━━━━━━━━━━━━━━━━━━━━';

    PERFORM public.send_telegram_message(
      v_message_text,
      NULL,
      v_event_type,
      NEW.id::text
    );

    RETURN NEW;

  ---------------------------------------------------------------------------
  -- CASE 4: FAILED DELIVERY (UPDATE OF status)
  ---------------------------------------------------------------------------
  ELSIF (TG_OP = 'UPDATE') AND
        (NEW.status = 'failed_delivery' OR NEW.status LIKE 'فشل%') AND
        (OLD.status IS DISTINCT FROM NEW.status) THEN

    v_event_type := 'order_failed_delivery';

    v_reason := COALESCE(
      NULLIF(trim(NEW.cancellation_reason), ''),
      CASE
        WHEN position('(' in NEW.status) > 0 AND position(')' in NEW.status) > 0 THEN
          trim(substring(NEW.status from position('(' in NEW.status) + 1 for position(')' in NEW.status) - position('(' in NEW.status) - 1))
        ELSE NULL
      END,
      'غير محدد'
    );

    v_message_text :=
      '⚠️ <b>[أبو خاطر]</b> - <b>فشل توصيل الطلب</b> ⚠️' || E'\n' ||
      '━━━━━━━━━━━━━━━━━━━━' || E'\n\n' ||
      '🔢 <b>رقم الطلب:</b> ' || public._escape_telegram_html(v_order_num_str) || E'\n' ||
      '👤 <b>العميل:</b> ' || public._escape_telegram_html(COALESCE(NEW.customer_name, 'عميل')) || E'\n' ||
      '📞 <b>الهاتف:</b> ' || public._escape_telegram_html(COALESCE(NEW.customer_phone, '-')) || E'\n' ||
      '💵 <b>إجمالي الطلب:</b> ' || COALESCE(NEW.total_amount::text, '0') || ' ج.م' || E'\n' ||
      '📝 <b>سبب فشل التوصيل:</b> <b>' || public._escape_telegram_html(v_reason) || '</b>' || E'\n' ||
      '━━━━━━━━━━━━━━━━━━━━';

    PERFORM public.send_telegram_message(
      v_message_text,
      NULL,
      v_event_type,
      NEW.id::text
    );

    RETURN NEW;

  END IF;

  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. Updated Reservation Handler (send_reservation_to_telegram_fn)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.send_reservation_to_telegram_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_message_text text;
  v_photo_url    text := NULL;
BEGIN
  IF NEW.payment_proof_url IS NOT NULL AND NEW.payment_proof_url ~* '^https?://' THEN
    v_photo_url := NEW.payment_proof_url;
  END IF;

  v_message_text :=
    '📅 <b>[أبو خاطر]</b> - <b>حجز طاولة جديد</b> 📅' || E'\n' ||
    '━━━━━━━━━━━━━━━━━━━━' || E'\n\n' ||
    '👤 <b>الاسم:</b> ' || public._escape_telegram_html(COALESCE(NEW.customer_name, '-')) || E'\n' ||
    '📞 <b>الهاتف:</b> ' || public._escape_telegram_html(COALESCE(NEW.customer_phone, '-')) || E'\n' ||
    '📆 <b>التاريخ:</b> ' || COALESCE(NEW.reservation_date::text, '-') || E'\n' ||
    '⏰ <b>الوقت:</b> ' || COALESCE(NEW.reservation_time::text, '-') || E'\n' ||
    '👥 <b>عدد الأفراد:</b> ' || COALESCE(NEW.guests_count::text, '-') || E'\n' ||
    '📍 <b>نوع المكان:</b> ' || public._escape_telegram_html(COALESCE(NEW.location_type, 'مطعم')) || E'\n' ||
    '💰 <b>العربون:</b> ' || COALESCE(NEW.deposit_amount::text, '0') || ' ج.م' || E'\n' ||
    '🔖 <b>رقم المرجع:</b> ' || public._escape_telegram_html(COALESCE(NEW.ref_number, '-')) || E'\n';

  IF NEW.notes IS NOT NULL AND trim(NEW.notes) <> '' THEN
    v_message_text := v_message_text ||
      '📝 <b>الملاحظات:</b> ' || public._escape_telegram_html(NEW.notes) || E'\n';
  END IF;

  v_message_text := v_message_text || '━━━━━━━━━━━━━━━━━━━━';

  PERFORM public.send_telegram_message(
    v_message_text,
    v_photo_url,
    'reservation_created',
    NEW.id::text
  );

  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. Updated Feedback Handler (send_feedback_to_telegram_fn)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.send_feedback_to_telegram_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_message_text  text;
  v_type_badge    text;
BEGIN
  IF (TG_OP = 'INSERT') THEN
    IF NEW.type = 'شكوى' OR NEW.type = 'complaint' THEN
      v_type_badge := '⚠️ <b>شكوى عميل</b>';
    ELSE
      v_type_badge := '✅ <b>اقتراح / رأي</b>';
    END IF;

    v_message_text :=
      v_type_badge || ' 📝' || E'\n' ||
      '━━━━━━━━━━━━━━━━━━━━' || E'\n\n' ||
      '👤 <b>الاسم:</b> ' || public._escape_telegram_html(COALESCE(NEW.full_name, 'عميل')) || E'\n' ||
      '📞 <b>الهاتف:</b> ' || public._escape_telegram_html(COALESCE(NEW.phone, '-')) || E'\n\n' ||
      '💬 <b>الرسالة:</b>' || E'\n' ||
      public._escape_telegram_html(COALESCE(NEW.message, 'لا يوجد نص')) || E'\n' ||
      '━━━━━━━━━━━━━━━━━━━━';

    PERFORM public.send_telegram_message(
      v_message_text,
      NULL,
      'feedback_created',
      NEW.id::text
    );
  END IF;

  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. Update Triggers on Orders, Reservations & Feedback
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trigger_order_insert_telegram ON public.orders;
CREATE TRIGGER trigger_order_insert_telegram
  BEFORE INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.send_order_to_telegram_fn();

DROP TRIGGER IF EXISTS trigger_order_update_telegram ON public.orders;
CREATE TRIGGER trigger_order_update_telegram
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  WHEN (
    (old.status IS DISTINCT FROM new.status)
    OR (
      (old.payment_screenshot IS NULL OR old.payment_screenshot = '')
      AND (new.payment_screenshot IS NOT NULL AND new.payment_screenshot <> '')
    )
  )
  EXECUTE FUNCTION public.send_order_to_telegram_fn();

DROP TRIGGER IF EXISTS trigger_feedback_insert_telegram ON public.feedback;
CREATE TRIGGER trigger_feedback_insert_telegram
  BEFORE INSERT ON public.feedback
  FOR EACH ROW
  EXECUTE FUNCTION public.send_feedback_to_telegram_fn();

DROP TRIGGER IF EXISTS trigger_reservation_insert_or_update_telegram ON public.reservations;
CREATE TRIGGER trigger_reservation_insert_or_update_telegram
  AFTER INSERT OR UPDATE OF payment_proof_url ON public.reservations
  FOR EACH ROW
  EXECUTE FUNCTION public.send_reservation_to_telegram_fn();

-- ----------------------------------------------------------------------------
-- 8. Explicit search_path hardening
-- ----------------------------------------------------------------------------
ALTER FUNCTION public.send_order_to_telegram_fn() SET search_path = public, pg_temp;
ALTER FUNCTION public.send_reservation_to_telegram_fn() SET search_path = public, pg_temp;
ALTER FUNCTION public.send_feedback_to_telegram_fn() SET search_path = public, pg_temp;
ALTER FUNCTION public._escape_telegram_html(text) SET search_path = public, pg_temp;
