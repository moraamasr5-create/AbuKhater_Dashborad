-- =============================================================================
-- PRODUCTION SCHEMA SNAPSHOT — project AbuKhater (htpnxizfqmnnkhemvmdz)
-- Captured: 2026-06-22 (read-only introspection via Supabase management API)
-- Postgres: 17.6
--
-- ⚠️ This is a RECONSTRUCTED snapshot from live catalog introspection
--    (pg_constraint / pg_indexes / pg_trigger / pg_policies / information_schema /
--     pg_get_functiondef), NOT a pg_dump. Use it as a restore reference and as the
--    baseline for supabase/migrations. Before running ANY migration also take an
--    authoritative dump:  `supabase db dump --db-url "$PROD_DB_URL" -f backup.sql`
--    or use the Supabase Dashboard > Database > Backups.
--
-- KEY FINDINGS captured at snapshot time (see docs/MIGRATION_PLAN.md):
--   * Functions open_shift / close_shift / is_shift_operation_allowed /
--     _parse_time_minutes DO NOT EXIST in prod. The repo files
--     supabase/shift_governance.sql and supabase/close_shift_rpc.sql were
--     NEVER DEPLOYED. `shifts` is empty (0 rows). The app's open_shift/close_shift
--     rpc() calls currently fail and are swallowed by the offline wrapper.
--   * app_config holds SECRETS: keys = (telegram_bot_token, telegram_chat_id).
--     It has RLS ENABLED but NO POLICY (so anon cannot read it — keep it that way).
--     It does NOT contain shift_open_time / shift_close_time.
--   * RLS is "always true" for anon on all business tables (see policies below).
--   * order_items, customers, order_status_history, order_assignments,
--     order_events, driver_transactions, delivery_shift_logs, sync_queue,
--     notifications, profiles are all EMPTY (designed-but-unused).
-- =============================================================================

-- ----------------------------------------------------------------------------
-- EXTENSIONS (observed)
-- ----------------------------------------------------------------------------
-- uuid-ossp (uuid_generate_v4), pgcrypto (gen_random_uuid), http (in public — WARN)
-- NOTE: extension `http` is installed in schema public (security advisor 0014).

-- ----------------------------------------------------------------------------
-- TABLES (columns • defaults • nullability)
-- ----------------------------------------------------------------------------

-- orders ----------------------------------------------------------------------
-- id                    uuid     NOT NULL default gen_random_uuid()  [PK]
-- order_number          bigint   NOT NULL default nextval('orders_order_number_seq')
-- customer_name         text
-- customer_phone        text
-- customer_phone_2      text
-- order_type            text
-- total_amount          numeric
-- delivery_fee          numeric
-- service_fee           numeric
-- paid_now              numeric
-- remaining_amount      numeric
-- status                text                              -- free text (mixed AR/EN)
-- delivery_address      text
-- payment_method        text
-- payment_screenshot    text
-- latitude              numeric
-- longitude             numeric
-- raw_payload           jsonb
-- source                text
-- original_id           text
-- pilot_id              text                              -- redundant; no FK
-- pilot_name            text                              -- denormalized
-- delivery_id           bigint    -> delivery(id) ON UPDATE CASCADE ON DELETE SET NULL
-- shift_id              text      -> shifts(id)
-- delivery_shift_log_id bigint    -> delivery_shift_logs(id)
-- telegram_sent         boolean
-- cancel_telegram_sent  boolean
-- created_at            timestamptz

-- delivery (drivers) ----------------------------------------------------------
-- id               bigint NOT NULL [PK]
-- created_at       timestamptz NOT NULL
-- name             text
-- phone            text
-- number_motor     text
-- number_id        bigint                                -- national ID (PII)
-- start_shift      time
-- end_shift        time
-- id_delivery      smallint
-- shift_started_at timestamptz
-- shift_ended_at   timestamptz
-- state            text
-- last_return_time timestamptz
-- total_minutes    integer
-- orders_count     integer
-- shift_used       boolean

-- shifts ----------------------------------------------------------------------
-- id           text NOT NULL [PK]                        -- NOTE: text, not uuid
-- date         date
-- start_time   timestamptz
-- end_time     timestamptz
-- status       text
-- total_orders integer
-- stats        jsonb
-- created_at   timestamptz

-- order_items (EMPTY) ---------------------------------------------------------
-- id           uuid NOT NULL [PK]
-- order_id     uuid     -> orders(id) ON DELETE CASCADE
-- product_name text NOT NULL
-- quantity     integer
-- unit_price   numeric
-- total_price  numeric
-- created_at   timestamptz
-- item_id      uuid     -> menu_items(id) ON DELETE SET NULL

-- customers (EMPTY) -----------------------------------------------------------
-- id              uuid NOT NULL default gen_random_uuid() [PK]
-- full_name       text
-- phone           text  UNIQUE
-- phone_2         text
-- default_address text
-- notes           text
-- created_at      timestamptz default now()

-- profiles (EMPTY) — intended auth/RBAC link --------------------------------
-- id           uuid NOT NULL default gen_random_uuid() [PK]
-- auth_user_id uuid UNIQUE                                -- -> auth.users(id) (no FK yet)
-- full_name    text NOT NULL
-- role         text NOT NULL default 'staff'
-- is_active    boolean NOT NULL default true
-- created_at   timestamptz default now()

-- order_status_history (EMPTY) -----------------------------------------------
-- id         bigint NOT NULL [PK]
-- order_id   uuid NOT NULL -> orders(id) ON DELETE CASCADE
-- old_status text
-- new_status text NOT NULL
-- changed_by text
-- notes      text
-- created_at timestamptz

-- order_assignments (EMPTY) ---------------------------------------------------
-- id            bigint NOT NULL [PK]
-- order_id      uuid NOT NULL -> orders(id) ON DELETE CASCADE
-- delivery_id   bigint -> delivery(id) ON DELETE SET NULL
-- assigned_by   text
-- assigned_at   timestamptz
-- unassigned_at timestamptz
-- notes         text

-- order_events (EMPTY) --------------------------------------------------------
-- id         bigint NOT NULL [PK]
-- order_id   uuid NOT NULL -> orders(id) ON DELETE CASCADE
-- event_type text NOT NULL
-- event_data jsonb
-- created_at timestamptz

-- driver_transactions (EMPTY) -------------------------------------------------
-- id               bigint NOT NULL [PK]
-- delivery_id      bigint NOT NULL -> delivery(id) ON DELETE CASCADE
-- order_id         uuid   -> orders(id) ON DELETE SET NULL
-- shift_id         text   -> shifts(id) ON DELETE SET NULL
-- transaction_type text NOT NULL
-- amount           numeric NOT NULL
-- notes            text
-- created_at       timestamptz

-- delivery_shift_logs (EMPTY) -------------------------------------------------
-- id               bigint NOT NULL [PK]
-- delivery_id      bigint NOT NULL -> delivery(id) ON DELETE CASCADE
-- shift_started_at timestamptz NOT NULL
-- shift_ended_at   timestamptz
-- total_minutes    integer default 0
-- orders_count     integer default 0
-- total_value      numeric default 0
-- shift_id         text -> shifts(id)
-- created_at       timestamptz

-- sync_queue (EMPTY) — designed server-side offline queue ---------------------
-- id             uuid NOT NULL default gen_random_uuid() [PK]
-- entity_type    text NOT NULL
-- entity_id      text
-- operation_type text NOT NULL
-- payload        jsonb NOT NULL
-- status         text default 'pending'
-- retry_count    integer default 0
-- created_at     timestamptz default now()
-- processed_at   timestamptz

-- notifications (EMPTY) -------------------------------------------------------
-- id, notification_type text NOT NULL, target, title, message,
-- status default 'pending', payload jsonb, created_at, sent_at

-- reservations ----------------------------------------------------------------
-- id bigint [PK], customer_name, customer_phone, reservation_date date,
-- reservation_time time, guests_count int, location_type, notes,
-- status default 'pending', payment_proof_url, created_at,
-- deposit_amount numeric default 105, ref_number

-- feedback --------------------------------------------------------------------
-- id bigint [PK], full_name, phone, type, message, created_at

-- menu_items ------------------------------------------------------------------
-- id uuid [PK], category_id uuid -> categories(id), name NOT NULL,
-- description, price numeric default 0, image_url, unit_type default 'qty',
-- base_qty int default 1, status default 'available', is_popular bool,
-- display_order int, created_at, updated_at

-- categories ------------------------------------------------------------------
-- id uuid [PK], name UNIQUE NOT NULL, slug UNIQUE, display_order int, created_at

-- restaurant_settings ---------------------------------------------------------
-- id uuid [PK], key text UNIQUE NOT NULL, value text NOT NULL, updated_at

-- app_config ------------------------------------------------------------------
-- key text [PK], value text NOT NULL
-- ⚠️ Live rows: telegram_bot_token, telegram_chat_id  (SECRETS — keep RLS-locked)

-- ----------------------------------------------------------------------------
-- PRIMARY KEYS / UNIQUE / FOREIGN KEYS (pg_get_constraintdef)
-- ----------------------------------------------------------------------------
-- app_config_pkey                  PRIMARY KEY (key)
-- categories_pkey                  PRIMARY KEY (id)
-- categories_name_key              UNIQUE (name)
-- categories_slug_key              UNIQUE (slug)
-- customers_pkey                   PRIMARY KEY (id)
-- customers_phone_key              UNIQUE (phone)
-- delivery_pkey                    PRIMARY KEY (id)
-- delivery_shift_logs_pkey         PRIMARY KEY (id)
-- delivery_shift_logs.fk_delivery  FOREIGN KEY (delivery_id) REFERENCES delivery(id) ON DELETE CASCADE
-- delivery_shift_logs.fk_shift     FOREIGN KEY (shift_id) REFERENCES shifts(id)
-- driver_transactions_pkey         PRIMARY KEY (id)
-- driver_transactions_delivery_id_fkey FOREIGN KEY (delivery_id) REFERENCES delivery(id) ON DELETE CASCADE
-- driver_transactions_order_id_fkey    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL
-- driver_transactions_shift_id_fkey    FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE SET NULL
-- feedback_pkey                    PRIMARY KEY (id)
-- menu_items_pkey                  PRIMARY KEY (id)
-- menu_items_category_id_fkey      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
-- notifications_pkey               PRIMARY KEY (id)
-- order_assignments_pkey           PRIMARY KEY (id)
-- order_assignments_delivery_id_fkey FOREIGN KEY (delivery_id) REFERENCES delivery(id) ON DELETE SET NULL
-- order_assignments_order_id_fkey    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
-- order_events_pkey                PRIMARY KEY (id)
-- order_events_order_id_fkey       FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
-- order_items_pkey                 PRIMARY KEY (id)
-- order_items_item_id_fkey         FOREIGN KEY (item_id) REFERENCES menu_items(id) ON DELETE SET NULL
-- order_items_order_id_fkey        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
-- order_status_history_pkey        PRIMARY KEY (id)
-- order_status_history_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
-- orders_pkey                      PRIMARY KEY (id)
-- orders_delivery_id_fkey          FOREIGN KEY (delivery_id) REFERENCES delivery(id) ON UPDATE CASCADE ON DELETE SET NULL
-- orders_delivery_shift_log_id_fkey FOREIGN KEY (delivery_shift_log_id) REFERENCES delivery_shift_logs(id)
-- orders_shift_id_fkey             FOREIGN KEY (shift_id) REFERENCES shifts(id)
-- profiles_pkey                    PRIMARY KEY (id)
-- profiles_auth_user_id_key        UNIQUE (auth_user_id)
-- reservations_pkey                PRIMARY KEY (id)
-- restaurant_settings_pkey         PRIMARY KEY (id)
-- restaurant_settings_key_key      UNIQUE (key)
-- shifts_pkey                      PRIMARY KEY (id)
-- sync_queue_pkey                  PRIMARY KEY (id)

-- ----------------------------------------------------------------------------
-- INDEXES (non-PK/unique secondary indexes already present)
-- ----------------------------------------------------------------------------
-- idx_customers_phone               (customers.phone)
-- idx_delivery_state                (delivery.state)
-- idx_shift_logs_delivery_id        (delivery_shift_logs.delivery_id)
-- idx_driver_transactions_delivery  (driver_transactions.delivery_id)
-- idx_driver_transactions_shift     (driver_transactions.shift_id)
-- idx_menu_items_category_id        (menu_items.category_id)
-- idx_menu_items_status             (menu_items.status)
-- idx_order_assignments_delivery    (order_assignments.delivery_id)
-- idx_order_assignments_order       (order_assignments.order_id)
-- idx_order_events_order            (order_events.order_id)
-- idx_order_status_history_created  (order_status_history.created_at)
-- idx_order_status_history_order    (order_status_history.order_id)
-- idx_orders_created_at             (orders.created_at)
-- idx_orders_delivery_id            (orders.delivery_id)
-- idx_orders_shift_id               (orders.shift_id)
-- idx_orders_status                 (orders.status)
-- idx_profiles_role                 (profiles.role)

-- ----------------------------------------------------------------------------
-- TRIGGERS
-- ----------------------------------------------------------------------------
-- delivery     trg_calculate_shift_minutes              BEFORE UPDATE -> calculate_shift_minutes()
-- feedback     trigger_feedback_insert_telegram         BEFORE INSERT -> send_feedback_to_telegram_fn()
-- menu_items   update_menu_items_updated_at             BEFORE UPDATE -> update_updated_at_column()
-- orders       trigger_assign_shift_to_order            BEFORE INSERT -> assign_shift_to_new_order()
-- orders       trigger_order_insert_telegram            BEFORE INSERT -> send_order_to_telegram_fn()
-- orders       trigger_order_update_telegram            BEFORE UPDATE OF status WHEN (old<>new) -> send_order_to_telegram_fn()
-- orders       trigger_sync_delivery_shift              AFTER UPDATE OF status -> sync_delivery_shift_stats()
-- reservations trigger_reservation_insert_or_update_telegram AFTER INSERT OR UPDATE OF payment_proof_url -> send_reservation_to_telegram_fn()

-- ----------------------------------------------------------------------------
-- FUNCTIONS (inventory). Bodies for shift/financial logic captured below;
-- telegram/http helpers exist but bodies omitted (contain bot wiring).
-- ----------------------------------------------------------------------------
-- assign_order_to_pilot(p_order_id uuid, p_pilot_id bigint, p_pilot_name text)  [unused; writes status='assigned']
-- assign_shift_to_new_order() trigger
-- start_driver_shift(driver_id uuid)   [BROKEN: targets non-existent table `drivers`]
-- end_driver_shift(driver_id uuid)     [BROKEN: targets non-existent table `drivers`]
-- calculate_shift_minutes() trigger    [references delivery.status as boolean — see note]
-- sync_delivery_shift_stats() trigger
-- update_updated_at_column() trigger
-- build_order_telegram_message(...), send_order_to_telegram_fn(),
-- send_feedback_to_telegram_fn(), send_reservation_to_telegram_fn(),
-- send_telegram_message(message text, photo_url text)  [SECURITY DEFINER, anon-callable — WARN]
-- rls_auto_enable() event trigger fn   [SECURITY DEFINER, anon-callable as rpc — WARN]
-- http*/urlencode*/bytea_to_text/text_to_bytea  (http extension helpers)
--
-- ❌ NOT PRESENT (repo files never deployed):
--    open_shift(uuid, date, timestamptz)
--    close_shift(uuid, jsonb[, boolean])
--    is_shift_operation_allowed(text, boolean)
--    _parse_time_minutes(text, integer)

-- calculate_shift_minutes() — NOTE: compares delivery.status to boolean true/false,
-- but delivery has no boolean `status` column in this snapshot (it has `state` text +
-- shift_started_at/shift_ended_at). Trigger is effectively a no-op / latent mismatch.
/*
CREATE OR REPLACE FUNCTION public.calculate_shift_minutes()
 RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        IF NEW.status = false AND OLD.status = true THEN
            IF OLD.shift_started_at IS NOT NULL THEN
                NEW.total_minutes := COALESCE(OLD.total_minutes, 0) +
                    ROUND(EXTRACT(EPOCH FROM (now() - OLD.shift_started_at)) / 60.0)::INTEGER;
            END IF;
            NEW.shift_started_at := NULL;
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;
*/

/*
CREATE OR REPLACE FUNCTION public.sync_delivery_shift_stats()
 RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
    IF (NEW.status = 'delivered' AND NEW.delivery_shift_log_id IS NOT NULL) THEN
        UPDATE public.delivery_shift_logs
        SET orders_count = (SELECT COUNT(*) FROM public.orders
                            WHERE delivery_shift_log_id = NEW.delivery_shift_log_id AND status = 'delivered'),
            total_value  = (SELECT COALESCE(SUM(total_amount),0) FROM public.orders
                            WHERE delivery_shift_log_id = NEW.delivery_shift_log_id AND status = 'delivered')
        WHERE id = NEW.delivery_shift_log_id;
    END IF;
    RETURN NEW;
END;
$function$;
*/

/*
CREATE OR REPLACE FUNCTION public.assign_order_to_pilot(p_order_id uuid, p_pilot_id bigint, p_pilot_name text)
 RETURNS void LANGUAGE plpgsql AS $function$
begin
  if exists (select 1 from public.delivery where id = p_pilot_id and state = 'busy') then
    raise exception 'Pilot is already busy';
  end if;
  update public.delivery set state = 'busy', last_return_time = now() where id = p_pilot_id;
  update public.orders set pilot_id = p_pilot_id::text, pilot_name = p_pilot_name, status = 'assigned'
  where id = p_order_id;
end;
$function$;
*/

/*
CREATE OR REPLACE FUNCTION public.assign_shift_to_new_order()
 RETURNS trigger LANGUAGE plpgsql AS $function$
declare v_shift_id text;
begin
    if new.shift_id is not null then return new; end if;
    select id into v_shift_id from shifts where status = 'open' order by created_at desc limit 1;
    if v_shift_id is not null then new.shift_id := v_shift_id; end if;
    return new;
end;
$function$;
*/

-- ----------------------------------------------------------------------------
-- RLS — enabled on ALL public tables. Policies (pg_policies):
-- ----------------------------------------------------------------------------
-- categories : SELECT/INSERT/UPDATE public USING/CHECK true (5 overlapping policies)
-- menu_items : SELECT/INSERT/UPDATE public USING/CHECK true (5 overlapping policies)
-- orders     : SELECT true; INSERT check true (x2); UPDATE using/check true
-- reservations: SELECT/INSERT(x3)/UPDATE public true
-- delivery   : SELECT/INSERT/UPDATE public true
-- shifts     : SELECT/INSERT/UPDATE {anon,authenticated} true; INSERT authenticated true
-- feedback   : SELECT/INSERT/DELETE public true; INSERT authenticated true
-- NO POLICIES (RLS on, deny-all): app_config, customers, delivery_shift_logs,
--   driver_transactions, notifications, order_assignments, order_events,
--   order_items, order_status_history, profiles, restaurant_settings, sync_queue

-- ----------------------------------------------------------------------------
-- STORAGE
-- ----------------------------------------------------------------------------
-- bucket: payment-screenshots  (PUBLIC)
--   policy "Allow public read access"  SELECT public  USING (bucket_id='payment-screenshots')  -- listable (WARN)
--   policy "Allow public upload"       INSERT public  WITH CHECK (bucket_id='payment-screenshots')

-- =============================================================================
-- END SNAPSHOT
-- =============================================================================
