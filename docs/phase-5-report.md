# Phase 5 Implementation Report: Private Storage Migration & Signed URLs

**Date:** October 1, 2026  
**Scope:** `AbuKhater_Dashborad` / `AbuKhater_delivery` & `AbuKhater_Menu`  
**Status:** Completed & Verified  

---

## 1. المشكلة (The Problem)
كان مستودع صور إيصالات الدفع والتحويلات البنكية (`payment-screenshots`) في Supabase Storage مهيأً بوضع عام (`public = true`) مع سياسة قراءة مفتوحة للجميع (`Allow public read access`). كان بإمكان أي شخص على الإنترنت الوصول المباشر لصور إيصالات التحويل البنكي وفودافون كاش وبيانات العملاء المالية بمجرد امتلاك الرابط أو تخمين المسار. بالإضافة إلى ذلك، كانت لوحة التحكم تعرض الصور مباشرة عبر روابط عامة مكشوفة، وفي بعض الشاشات (مثل `ReportsView.jsx`) كان يتم استخدام `document.write` لفتح الصورة.

---

## 2. السبب الجذري (Root Cause)
1. ضبط الحاوية `payment-screenshots` كـ `public = true` في جدول `storage.buckets`.
2. غياب سياسات RLS مخصصة على جدول `storage.objects` تحصر القراءة في طاقم العمل المصرح لهم فقط (`admin`, `casher`, `driver`).
3. عدم وجود طبقة وسيطة في لوحة التحكم لتوليد روابط مؤقتة وموقعة مشفرة (Temporary Signed URLs) للوصول لصور الإيصالات مع دعم التوافق الرجعي للروابط القديمة المخزنة مسبقاً.

---

## 3. ما تم تغييره (What Was Changed)

### 1. تحويل مستودع التخزين إلى خاص وتأمين سياسات RLS (Storage Hardening)
- تم تعديل إعداد الحاوية `payment-screenshots` لتصبح خاصة تماماً (`public = false`).
- حذف سياسة القراءة العامة المفتوحة `Allow public read access` من `storage.objects`.
- إنشاء سياسة `storage_receipts_insert_public` للسماح برفع صور الإيصالات للعملاء غير المسجلين (`anon` / `public`) أثناء إرسال طلبات الأونلاين أو الحجوزات عبر المنيو.
- إنشاء سياسة `storage_receipts_read_staff` التي تحصر قراءة واختيار كائنات التخزين في المستخدمين الموثقين (`authenticated`) الذين يمتلكون دوراً نشطاً (`has_role('admin')` أو `has_role('casher')` أو `has_role('driver')`).
- إنشاء سياسة `storage_receipts_staff_all` لإدارة وتحديث الكائنات من قبل طاقم العمل.
- تحديث دالة `submit_reservation` لدعم مسارات التخزين النسبية والروابط الموقعة.

### 2. بناء أدوات استخراج المسارات وتوليد الروابط الموقعة (`storageService.js`)
- إضافة دالة `extractStoragePath(urlOrPath, bucketName)`:
  - استخراج المسار النسبي داخل الحاوية تلقائياً من الروابط العامة القديمة (`.../object/public/payment-screenshots/...`).
  - استخراج المسار النسبي من الروابط الموقعة السابقة (`.../object/sign/payment-screenshots/...`).
  - استخراج المسار من المسارات النسبية المباشرة (`payments/...`, `orders/...`, `reservations/...`).
  - التعرف على الروابط الخارجية (مثل Google Drive أو Base64) وإرجاعها كما هي دون كسر تدفق العرض.
- إضافة دالة `getSignedReceiptUrl(urlOrPath, expiresIn, bucketName)`:
  - توليد رابط مؤقت موقع صالح لمدة محددة (افتراضياً 3600 ثانية).
  - استخدام In-Memory Cache لتخزين الروابط الموقعة وتفادي استدعاءات الشبكة المتكررة عند إعادة تصيير المكونات.
- إضافة React Hook مخصص `useSignedReceiptUrl(urlOrPath, expiresIn)`:
  - يوفر معالجة غير متزامنة سلسة مع مؤشرات التحميل والخطأ داخل مكونات React.

### 3. تطوير مكون عرض الإيصالات (`ReceiptThumbnail.jsx`)
- إنشاء المكون `ReceiptThumbnail` الذي يتكفل بجلب الرابط الموقع تلقائياً وعرض صورة مصغرة أنيقة وآمنة مع مؤشر تحميل سلس وتفادي أخطاء التحميل.

### 4. تحديث واجهات لوحة التحكم (`OrderInbox.jsx`, `ReportsView.jsx`, `App.jsx`)
- **صندوق الطلبات (`OrderInbox.jsx`)**:
  - استبدال الصور المباشرة بمكون `ReceiptThumbnail` لطلبات الأونلاين والطلبات اليدوية.
  - دعم عرض الصورة الكبيرة داخل الـ Modal باستخدام الرابط الموقع الآمن.
- **سجل التقارير والحجوزات (`ReportsView.jsx`)**:
  - استبدال `document.write` غير الآمن بمكون `ReceiptThumbnail` مع نافذة Modal مخصصة لعرض إيصال الحجز بجودة عالية وأمان تام.
- **تأكيد دفع الحجز (`App.jsx`)**:
  - تحديث `ConfirmPaymentModal` لفك تشفير الرابط الموقع تلقائياً للإيصالات السابقة المرفوعة.

---

## 4. الملفات المتغيرة (Changed Files)
- `supabase/migrations/20261001_phase5_private_storage.sql` (ملف Migration الخاص بتحويل المستودع لخاص وسياسات RLS).
- `src/services/storageService.js` (تطوير دوال استخراج المسار، الروابط الموقعة، والـ Caching).
- `src/components/common/ReceiptThumbnail.jsx` (مكون عرض مصغرات الإيصالات بالروابط الموقعة).
- `src/components/orders/OrderInbox.jsx` (دمج `ReceiptThumbnail` وعرض الإيصالات بالروابط الموقعة).
- `src/components/reports/ReportsView.jsx` (استبدال `document.write` بمكون `ReceiptThumbnail` و Modal العرض).
- `src/App.jsx` (استخدام `useSignedReceiptUrl` داخل نافذة تأكيد دفع الحجز).
- `scratch/verify_phase5_complete.mjs` (مجموعة اختبارات التحقق الشاملة للمرحلة الخامسة).

---

## 5. Storage & Database Policies (سياسات التخزين وقاعدة البيانات)

```sql
-- 1. Make Bucket Private
UPDATE storage.buckets SET public = false WHERE name = 'payment-screenshots';

-- 2. Public Insert Policy (Menu & Online Orders Upload)
CREATE POLICY "storage_receipts_insert_public"
ON storage.objects FOR INSERT TO public
WITH CHECK (bucket_id = 'payment-screenshots');

-- 3. Staff Only Select Policy
CREATE POLICY "storage_receipts_read_staff"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'payment-screenshots'
  AND (
    public.has_role('admin')
    OR public.has_role('casher')
    OR public.has_role('driver')
  )
);

-- 4. Staff Management Policy
CREATE POLICY "storage_receipts_staff_all"
ON storage.objects FOR ALL TO authenticated
USING (
  bucket_id = 'payment-screenshots'
  AND (
    public.has_role('admin')
    OR public.has_role('casher')
    OR public.has_role('driver')
  )
)
WITH CHECK (
  bucket_id = 'payment-screenshots'
  AND (
    public.has_role('admin')
    OR public.has_role('casher')
    OR public.has_role('driver')
  )
);
```

---

## 6. Verification Results (نتائج الاختبارات والتحقق)

| الاختبار | الوصف | النتيجة |
| :--- | :--- | :--- |
| **1. Bucket Privacy** | التأكد من أن `public = false` للحاوية `payment-screenshots` | ✅ **PASS** |
| **2. Customer Anonymous Upload** | التأكد من قدرة عميل المنيو على رفع صورة الإيصال بنجاح | ✅ **PASS** |
| **3. Direct Public Access Blocked** | التحقق من رفض أي طلب HTTP GET مباشر دون توقيع (HTTP 400 Bad Request) | ✅ **PASS** |
| **4. Database RLS Enforcement** | التحقق من منع `anon` (0 كائنات) وسماح طاقم العمل (`admin`/`casher`/`driver`) بالقراءة | ✅ **PASS** |
| **5. Path Extraction & Legacy URLs** | التحقق من استخراج المسار الصحيح من الروابط العامة والروابط الموقعة والمسارات النسبية | ✅ **PASS** |
| **6. Reservation RPC with Receipt** | إنشاء حجز بنجاح مع ربطه بمسار الإيصال الخاص وتوليد الـ Reference | ✅ **PASS** |
| **7. Dashboard Build** | بناء مشروع `AbuKhater_delivery` بنجاح عبر `npm run build` | ✅ **PASS (0 errors)** |
| **8. Menu App Build** | بناء مشروع `AbuKhater_Menu` بنجاح عبر `npm run build` | ✅ **PASS (0 errors)** |
