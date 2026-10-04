# تقرير تنفيذ المرحلة Phase 4: Canonical Order State Machine & Lifecycle Governance

## 1. نظرة عامة والأهداف

هدفت هذه المرحلة إلى توحيد ومعالجة تشتت حالات الطلب (`Order Lifecycle States`)، وفصل دورة حياة المدفوعات (`Payment Status`) عن حالة تشغيل وتحضير الطلب، وتخصيص عمود مستقل لأسباب الإلغاء وفشل التوصيل (`cancellation_reason`) بدلاً من دمج النصوص والأسباب داخل حقل الحالة.

كما تم بناء محرك انتقالات موثوق وصارم بالسيرفر (`Server-Authoritative State Machine`) يحدد الصلاحيات لكل دور (`Admin`, `Cashier`, `Driver`)، وتوفير واجهة استعلام آمنة لتتبع العميل لطلبه (`Customer Order Tracking`).

---

## 2. تحليل الحالات السابقة وتوحيدها (Canonical Mapping)

### 2.1 الوضع السابق ومشاكل التشتت
- **تلوث حقل الحالة**: كانت أسباب الإلغاء والفشل تدمج داخل عمود `status` كنصوص مركبة مثل `ملغي (العميل لم يرد)` و `فشل التوصيل (العنوان غير واضح)`.
- **ازدواجية اللغات**: تداخل بين مسميات عربية في قاعدة البيانات (`في التحضير`, `تم التوصيل`, `في الطريق للتسليم`) ومسميات إنجليزية في الواجهات (`waiting_driver`, `driver_assigned`, `active`, `completed`).
- **خلط حالة الدفع**: عدم وجود مسار مستقل لمعالجة إيصالات التحويل (InstaPay / المحافظ) وتأكيد استلام النقدية.

### 2.2 جدول التحويل والمطابقة للحالة الموحدة (`Canonical Order Status`)

| الحالة السابقة (Database / UI) | المعنى التشغيلي | الحالة الموحدة الرسمية (`Canonical`) | الشاشات والفلاتر المتوافقة |
| :--- | :--- | :--- | :--- |
| `pending` / `pending_timer` / `جديد` | طلب جديد بانتظار المراجعة | `pending` | صندوق الطلبات الواردة |
| `في التحضير` / `waiting_driver` / `confirmed` | مؤكد وجاري التحضير بالمطبخ | `preparing` | المطبخ / بانتظار الإسناد |
| `جاهز` / `ready` | جاهز للتسليم / جاهز للإسناد | `ready` | طلبات الاستلام والجاهزة |
| `تم الإسناد للطيار` / `driver_assigned` | مسند للطيار بالمطعم | `driver_assigned` | شاشة الطيارين والإسناد |
| `في الطريق للتسليم` / `out_for_delivery` / `active` | الطيار غادر المطعم بالطلب | `out_for_delivery` | الطلبات النشطة في الطريق |
| `تم التوصيل` / `completed` / `delivered` | تم التسليم بنجاح للعميل (Terminal) | `delivered` | الأرشيف والتقارير اليومية |
| `فشل التوصيل (...)` / `failed_delivery` | تعذر التسليم في الطريق | `failed_delivery` | الطلبات المعلقة / إعادة المحاولة |
| `ملغي (...)` / `cancelled` | ملغي من الإدارة/الكاشير (Terminal) | `cancelled` | الأرشيف والملغيات |

---

## 3. فصل دورة حياة المدفوعات (`Payment Status`)

تم إنشاء عمود مستقل `payment_status` مع الحالات المعيارية التالية:

| حالة الدفع (`payment_status`) | الوصف | المشغل المسؤول |
| :--- | :--- | :--- |
| `cash_on_delivery` | الدفع نقداً عند الاستلام | افتراضي لطلبات الكاش |
| `pending_payment` | طلب أونلاين بانتظار رفع إيصال الدفع | العميل |
| `pending_verification` | تم رفع صورة الإيصال وبانتظار مراجعة الكاشير | الكاشير / الإدارة |
| `verified` | تم التحقق من التحويل أو تحصيل الكاش عند الباب | الكاشير / النظام عند التسليم |
| `rejected` | إيصال التحويل غير صالح أو مرفوض | الكاشير / الإدارة |
| `refunded` | تم استرجاع المبلغ للعميل | الإدارة |

---

## 4. مصفوفة انتقالات الحالة والصلاحيات (State Transition Matrix)

| من حالة | إلى حالة | الأدوار المصرح لها | دالة الـ RPC المسؤولة | الشروط وقواعد الحوكمة |
| :--- | :--- | :--- | :--- | :--- |
| `pending` | `preparing` | `admin`, `casher` | `transition_order_status` | مراجعة الكاشير وبدء التحضير |
| `pending` | `cancelled` | `admin`, `casher` | `cancel_order` | **إلزامية كتابة سبب الإلغاء** |
| `preparing` | `ready` | `admin`, `casher` | `transition_order_status` | انتهاء تجهيز الطلب |
| `preparing` | `driver_assigned` | `admin`, `casher` | `assign_order_to_pilot` | إسناد ذري لطيار متاح وشيفت مفتوح |
| `preparing` | `delivered` | `admin`, `casher` | `transition_order_status` | خاص بطلبات الصالة / الاستلام من المطعم |
| `preparing` | `cancelled` | `admin`, `casher` | `cancel_order` | إلزامية سبب الإلغاء |
| `ready` | `driver_assigned` | `admin`, `casher` | `assign_order_to_pilot` | إسناد لطيار التوصيل |
| `ready` | `delivered` | `admin`, `casher` | `transition_order_status` | استلام العميل للطلب الجاهز |
| `driver_assigned` | `out_for_delivery` | `admin`, `casher`, `driver` | `start_pilot_trip` | خروج الطيار بالطلب من المطعم |
| `driver_assigned` | `preparing` / `ready` | `admin`, `casher` | `transition_order_status` | إلغاء إسناد الطيار وتغييره |
| `driver_assigned` | `cancelled` | `admin`, `casher` | `cancel_order` | إلغاء الطلب وتحرير الطيار |
| `out_for_delivery` | `delivered` | `admin`, `casher`, `driver` | `complete_order_delivery` | تسليم الطلب للعميل + توثيق الدفع |
| `out_for_delivery` | `failed_delivery` | `admin`, `casher`, `driver` | `fail_order_delivery` | **إلزامية كتابة سبب الفشل** |
| `failed_delivery` | `preparing` / `ready` | `admin`, `casher` | `transition_order_status` | إعادة المحاولة مع طيار آخر |
| `failed_delivery` | `cancelled` | `admin`, `casher` | `cancel_order` | إلغاء نهائي بعد فشل المحاولات |
| **`delivered`** | *(Terminal)* | ممنوع | — | **حالة نهائية لا يمكن إعادة فتحها** |
| **`cancelled`** | *(Terminal)* | ممنوع | — | **حالة نهائية لا يمكن تعديلها** |

---

## 5. محرك تتبع العميل للطلب (`Customer Order Tracking`)

تم إنشاء ونشر الـ RPC العام الآمن [`get_customer_order_tracking`](file:///c:/Users/mamdo/Documents/GitHub/AbuKhater_delivery/supabase/canonical_order_state_machine.sql):
- **المدخلات**: `p_order_id` (معرف الطلب) أو `p_order_number` (رقم البون) + `p_customer_phone` (رقم الهاتف).
- **البيانات المعادة بأمان**:
  - `status`: الحالة الموحدة الرسمية.
  - `status_label_ar`: التوصيف العربي للعميل (مثل: *جاري تحضير الطلب في المطبخ*، *الطلب في الطريق إليك الآن 🚚*).
  - `payment_status` و `payment_status_label_ar`.
  - `pilot_name`: يظهر فقط للعميل عندما يكون الطلب `out_for_delivery`.
  - `items_count`, `total_amount`, `paid_now`, `remaining_amount`.
- **عزل البيانات**: لا يمكن للعميل الوصول لأي بيانات حساسة كأرباح الطيارين، الملاحظات الداخلية، أو طلبات عملاء آخرين.
- ربط دالة `trackOrder` في [`AbuKhater_Menu/src/services/api/orderService.js`](file:///C:/Users/mamdo/Documents/GitHub/AbuKhater_Menu/src/services/api/orderService.js).

---

## 6. نتائج الاختبار والتحقق العملي

تم تشغيل حزمة الاختبارات الشاملة وحفظ السجلات في [`scratch/test_phase4_state_machine.mjs`](file:///c:/Users/mamdo/.gemini/antigravity/brain/898a2223-7a03-4b1f-be7f-da55987767b2/scratch/test_phase4_state_machine.mjs) بنسبة نجاح **100%**:

| الاختبار | الوصف | النتيجة |
| :--- | :--- | :---: |
| **Test 1** | محاولة المتصلين المجهولين (`anon`) استدعاء دوال الانتقال $\rightarrow$ رفض برمز `401 Permission Denied` | ✅ نجح |
| **Test 2** | إعداد بيئة الكاشير والطيار والطلب التجريبي في قاعدة البيانات | ✅ نجح |
| **Test 3** | تنفيذ دورة حياة كاملة من `pending` إلى `delivered` بالصلاحيات والأدوار المحددة | ✅ نجح |
| **Test 4** | التحقق من مناعة وحصانة الحالات النهائية (`delivered`, `cancelled`) من أي تعديل لاحق | ✅ نجح |
| **Test 5** | إلزامية سبب الإلغاء وتخزينه في عمود `cancellation_reason` المستقل | ✅ نجح |
| **Test 6** | استقلالية التحقق من الدفع (`verify_order_payment`) عن مسار المطبخ | ✅ نجح |
| **Test 7.1** | استعلام العميل العام عن حالة طلبه عبر `order_id` والحصول على النصوص العربية الصحيحة | ✅ نجح |
| **Test 7.2** | استعلام العميل العام عبر `order_number` ورقم الهاتف | ✅ نجح |
| **Test 7.3** | استعلام عن طلب غير موجود وإرجاع `{ found: false }` بأمان | ✅ نجح |

### 6.1 التحقق من البناء الإنتاجي
- `AbuKhater_delivery`: تم بنجاح `npm run build` (0 أخطاء).
- `AbuKhater_Menu`: تم بنجاح `npm run build` (0 أخطاء).

---

## 7. حالة الـ Git والملفات المعدلة
- `AbuKhater_delivery/supabase/canonical_order_state_machine.sql` (ملف Migration الحالة والانتقالات والتتبع).
- `AbuKhater_delivery/src/services/supabaseService.js` (تحديث `updateOrderStatus`, `fetchOrders`, `verifyOrderPayment`).
- `AbuKhater_Menu/src/services/api/orderService.js` (إضافة `trackOrder`).
- `AbuKhater_delivery/docs/phase-4-report.md` (تقرير التوثيق الشامل).
