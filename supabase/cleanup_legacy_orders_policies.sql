-- Cleanup all legacy insecure policies on orders and order_items
DROP POLICY IF EXISTS "Allow insert orders" ON public.orders;
DROP POLICY IF EXISTS "Allow public update on orders" ON public.orders;
DROP POLICY IF EXISTS "Allow select orders" ON public.orders;
DROP POLICY IF EXISTS "Public can only insert orders" ON public.orders;
DROP POLICY IF EXISTS "Allow dashboard all on orders" ON public.orders;
DROP POLICY IF EXISTS "Allow anon all on orders" ON public.orders;
DROP POLICY IF EXISTS "orders_delete_admin" ON public.orders;

CREATE POLICY "orders_delete_admin" ON public.orders
  FOR DELETE TO authenticated
  USING (public.has_role('admin'));

DROP POLICY IF EXISTS "Allow insert order_items" ON public.order_items;
DROP POLICY IF EXISTS "Allow select order_items" ON public.order_items;
DROP POLICY IF EXISTS "Allow public update on order_items" ON public.order_items;
DROP POLICY IF EXISTS "Allow dashboard all on order_items" ON public.order_items;
DROP POLICY IF EXISTS "order_items_delete_admin" ON public.order_items;

CREATE POLICY "order_items_delete_admin" ON public.order_items
  FOR DELETE TO authenticated
  USING (public.has_role('admin'));
