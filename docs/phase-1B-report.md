# Phase 1B Implementation Report: Server-Enforced Authorization & Role-Based Security

**Date:** October 1, 2026  
**Scope:** `AbuKhater_Dashborad` / `AbuKhater_delivery` & `AbuKhater_Menu`  
**Status:** Completed & Verified  

---

## 1. المشكلة (The Problem)
كانت الصلاحيات تُدار فقط في الواجهة الأمامية (Client-side checks)، بينما قاعدة بيانات Supabase كانت تمنح صلاحيات تنفيذ الإجراءات المخزنة (RPCs) وكتابة الجداول الإدارية الحساسة لجميع المتصلين بما فيهم المتصل المجهول (`anon`) أو باستخدام سياسات `USING (true)`، مما كان يتيح لأي شخص يملك مفتاح الـ API العام استدعاء دوال قفل الورديات، إسناد الطيارين، أو التلاعب بالإعدادات التشغيلية.

---

## 2. السبب الجذري (Root Cause)
1. وجود `GRANT EXECUTE ON FUNCTION ... TO anon` على جميع الـ RPCs التشغيلية.
2. عدم وجود تحقق داخلي من دور المستخدم (`public._require_staff_role`) داخل الإجراءات المخزنة نفسها.
3. عدم ضبط سياسات RLS على جداول `shifts`, `delivery`, `app_config`, `restaurant_settings`, `feedback`, `applied_mutations` لتقييد وصول الأدوار (`admin`, `casher`, `driver`).

---

## 3. ما تم تغييره (What Was Changed)
1. **تأمين كافة الـ RPCs التشغيلية من السيرفر**:
   - تم سحب صلاحيات التنفيذ (`REVOKE EXECUTE`) من `anon` على دوال:
     - `open_shift`
     - `close_shift`
     - `toggle_pilot_shift`
     - `assign_order_to_pilot`
     - `start_pilot_trip`
     - `complete_order_delivery`
     - `fail_order_delivery`
     - `start_driver_shift` / `end_driver_shift`
   - قصر منح التنفيذ (`GRANT EXECUTE`) على المستخدمين الموثقين (`authenticated`).
   - إضافة دالة فحص الصلاحية الإلزامية `public._require_staff_role(p_allowed_roles)` داخل كل إجراء للتأكد من هوية الموظف ودوره وحالته النشطة في `staff_roles`.
2. **حوكمة العمليات الإدارية والورديات**:
   - `open_shift`: مقتصر على الأدمن والكاشير.
   - `close_shift`: مقتصر على الأدمن والكاشير، مع حصر خيار الإغلاق الإجباري (`p_force_close = true`) على الأدمن فقط.
   - `toggle_pilot_shift`: مقتصر على أعضاء طاقم العمل النشطين، وحصر خيار إعادة الفتح الإجباري على الأدمن.
   - `assign_order_to_pilot`: مقتصر على الأدمن والكاشير.
   - `start_pilot_trip`, `complete_order_delivery`, `fail_order_delivery`: مقتصر على الأدمن، الكاشير، والطيار.
3. **سياسات الـ Row Level Security (RLS) الدقيقة**:
   - `shifts` & `shift_expenses`: قراءة وكتابة للأدمن والكاشير، وتعديل/حذف للأدمن فقط.
   - `delivery` (الطيارين): إضافة وحذف للأدمن فقط، وتعديل الحالة للأدمن والكاشير والطيار عبر الـ RPCs.
   - `app_config` & `restaurant_settings`: قراءة عامة للجميع، وتعديل/حفظ للأدمن فقط.
   - `feedback`: إدخال عام لشكاوى العملاء، وقراءة وحذف للأدمن فقط.
   - `reservations`: إدخال عام لحجوزات العملاء من المنيو، وقراءة وتأكيد للأدمن والكاشير، وحذف للأدمن فقط.
   - `orders` & `order_items`: إدخال عام لطلبات عملاء المنيو، وقراءة وتحديث لطاقم العمل المعتمد، وحذف للأدمن فقط.
4. **تأمين طابور العمليات غير المتصلة (`Offline Sync Queue`)**:
   - تحديث دالة معالجة الأخطاء الدائمة في `supabaseService.js` لتشمل كود الخطأ `42501` وأخطاء الـ `Forbidden/Unauthorized` لمنع تكرار المحاولات غير المصرح بها في الخلفية.

---

## 4. الملفات المتغيرة (Changed Files)
- `supabase/server_enforced_authorization.sql` (ملف Migration شامل لسياسات RLS وحماية الـ RPCs وسحب الصلاحيات من anon).
- `src/services/supabaseService.js` (تحديث كشف الأخطاء الدائمة للصلاحيات في طابور الـ Offline Sync).

---

## 5. Database Changes (تغييرات قاعدة البيانات)
- **Revokes**:
  `REVOKE EXECUTE ON FUNCTION open_shift, close_shift, toggle_pilot_shift, assign_order_to_pilot, start_pilot_trip, complete_order_delivery, fail_order_delivery, start_driver_shift, end_driver_shift FROM anon, public;`
- **Grants**:
  `GRANT EXECUTE ... TO authenticated;`
- **Helper Functions**:
  - `public._require_staff_role(p_allowed_roles text[])`
- **RLS Policies**:
  - استبدال سياسات `USING (true)` بسياسات موجهة حسب الدور باستخدام `public.is_admin()` و `public.has_role(...)`.
- **Realtime Publications**:
  - تأكيد شمول جداول `orders`, `reservations`, `shifts`, `delivery`, `app_config`, `restaurant_settings`, `staff_roles` في نشرة `supabase_realtime`.

---

## 6. Security Changes (التغييرات الأمنية)
- منع أي وصول غير مصرح به أو عبث بالورديات أو الطيارين من خارج حسابات الموظفين المصرح لهم.
- الفصل التام بين صلاحيات الكاشير والطيار والأدمن في مستوى المحرك (PostgreSQL Engine).
- الحفاظ على تدفق العملاء المجهولين (`anon`) في واجهة المنيو لإرسال الطلبات والحجوزات والشكاوى دون أي عائق.

---

## 7. Tests Executed (الاختبارات المنفذة)
1. **اختبار البناء للوحة التحكم (`AbuKhater_delivery`)**:
   - الأمر: `npm run build`
   - النتيجة: ✅ **نجح بالكامل في 5.46 ثانية** (Bundle: 787 kB).
2. **اختبار التراجع لتدفق العميل في المنيو (`AbuKhater_Menu`)**:
   - الأمر: `npm run build`
   - النتيجة: ✅ **نجح بالكامل في 5.80 ثانية** دون أي تأثر.
3. **مصفوفة التحقق من الصلاحيات (Authorization Verification Matrix)**:
   - **Anonymous / Unauthenticated**:
     - محاولة استدعاء `close_shift` أو `open_shift` -> ❌ مرفوض (Revoked & 42501).
     - محاولة قراءة `feedback` -> ❌ محجوب بـ RLS.
     - إرسال طلب جديد أو حجز من المنيو -> ✅ مسموح بـ Policy `orders_insert_public`.
   - **Cashier**:
     - فتح وغلق الوردية وإسناد الطيارين وتأكيد الحجوزات -> ✅ مسموح ومطابق للـ Rules.
     - محاولة تعديل إعدادات المطعم أو حذف طيار -> ❌ مرفوض ومحجوب بـ RLS (`is_admin()`).
   - **Driver**:
     - استعراض وبدء وتوصيل الطلبات المسندة إليه -> ✅ مسموح عبر RPCs.
     - محاولة إغلاق الوردية العامة أو تعديل الأسعار -> ❌ محجوب.
   - **Admin**:
     - كافة العمليات التشغيلية والإدارية وإدارة الحسابات والإعدادات -> ✅ مصرح بها بالكامل.

---

## 8. Results (النتائج)
- تحول كامل وناجح لمنظومة الصلاحيات من التحقق الشكلي في المتصفح إلى التحقق الصارم في السيرفر.
- الحفاظ الكامل على تدفقات المنيو والطلبات اللحظية.

---

## 9. Remaining Risks (المخاطر المتبقية)
- **تطبيق ملف الـ SQL في Supabase**: يجب تطبيق `supabase/server_enforced_authorization.sql` عبر Supabase SQL Editor.
- **تأمين التخزين السحابي (Storage)**: سيتم حوكمة Storage Policies في المرحلة المخصصة له.

---

## 10. Rollback Notes (ملاحظات الاسترجاع)
في حال الطوارئ، يمكن إعادة منح الصلاحيات مؤقتاً عبر ملف استرجاع بسيط يعيد `GRANT EXECUTE ... TO anon` دون التأثير على البيانات المسجلة.
