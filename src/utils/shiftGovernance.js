// src/utils/shiftGovernance.js
//
// نظام التحكم في أوقات تشغيل الورديات (Shift Schedule Governance).
// قاعدة البيانات هي المصدر الوحيد للحقيقة في أوقات الفتح/الإغلاق.
//
// كل الحسابات الزمنية تتم بتوقيت Africa/Cairo بشكل موحد، والتوقيت الصيفي
// يُعالَج تلقائياً عبر Intl (بدون أي إزاحة UTC ثابتة).
//
// isShiftOperationAllowed() هو المرجع المركزي الوحيد لفحص:
//   - فتح وردية
//   - إغلاق وردية
//   - الإغلاق الإجباري (Force Close)
//   - التحقق من الوقت التشغيلي

export const CAIRO_TIMEZONE = 'Africa/Cairo';

// القيم الافتراضية تُستخدم فقط لو تعذّر تحميل الإعدادات من قاعدة البيانات.
export const DEFAULT_SHIFT_OPEN_TIME = '06:00';
export const DEFAULT_SHIFT_CLOSE_TIME = '04:00';

/**
 * يحوّل "HH:MM" (أو "HH:MM:SS") إلى عدد الدقائق منذ منتصف الليل.
 * يُعيد null لو القيمة غير صالحة.
 */
export const parseTimeToMinutes = (timeStr) => {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const parts = timeStr.split(':');
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1] ?? '0', 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return ((h % 24) * 60) + (m % 60);
};

/**
 * عدد الدقائق منذ منتصف الليل بتوقيت القاهرة للحظة معينة (افتراضياً الآن).
 */
export const getCairoMinutesOfDay = (now = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: CAIRO_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(now);

  const hour = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10) % 24;
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0', 10);
  return (hour * 60) + minute;
};

/**
 * تاريخ "YYYY-MM-DD" بتوقيت القاهرة للحظة معينة (افتراضياً الآن).
 */
export const getCairoDateString = (now = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CAIRO_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  const year = parts.find(p => p.type === 'year')?.value;
  const month = parts.find(p => p.type === 'month')?.value;
  const day = parts.find(p => p.type === 'day')?.value;
  return `${year}-${month}-${day}`;
};

/**
 * تنسيق "HH:MM" لعرض عربي ودود (مثال: "06:00" → "6:00 ص").
 */
export const formatTimeArabic = (timeStr) => {
  const mins = parseTimeToMinutes(timeStr);
  if (mins === null) return timeStr || '';
  let hour = Math.floor(mins / 60);
  const minute = String(mins % 60).padStart(2, '0');
  const suffix = hour >= 12 ? 'م' : 'ص';
  hour = hour % 12 || 12;
  return `${hour}:${minute} ${suffix}`;
};

/**
 * هل اللحظة الحالية داخل نافذة التشغيل [open → close]؟
 * يدعم اليوم التشغيلي الممتد بعد منتصف الليل (close <= open).
 */
export const isWithinOperatingWindow = (openMinutes, closeMinutes, now = new Date()) => {
  const cur = getCairoMinutesOfDay(now);
  const overnight = closeMinutes <= openMinutes;
  if (overnight) {
    // مثال: فتح 06:00 وإغلاق 04:00 → النافذة من 06:00 حتى 04:00 صباح اليوم التالي.
    return cur >= openMinutes || cur < closeMinutes;
  }
  return cur >= openMinutes && cur < closeMinutes;
};

/**
 * المرجع المركزي الوحيد لكل قرارات حوكمة الوردية.
 *
 * @param {Object} params
 * @param {'open'|'close'} params.operation  نوع العملية المطلوبة.
 * @param {string} [params.openTime]   وقت الفتح "HH:MM" (من قاعدة البيانات).
 * @param {string} [params.closeTime]  وقت الإغلاق "HH:MM" (من قاعدة البيانات).
 * @param {boolean} [params.isAdmin]   هل المستخدم Admin؟
 * @param {boolean} [params.forceClose] هل طلب إغلاق إجباري؟ (يحتاج Admin)
 * @param {Date}   [params.now]        لحظة الفحص (تُستخدم في الاختبارات).
 * @returns {{ allowed: boolean, reason: string, code: string }}
 */
export const isShiftOperationAllowed = ({
  operation,
  openTime = DEFAULT_SHIFT_OPEN_TIME,
  closeTime = DEFAULT_SHIFT_CLOSE_TIME,
  isAdmin = false,
  forceClose = false,
  now = new Date()
} = {}) => {
  const openMinutes = parseTimeToMinutes(openTime) ?? parseTimeToMinutes(DEFAULT_SHIFT_OPEN_TIME);
  const closeMinutes = parseTimeToMinutes(closeTime) ?? parseTimeToMinutes(DEFAULT_SHIFT_CLOSE_TIME);

  const openLabel = formatTimeArabic(openTime);
  const closeLabel = formatTimeArabic(closeTime);

  // ── فتح وردية ─────────────────────────────────────────────────────────
  if (operation === 'open') {
    if (isWithinOperatingWindow(openMinutes, closeMinutes, now)) {
      return { allowed: true, reason: 'مسموح بفتح الوردية', code: 'OPEN_ALLOWED' };
    }
    return {
      allowed: false,
      reason: `⏰ لا يمكن فتح وردية الآن. مواعيد التشغيل من ${openLabel} إلى ${closeLabel} (بتوقيت القاهرة).`,
      code: 'OPEN_OUTSIDE_HOURS'
    };
  }

  // ── إغلاق وردية ───────────────────────────────────────────────────────
  if (operation === 'close') {
    const cur = getCairoMinutesOfDay(now);
    // "قبل موعد الإغلاق" = ما زلنا في الجزء التشغيلي الذي يسبق وقت الإغلاق
    // (الفترة بعد منتصف الليل وقبل الإغلاق في اليوم الممتد).
    const tooEarly = cur < closeMinutes;

    if (!tooEarly) {
      return { allowed: true, reason: 'مسموح بإغلاق الوردية', code: 'CLOSE_ALLOWED' };
    }
    if (forceClose && isAdmin) {
      return { allowed: true, reason: 'إغلاق إجباري بواسطة المدير (Force Close)', code: 'CLOSE_FORCED' };
    }
    if (forceClose && !isAdmin) {
      return {
        allowed: false,
        reason: '🔒 الإغلاق الإجباري متاح للمدير (Admin) فقط.',
        code: 'CLOSE_FORCE_DENIED'
      };
    }
    return {
      allowed: false,
      reason: `⏰ لا يمكن إغلاق الوردية قبل موعد الإغلاق (${closeLabel} بتوقيت القاهرة).`,
      code: 'CLOSE_TOO_EARLY'
    };
  }

  return { allowed: false, reason: 'عملية غير معروفة', code: 'UNKNOWN_OPERATION' };
};

/**
 * هل حان وقت الإغلاق التلقائي؟ (عند بلوغ وقت الإغلاق بتوقيت القاهرة)
 */
export const isAutoCloseTimeNow = (closeTime = DEFAULT_SHIFT_CLOSE_TIME, now = new Date()) => {
  const closeMinutes = parseTimeToMinutes(closeTime) ?? parseTimeToMinutes(DEFAULT_SHIFT_CLOSE_TIME);
  const cur = getCairoMinutesOfDay(now);
  // نافذة تنفيذ صغيرة (15 دقيقة) لضمان التقاط الإغلاق التلقائي حتى مع فاصل الفحص.
  return cur >= closeMinutes && cur < closeMinutes + 15;
};
