# تقرير تنفيذ المرحلة Phase 2B: Manual/Cashier Orders + Printing Security

## 1. نظرة عامة والأهداف

هدفت هذه المرحلة إلى تأمين مسار إنشاء الطلبات اليدوية (`Manual / Cashier / POS / Trips`) من جهة السيرفر، وسد ثغرات الـ HTML / XSS Injection في خدمة الطباعة (`printerService`)، مع الحفاظ الكامل على الهوية البصرية وتنسيقات الإيصالات الحرارية.

---

## 2. تأمين الطباعة وسد ثغرات الـ XSS Injection

### 2.1 تحليل المشكلة
كانت خدمة الطباعة (`printerService.js`) تعتمد على تجميع نصوص HTML عبر Template Literals واستخدام `document.write` ومكتبة QZ Tray، مع تضمين بيانات يدخلها المستخدمون أو العملاء مباشرة مثل:
- `order.customerName`
- `order.phone`
- `order.phone2`
- `order.area`
- `order.paymentMethod`
- `order.pilotName`
- `order.originalId`
- `item.name`
- `item.notes`
- `driverReport.name`

أي محتوى غير موثوق يحتوي على وسوم مثل `<script>`, `<img>`, `<iframe>`, أو `<svg onload=...>` كان يمكن أن ينفذ كود JavaScript خبيث في سياق نافذة الطباعة أو المتصفح.

### 2.2 الحل الهندسي المطبق
تم إنشاء دوال تعقيم صارمة وخفيفة الوزن في [`src/services/printerService.js`](file:///c:/Users/mamdo/Documents/GitHub/AbuKhater_delivery/src/services/printerService.js):

1. **`escapeHtml(unsafe)`**:
   - تحويل الرموز الخطرة إلى HTML Entities آمنة:
     - `&` $\rightarrow$ `&amp;`
     - `<` $\rightarrow$ `&lt;`
     - `>` $\rightarrow$ `&gt;`
     - `"` $\rightarrow$ `&quot;`
     - `'` $\rightarrow$ `&#039;`
   - معالجة قيم `null` و `undefined` بأمان تام.

2. **`sanitizeNotes(notes)`**:
   - تعقيم النص أولاً باستخدام `escapeHtml` لمنع أي كود خبيث.
   - تحويل الفواصل السطرية `\n` و `\r\n` إلى الوسم الآمن `<br/>` للحفاظ على تنسيق الملاحظات متعددة الأسطر.

3. **تطبيق التعقيم على جميع القوالب**:
   - قالب الفواتير الرئيسية (`generateOrderHtml`).
   - قالب الطباعة المباشرة (`generateDirectPrintHtml`).
   - قالب تقارير الطيارين والشيفتات (`generateDriverReportHtml`).

> [!NOTE]
> **الحفاظ على التصميم:** لم يتم إجراء أي تعديل على قياسات الطباعة (80mm / 72mm)، ألوان التنسيق، فئات الـ CSS، أو الخطوط المعتمدة للإيصالات.

---

## 3. محرك إنشاء الطلبات اليدوية الموثوق (`create_manual_order` RPC)

تم تصميم ونشر الـ RPC الموثوق [`create_manual_order`](file:///c:/Users/mamdo/Documents/GitHub/AbuKhater_delivery/supabase/server_authoritative_manual_order.sql) على قاعدة بيانات Supabase (`htpnxizfqmnnkhemvmdz`):

### 3.1 الخصائص الأمنية والتنفيذية
1. **التحقق من الصلاحيات (`_require_staff_role`)**:
   - دالة `SECURITY DEFINER` تتحقق من هوية المتصل عبر جلسة Supabase Auth الموثقة (`auth.uid()`).
   - التحقق من وجود المستخدم في `public.staff_roles` بحالة نشطة (`is_active = true`).
   - قصر التنفيذ على الأدوار المصرح لها: `admin` و `casher` و `driver`.
   - سحب صلاحية التنفيذ نهائياً من المستخدمين غير المسجلين (`REVOKE EXECUTE ... FROM anon, public`).

2. **الاستعلام الموثوق للأسعار (`Server-Authoritative Pricing`)**:
   - مطابقة الأصناف مع جدول `menu_items` عبر `item_id` أو الاسم.
   - في حال وجود الصنف في المنيو، يتم اعتماد سعر السيرفر وتجاهل أي سعر مرسل من الواجهة.
   - في حال الأصناف الحرة/اليدوية غير المسجلة بالمنيو (Special Cashier Entry)، يتم حساب الإجمالي بناء على الكمية وسعر الصنف المدخل.

3. **الربط الذري بين `orders` و `order_items`**:
   - إنشاء صف الطلب في جدول `orders`.
   - إنشاء صفوف تفاصيل الطلب في جدول `order_items` بالـ `order_id` الجديد في نفس المعاملة الذرية (Single Transaction) لمنع أي Orphaned Rows.

4. **ربط الوردية (`Shift Association`)**:
   - ربط الطلب تلقائياً بالوردية النشطة المفتوحة (`shifts` WHERE status = 'open') أو المعرف الممرر صراحة.

5. **دعم الـ Idempotency**:
   - تسجيل الـ `mutation_id` في جدول `applied_mutations`.
   - إعادة نفس النتيجة السابقة فوراً في حال تكرار نفس الطلب بسبب ضعف الاتصال دون إنشاء طلب مكرر.

---

## 4. نتائج التحقق والاختبارات العملية

تم تنفيذ برنامج اختبار شامل وحي على قاعدة البيانات [`scratch/test_phase2b_security.mjs`](file:///c:/Users/mamdo/.gemini/antigravity/brain/898a2223-7a03-4b1f-be7f-da55987767b2/scratch/test_phase2b_security.mjs) بنسبة نجاح **100%**:

| الاختبار | الوصف | النتيجة |
| :--- | :--- | :---: |
| **Test 1.1 - 1.4** | تعقيم الـ XSS وحماية الحروف العربية والفواصل السطرية في الطباعة | ✅ نجح |
| **Test 1.5** | منع حقن السكربتات والأطر الخبيثة في قوالب الإيصالات الحرارية | ✅ نجح |
| **Test 2.1** | محاولة استدعاء `create_manual_order` بواسطة `anon` $\rightarrow$ رفض برمز `401 / 42501` | ✅ نجح |
| **Test 2.2** | إعداد بيئة الموظف والوردية النشطة في Supabase Auth و `staff_roles` | ✅ نجح |
| **Test 2.3** | إنشاء طلب يدوي موثق من موظف مصرح، حساب الأسعار، إدراج `orders` و `order_items` ذرياً | ✅ نجح |
| **Test 2.4** | التحقق من الـ Idempotency ومنع تكرار إنشاء الطلبات عند إعادة الإرسال | ✅ نجح |
| **Test 2.5** | رفض محاولات إنشاء الطلبات للموظفين المعطلين (`is_active = false`) | ✅ نجح |

### 4.1 التحقق من البناء الإنتاجي (Production Build)
- `AbuKhater_delivery`: تم بنجاح `npm run build` (0 أخطاء).
- `AbuKhater_Menu`: تم بنجاح `npm run build` (0 أخطاء).

---

## 5. حالة الـ Git والمكونات المعدلة

- `src/services/printerService.js` (تأمين قوالب الطباعة ودوال التعقيم).
- `src/services/supabaseService.js` (تحديث `createManualOrder` لاستدعاء RPC).
- `src/utils/pilotCalculations.js` & `src/utils/shiftLogic.js` (تطبيق سقف الـ 10 ساعات للطيارين).
- `supabase/server_authoritative_manual_order.sql` (ملف الـ Migration للـ RPC).
- `.gitignore` (تجاهل ملفات Supabase CLI المؤقتة).
