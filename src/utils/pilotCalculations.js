// src/utils/pilotCalculations.js
/**
 * 🏍️ محرك الحساب المالي الموحد لأجر وبدلات الطيارين
 * 
 * القواعد المالية الموحدة مستخرجة مباشرة من الكود الفعلي للمشروع:
 * 1. المشاوير الخاصة (type === 'trip' أو source === 'external'):
 *    - نصيب الطيار: 100% من رسم المشوار (deliveryFee).
 *    - المصدر: AppContext.jsx (السطور 1112-1117)، ReportsView.jsx (السطر 195 والسطر 391).
 * 
 * 2. طلبات التوصيل العادية (مطعم / أونلاين / طلبات):
 *    - نصيب الطيار: 50% من رسم التوصيل (deliveryFee / 2).
 *    - المصدر: AppContext.jsx (السطر 1119)، ReportsView.jsx (السطور 195، 391، 769-777).
 * 
 * 3. الطلبات الفاشلة / المرفوضة (failed_delivery):
 *    - نصيب الطيار: 0 ج.م.
 *    - المصدر: ReportsView.jsx (السطر 195: isFailed ? 0 : ...).
 * 
 * 4. بدل الحضور والشيفت:
 *    - الحساب: Math.floor(capShiftMinutes(totalMinutes) / 35) * 15
 *    - 15 ج.م لكل 35 دقيقة حضور فعلية مسجلة ومحددة بسقف أقصى 10 ساعات (600 دقيقة).
 *    - المصدر: AppContext.jsx و shiftLogic.js.
 */

import { capShiftMinutes } from './shiftLogic.js';

/**
 * فحص ما إذا كان الطلب مسنداً لطيار محدد مع معالجة اختلاف الأنواع (string vs number)
 * بين delivery_id (bigint) و pilot_id (text).
 */
export const isOrderAssignedToPilot = (order, pilotId) => {
  if (!order || pilotId == null) return false;
  const pId = Number(pilotId);
  const orderPilotId = Number(order.deliveryId || order.pilotId);
  return Number.isFinite(pId) && Number.isFinite(orderPilotId) && pId === orderPilotId;
};

/**
 * تحديد نوع الطلب وما إذا كان مشواراً خاصاً
 */
export const isTripOrder = (order) => {
  if (!order) return false;
  return (
    order.type === 'trip' ||
    order.source === 'external' ||
    String(order.order_type || '').toLowerCase() === 'trip'
  );
};

/**
 * حساب نصيب الطيار من رسم التوصيل لطلب فردي
 */
export const calculateOrderPilotShare = (order) => {
  if (!order) return 0;
  const isFailed = order.status === 'failed_delivery' || order.status === 'cancelled';
  if (isFailed) return 0;

  const fee = Number(order.deliveryFee || order.delivery_fee || 0);
  if (fee <= 0) return 0;

  // مشوار خاص -> 100% من رسم التوصيل
  if (isTripOrder(order)) {
    return fee;
  }

  // طلب توصيل عادي (مطعم / أونلاين / طلبات) -> 50%
  return fee / 2;
};

/**
 * حساب بدل الحضور للطيار بالدقائق (سقف أقصى 10 ساعات = 600 دقيقة)
 */
export const calculateAttendancePay = (totalMinutes) => {
  const safeMinutes = Number(totalMinutes) || 0;
  const cappedMinutes = capShiftMinutes(safeMinutes);
  return Math.floor(cappedMinutes / 35) * 15;
};

/**
 * محرك تجميع مستحقات وأداء الطيار الشامل
 * يحسب الدقائق منذ فتح الشيفت لحين إغلاقه بحد أقصى 10 ساعات يومياً (600 دقيقة)
 */
export const calculatePilotShiftSummary = (pilot, orders = [], activeSessionMinutes = 0) => {
  const pilotId = pilot?.id;
  const rawMinutes = (Number(pilot?.totalMinutes) || 0) + (Number(activeSessionMinutes) || 0);
  const totalMinutes = capShiftMinutes(rawMinutes);

  let ordersCount = 0;
  let tripsCount = 0;
  let restaurantOrdersCount = 0;
  let talabatOrdersCount = 0;
  let onlineOrdersCount = 0;
  let failedCount = 0;

  let feeEarnings = 0;
  let tripEarnings = 0;
  let restaurantEarnings = 0;
  let talabatEarnings = 0;
  let onlineEarnings = 0;

  orders.forEach(o => {
    if (!isOrderAssignedToPilot(o, pilotId)) return;

    const isCompleted = o.status === 'completed' || o.status === 'delivered';
    const isFailed = o.status === 'failed_delivery';

    if (isFailed) {
      failedCount++;
      return;
    }

    const share = calculateOrderPilotShare(o);
    const isTrip = isTripOrder(o);

    if (isTrip) {
      tripsCount++;
      if (isCompleted) {
        tripEarnings += share;
        feeEarnings += share;
      }
    } else {
      if (isCompleted) {
        ordersCount++;
        feeEarnings += share;
      }

      const src = o.source || (o.type === 'talabat' ? 'talabat' : 'manual');
      if (src === 'online') {
        onlineOrdersCount++;
        if (isCompleted) onlineEarnings += share;
      } else if (src === 'talabat') {
        talabatOrdersCount++;
        if (isCompleted) talabatEarnings += share;
      } else {
        restaurantOrdersCount++;
        if (isCompleted) restaurantEarnings += share;
      }
    }
  });

  const attendancePay = calculateAttendancePay(totalMinutes);
  const totalEarnings = feeEarnings + attendancePay;

  return {
    ...pilot,
    ordersCount,
    tripsCount,
    restaurantOrdersCount,
    talabatOrdersCount,
    onlineOrdersCount,
    failedCount,
    totalMinutes,
    feeEarnings,
    tripEarnings,
    restaurantEarnings,
    talabatEarnings,
    onlineEarnings,
    attendancePay,
    totalEarnings
  };
};
