# تقرير تنفيذ المرحلة Phase 3: Public Inputs Protection & Rate Limiting

## 1. نظرة عامة والأهداف

هدفت هذه المرحلة إلى حماية وتأمين جميع نقاط الإدخال العامة والمتاحة للمستخدمين والعملاء بدون تسجيل دخول (`Public-Facing Endpoints`)، وتشمل:
1. طلبات حجز الطاولات (`reservations`).
2. الاقتراحات والشكاوى (`feedback`).
3. رفع إيصالات السداد إلى وحدة التخزين (`payment-screenshots` bucket).

تم تطبيق قواعد التحقق الصارمة من جهة السيرفر، وتفعيل نظام تحديد معدل الطلبات (`Native Rate Limiting`) لمنع الإغراق والسبام، وتفعيل الـ Idempotency، وإلغاء جميع الصلاحيات والسياسات القديمة غير الآمنة.

---

## 2. تحليل الثغرات السابقة والمعالجة المطبقة

| نقطة الإدخال / الجدول | الوضع السابق (ثغرات RLS والمدخلات) | الوضع المطبق في Phase 3 (الحماية السيرفرية) |
| :--- | :--- | :--- |
| **`reservations`** | - إدراج مباشر (`Direct INSERT`) من `anon`<br>- سياسات RLS قديمة تسمح بقراءة وتعديل جميع الحجوزات علناً (`Enable read/update for anon`)<br>- قبول نصوص بلا حدود وأرقام ضيوف سالبة أو ضخمة<br>- عدم التحقق من صحة وتاريخ الحجز | - سحب جميع صلاحيات القراءة والإدراج المباشر من `anon` (`REVOKE ALL`)<br>- إنشاء RPC موثوق `submit_reservation`<br>- التحقق من صحة الاسم (3-100 حرف) ورقم الهاتف المصري (11 رقم)<br>- تقييد التاريخ (من اليوم الحالي وحتى 30 يوماً كحد أقصى)<br>- تقييد عدد الضيوف (1 إلى 50 فرداً)<br>- توليد كود الحجز `ref_number` وحالة `pending` ومبلغ التأمين من السيرفر<br>- تحديد معدل الحجوزات: **5 حجوزات كحد أقصى للرقم في الساعة** |
| **`feedback`** | - إدراج مباشر (`Direct INSERT`) من `anon`<br>- سياسات RLS قديمة تسمح بحذف وقراءة الرسائل علناً (`Enable delete/read for all users`)<br>- إمكانية إرسال رسائل فارغة أو هجمات DoS بنصوص ضخمة | - سحب الصلاحيات المباشرة من `anon` وتخصيص القراءة والحذف للإدارة فقط<br>- إنشاء RPC موثوق `submit_feedback`<br>- التحقق من الاسم والرسالة (10-1000 حرف) والنوع<br>- تحديد معدل الإرسال: **3 رسائل كحد أقصى للرقم في 10 دقائق** |
| **`payment-screenshots` (Storage)** | - سعة تخزين وأنواع ملفات غير محددة | - تقييد الحد الأقصى للملف بـ **5 ميجابايت**<br>- حصر أنواع الملفات المسموحة على الصور (`jpeg`, `png`, `webp`, `heic`, `jpg`) |

---

## 3. المعمارية البرمجية المنفذة

### 3.1 دالة توحيد والتحقق من الهاتف المصري (`_validate_egyptian_phone`)
- تنظيف المدخلات وإزالة الفواصل والرموز.
- تحويل الرموز الدولية (`+20`, `0020`, `20`) وتنسيق الأرقام ذات الـ 10 خانات إلى صيغة 11 رقماً تبدأ بـ `01`.
- التحقق عبر التعبير النمطي الصارم: `^01[0125][0-9]{8}$`.

### 3.2 محرك حجز الطاولات (`submit_reservation` RPC)
[`supabase/public_inputs_protection.sql`](file:///c:/Users/mamdo/Documents/GitHub/AbuKhater_delivery/supabase/public_inputs_protection.sql):
1. **Idempotency Check**: فحص وتسجيل المفتاح في `applied_mutations`.
2. **Server-Side Validation**:
   - `customer_name`: مطلوب (3 - 100 حرف).
   - `customer_phone`: التحقق والتنسيق عبر `_validate_egyptian_phone`.
   - `reservation_date`: مطلوب و `>= CURRENT_DATE` و `<= CURRENT_DATE + 30 days`.
   - `reservation_time`: فحص صحة صيغة الوقت.
   - `guests_count`: مطلوب (1 - 50 فرداً).
   - `location_type`: مطابقة وتطبيع (`restaurant` / `cafe`).
   - `payment_proof_url`: التحقق من صيغة الرابط وطوله.
3. **Native Rate Limiter**:
   - فحص عدد الحجوزات لنفس الهاتف خلال آخر 60 دقيقة، ورفض الطلب عند تجاوز 5 حجوزات برمز خطأ واضح.
4. **Authoritative Deposit & Status**:
   - قراءة قيمة التأمين الرسمية من `restaurant_settings` (`reservation_deposit_amount`).
   - ضبط الحالة قسرياً على `pending`.
   - إنشاء رقم مرجعي فريد تلقائياً (`RES-YYMMDD-XXXX`).

### 3.3 محرك الاقتراحات والشكاوى (`submit_feedback` RPC)
1. **Idempotency Check**: فحص وتسجيل المفتاح.
2. **Server-Side Validation**:
   - `full_name`: مطلوب (2 - 100 حرف).
   - `phone`: التحقق والتنسيق عبر `_validate_egyptian_phone`.
   - `type`: تطبيع التصنيف (`suggestion`, `complaint`, `inquiry`).
   - `message`: مطلوب (10 - 1000 حرف).
3. **Native Rate Limiter**:
   - منع الإغراق برفض أكثر من 3 رسائل لنفس الهاتف في غضون 10 دقائق.

### 3.4 تحديث خدمات الواجهة الأمامية (`AbuKhater_Menu`)
- [`src/services/api/reservationService.js`](file:///C:/Users/mamdo/Documents/GitHub/AbuKhater_Menu/src/services/api/reservationService.js): التحويل من الإدراج المباشر إلى استدعاء `supabase.rpc('submit_reservation', ...)`.
- [`src/services/api/feedbackService.js`](file:///C:/Users/mamdo/Documents/GitHub/AbuKhater_Menu/src/services/api/feedbackService.js): التحويل من الإدراج المباشر إلى استدعاء `supabase.rpc('submit_feedback', ...)`.

---

## 4. نتائج الاختبار والتحقق العملي

تم تنفيذ حزمة اختبارات أمنية شاملة وحية على قاعدة البيانات [`scratch/test_phase3_security.mjs`](file:///c:/Users/mamdo/.gemini/antigravity/brain/898a2223-7a03-4b1f-be7f-da55987767b2/scratch/test_phase3_security.mjs) بنسبة نجاح **100%**:

| الاختبار | نوع التحقق | النتيجة |
| :--- | :--- | :---: |
| **Test 1.1 - 1.4** | إغلاق القراءة والإدراج المباشر على `reservations` و `feedback` للـ anon (`401 Permission Denied`) | ✅ نجح |
| **Test 2.1 - 2.2** | رفض الأسماء القصيرة (<3) والأسماء المفرطة الطول (>100) في الحجز | ✅ نجح |
| **Test 2.3** | رفض أرقام الهواتف غير الصحيحة في الحجز | ✅ نجح |
| **Test 2.4 - 2.5** | رفض التواريخ الماضية والتواريخ الأبعد من 30 يوماً في الحجز | ✅ نجح |
| **Test 2.6 - 2.7** | رفض الأوقات غير الصالحة وأعداد الضيوف غير المقبولة (0 أو >50) | ✅ نجح |
| **Test 2.8** | قبول الحجز الصحيح، تحويل البادئة `+20`، ضبط الحالة `pending` وتوليد `RES-` | ✅ نجح |
| **Test 3.1 - 3.3** | رفض الاسم القصير والرسائل القصيرة (<10) والرسائل الضخمة (>1000) في الفيدباك | ✅ نجح |
| **Test 3.4** | قبول الفيدباك الصحيح وتطبيع التصنيفات العربية (`شكوى` $\rightarrow$ `complaint`) | ✅ نجح |
| **Test 4.1 - 4.2** | التحقق من الـ Idempotency وإعادة نفس النتيجة دون تكرار في قاعدة البيانات | ✅ نجح |
| **Test 5.1 - 5.2** | إرسال دفعة 5 حجوزات وحظر المحاولة السادسة بنجاح عبر الـ Rate Limiter | ✅ نجح |
| **Test 6.1 - 6.2** | استعراض وتحديث الحجوزات بنجاح من قبل موظفي الـ Dashboard المصرح لهم | ✅ نجح |

### 4.1 التحقق من البناء الإنتاجي
- `AbuKhater_Menu`: تم بنجاح `npm run build` (0 أخطاء).
- `AbuKhater_delivery`: تم بنجاح `npm run build` (0 أخطاء).

---

## 5. حالة الـ Git والملفات المعدلة
- `AbuKhater_Menu/src/services/api/reservationService.js` (تحديث مسار الحجز للـ RPC).
- `AbuKhater_Menu/src/services/api/feedbackService.js` (تحديث مسار الفيدباك للـ RPC).
- `AbuKhater_delivery/supabase/public_inputs_protection.sql` (ملف الـ Migration للـ RPCs و RLS و Storage).
- `AbuKhater_delivery/docs/phase-3-report.md` (تقرير التوثيق الشامل).
