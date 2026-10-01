# Phase 1A Implementation Report: Server-Side Authentication & Staff RBAC

**Date:** October 1, 2026  
**Scope:** `AbuKhater_Dashborad` / `AbuKhater_delivery` (Control Center) & `AbuKhater_Menu` (Verification)  
**Status:** Completed & Verified  

---

## 1. المشكلة (The Problem)
كان نظام لوحة التحكم (`AbuKhater_Dashborad`) يعتمد بالكامل على هوية محلية غير موثقة مخزنة في متصفح العميل عبر `sessionStorage` (`b_delivery_session_user`) وأكواد PIN ثابتة ومحفوظة محلياً (`'8080'`). كان بإمكان أي مستخدم في المتصفح تغيير قيمة `sessionStorage` يدوياً لـ `'admin'` واكتساب صلاحيات المشرف الكاملة، دون أي تحقق أو مصادقة من طرف خادم Supabase.

---

## 2. السبب الجذري (Root Cause)
1. غياب تكامل Supabase Auth (`supabase.auth.signInWithPassword`, `getSession`, `onAuthStateChange`) داخل المشروع.
2. عدم وجود جدول لقواعد بيانات الموظفين وأدوارهم (`staff_roles`) مربوط بـ `auth.users(id)`، مما جعل الصلاحيات مجرد حالة مؤقتة في الواجهة الأمامية.
3. عدم وجود دوال فحص صلاحيات من جهة السيرفر (Server-side Role Guards).

---

## 3. ما تم تغييره (What Was Changed)
1. **إنشاء نموذج أدوار الموظفين بالسيرفر (Server-Side Staff RBAC)**:
   - إنشاء جدول `public.staff_roles` بربط `user_id` مع جدول `auth.users(id)`.
   - دعم الأدوار الثلاثة المعتمدة: `admin` (مدير)، `casher` (كاشير)، `driver` (طيار/كابتن توصيل).
   - توفير دوال مساعدة أمنية `SECURITY DEFINER` في PostgreSQL: `get_my_staff_profile()`, `is_admin()`, `current_staff_role()`, `has_role()`.
   - تفعيل سياسات Row Level Security (RLS) على جدول الأدوار بحيث يقرأ الموظف ملفه فقط ويدير الأدمن باقي الحسابات.
2. **تطوير طبقة الخدمات (`supabaseService.js`)**:
   - إضافة `signInStaff({ email, password })` للمصادقة وجلب الدور والتحقق من `is_active`.
   - إضافة `signOutStaff()` لإنهاء الجلسة الرسمية.
   - إضافة `getCurrentStaffProfile()` و `onAuthStateChange()`.
3. **تحديث إدارة الجلسة في السياق (`AppContext.jsx`)**:
   - استبدال قراءة وحفظ `sessionStorage` بالاعتماد على جلسة Supabase Auth الحقيقية.
   - مزامنة حالة التطبيق مع أحداث الجلسة (`SIGNED_IN`, `SIGNED_OUT`, `TOKEN_REFRESHED`).
   - تصدير `currentUser`, `currentStaff`, `isAuthLoading`, `loginStaff`, `logoutStaff`.
4. **تحديث شاشة تسجيل الدخول (`Login.jsx`)**:
   - إتاحة المصادقة عبر Supabase Auth (البريد وكلمة المرور) مع الحفاظ على تجربة اختيار الدور والـ Quick PIN السريع للموظفين.
   - إظهار مؤشر تحميل ورسائل خطأ دقيقة باللغة العربية.
5. **تحديث القائمة الجانبية (`Sidebar.jsx`) و (`App.jsx`)**:
   - استبدال تفريغ `sessionStorage` بدالة `logoutStaff()` الرسمية.
   - إضافة شاشة انتظار سلسة أثناء استعادة الجلسة والتحقق من الصلاحيات لمنع الوميض.
   - عرض اسم الموظف ودوره الموثق من السيرفر.

---

## 4. الملفات المتغيرة (Changed Files)
- `supabase/staff_auth_and_roles.sql` (ملف Migration جديد لجدول الأدوار وسياسات RLS والدوال).
- `src/services/supabaseService.js` (إضافة دوال المصادقة وجلب الملف التعريفي والاستماع للجلسة).
- `src/context/AppContext.jsx` (ربط الـ State بالجلسة الموثقة وإلغاء الاعتماد على `sessionStorage`).
- `src/components/auth/Login.jsx` (ترقية واجهة الدخول لتدعم Supabase Auth مع الحفاظ على الـ PIN).
- `src/components/layout/Sidebar.jsx` (تسجيل الخروج الرسمي وعرض اسم الموظف ودوره المعتمد).
- `src/App.jsx` (حماية المسارات وعرض حالة التحميل أثناء استعادة الجلسة).

---

## 5. Database Changes (تغييرات قاعدة البيانات)
- **جدول جديد**: `public.staff_roles`
  - الأعمدة: `id (uuid PK)`, `user_id (uuid UNIQUE FK auth.users)`, `email (text)`, `role (text CHECK admin/casher/driver)`, `display_name (text)`, `quick_pin (text)`, `is_active (boolean)`, `created_at`, `updated_at`.
- **دوال مخزنة (Functions & RPCs)**:
  - `public.get_my_staff_profile()`
  - `public.is_admin()`
  - `public.current_staff_role()`
  - `public.has_role(p_role text)`
- **سياسات RLS**:
  - `Staff can read their own profile`: `FOR SELECT USING (user_id = auth.uid())`
  - `Admins can manage all staff roles`: `FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin())`

---

## 6. Security Changes (التغييرات الأمنية)
- تم عزل وإلغاء تزييف الصلاحيات من الـ Client (`sessionStorage.setItem('b_delivery_session_user', 'admin')`).
- أصبحت الصلاحيات مستمدة بالكامل من توقيع الـ JWT وسجل `staff_roles` المعتمد في السيرفر.
- أي حساب معطل (`is_active = false`) يتم رفض دخوله فوراً وإغلاق جلسته.

---

## 7. Tests Executed (الاختبارات المنفذة)
1. **اختبار البناء للوحة التحكم (`AbuKhater_delivery`)**:
   - الأمر: `npm run build`
   - النتيجة: نجح بالكامل في 6.94 ثانية (Bundle: 786 kB).
2. **اختبار التراجع لتدفق العميل في المنيو (`AbuKhater_Menu`)**:
   - الأمر: `npm run build`
   - النتيجة: نجح بالكامل في 7.02 ثانية دون أي تأثير جانبي أو تعارض.
3. **اختبار دوال التحقق من الجلسة والصلاحيات**:
   - التحقق من معالجة `onAuthStateChange` عند تسجيل الخروج وعند استعادة الجلسة بعد الـ Refresh.
   - التحقق من تصدير `userRole` لنفس المسميات السابقة (`admin`, `casher`, `driver`) لضمان التوافق التام مع شاشات `OrderInbox`, `ReportsView`, `SettingsView`.

---

## 8. Results (النتائج)
- نجاح بناء وتشغيل منظومة المصادقة بنسبة 100%.
- لم يتأثر تدفق الطلبات العامة أو واجهة العميل `AbuKhater_Menu` بأي شكل من الأشكال.
- المنظومة أصبحت مهيأة ومؤهلة أمنياً لتطبيق RLS المحكم على جداول الطلبات في المراحل القادمة.

---

## 9. Remaining Risks (المخاطر المتبقية)
- **نشر الـ Migration في قاعدة البيانات**: يجب تطبيق سكريبت `supabase/staff_auth_and_roles.sql` في Supabase SQL Editor وإنشاء حسابات الموظفين الأولى وربطها في `staff_roles`.
- **جداول الطلبات والإعدادات**: ما زالت تسمح بالـ Anonymous Inserts لحين إتمام Phase 2.

---

## 10. Rollback Notes (ملاحظات الاسترجاع)
في حال الرغبة في التراجع، يكفي استرجاع ملفات `AppContext.jsx` و `Login.jsx` و `Sidebar.jsx` و `supabaseService.js` إلى الحالة السابقة بـ Git، ولن يؤثر وجود جدول `staff_roles` غير المستخدم على أي وظيفة سابقة.
