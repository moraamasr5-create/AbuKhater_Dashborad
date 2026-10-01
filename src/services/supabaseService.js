// Developed & Owned by D.AmrMamdouh - 01038035884
import { supabase } from './supabase/supabaseClient';
import { safeGetItem, safeSetItem } from '../utils/safeStorage';
import { capShiftMinutes } from '../utils/shiftLogic';

// ============================================================
// OFFLINE SYNC QUEUE
// ============================================================

const QUEUE_KEY = 'delivery_pending_sync';
const FAILED_QUEUE_KEY = 'delivery_failed_sync';
export const MAX_QUEUE_RETRIES = 3;

/**
 * يقرأ قائمة العمليات المنتظرة من localStorage
 */
export const getPendingQueue = () => {
  try { return JSON.parse(safeGetItem(QUEUE_KEY)) || []; }
  catch { return []; }
};

/**
 * يحفظ قائمة العمليات المنتظرة في localStorage
 */
export const savePendingQueue = (queue) => {
  safeSetItem(QUEUE_KEY, JSON.stringify(queue));
  notifyQueueChange();
};

/**
 * يقرأ قائمة العمليات التي فشلت نهائياً وتحتاج تدخل يدوي
 */
export const getFailedQueue = () => {
  try { return JSON.parse(safeGetItem(FAILED_QUEUE_KEY)) || []; }
  catch { return []; }
};

/**
 * يحفظ قائمة العمليات الفاشلة نهائياً
 */
export const saveFailedQueue = (queue) => {
  safeSetItem(FAILED_QUEUE_KEY, JSON.stringify(queue));
  notifyQueueChange();
};

/**
 * مسح قائمة العمليات الفاشلة بعد مراجعة الكاشير
 */
export const clearFailedQueue = () => {
  safeSetItem(FAILED_QUEUE_KEY, JSON.stringify([]));
  notifyQueueChange();
};

/**
 * نظام إشعار المشتركين بتغيرات الطابور
 */
const queueListeners = new Set();
export const onQueueChange = (callback) => {
  queueListeners.add(callback);
  callback({ pending: getPendingQueue().length, failed: getFailedQueue().length });
  return () => queueListeners.delete(callback);
};

const notifyQueueChange = () => {
  const status = { pending: getPendingQueue().length, failed: getFailedQueue().length };
  queueListeners.forEach(fn => {
    try { fn(status); } catch (e) { console.error('Queue listener error:', e); }
  });
};

/**
 * يضيف عملية فاشلة لقائمة الانتظار لإعادة المحاولة عند عودة الاتصال
 */
const queueSync = (action, payload) => {
  const q = getPendingQueue();
  q.push({
    action,
    payload,
    id: Date.now(),
    retries: 0,
    createdAt: new Date().toISOString()
  });
  savePendingQueue(q);
};

/**
 * يعيد تشغيل العمليات المنتظرة في القائمة عند عودة الاتصال بالإنترنت
 * يمنع التكرار اللانهائي وينقل العمليات الفاشلة نهائياً إلى failedQueue مع توضيح السبب
 */
let isSyncing = false;
export const processPendingSync = async () => {
  if (!navigator.onLine || isSyncing) return { processed: 0, remaining: 0, failed: 0 };
  const q = getPendingQueue();
  if (!q.length) return { processed: 0, remaining: 0, failed: getFailedQueue().length };

  isSyncing = true;
  console.log(`🔄 Processing ${q.length} pending offline syncs...`);
  const remainingQueue = [];
  const failedQueue = getFailedQueue();
  let processedCount = 0;

  try {
    for (const item of q) {
      const currentRetries = (item.retries || 0) + 1;
      try {
        if (item.action === 'updateOrderStatus') {
          await supabaseService.updateOrderStatus(item.payload.supabaseId, item.payload.newStatus, item.payload.reason, item.payload.extraFields, true);
        } else if (item.action === 'updatePilotState') {
          await supabaseService.updatePilotState(item.payload.id, item.payload.stateUpdates, true);
        } else if (item.action === 'saveShiftReport') {
          await supabaseService.saveShiftReport(item.payload, true);
        } else if (item.action === 'createShift') {
          await supabaseService.createShift(item.payload, true);
        } else if (item.action === 'updateMenuAvailability') {
          await supabaseService.updateMenuAvailability(item.payload.itemName, item.payload.isAvailable, true);
        } else if (item.action === 'updateAppConfig') {
          await supabaseService.updateAppConfig(item.payload.key, item.payload.value, true);
        } else if (item.action === 'createReservation') {
          await supabaseService.createReservation(item.payload, true);
        } else if (item.action === 'updateReservationStatus') {
          await supabaseService.updateReservationStatus(item.payload.id, item.payload.newStatus, item.payload.refNum, item.payload.paymentProof, true);
        } else if (item.action === 'deleteReservation') {
          await supabaseService.deleteReservation(item.payload.id, true);
        } else if (item.action === 'resetAllPilots') {
          await supabaseService.resetAllPilots(item.payload.pilotIds, true);
        } else if (item.action === 'createManualOrder') {
          await supabaseService.createManualOrder(item.payload, true);
        } else if (item.action === 'updateOrderPaymentScreenshot') {
          await supabaseService.updateOrderPaymentScreenshot(item.payload.supabaseId, item.payload.screenshotUrl, true);
        } else if (item.action === 'assignOrderToPilot') {
          await supabaseService.assignOrderToPilot(item.payload.orderId, item.payload.pilotId, item.payload.pilotName, item.payload.mutationId, true);
        } else if (item.action === 'startPilotTrip') {
          await supabaseService.startPilotTrip(item.payload.orderId, item.payload.mutationId, true);
        } else if (item.action === 'completeOrderDelivery') {
          await supabaseService.completeOrderDelivery(item.payload.orderId, item.payload.mutationId, true);
        } else if (item.action === 'failOrderDelivery') {
          await supabaseService.failOrderDelivery(item.payload.orderId, item.payload.reason, item.payload.mutationId, true);
        } else if (item.action === 'togglePilotShift') {
          await supabaseService.togglePilotShift(item.payload.pilotId, item.payload.forceReopen, item.payload.mutationId, true);
        }
        processedCount++;
      } catch (e) {
        const errMsg = e?.message || String(e);
        const isPermanent = (
          currentRetries >= MAX_QUEUE_RETRIES ||
          e?.code === 'P0001' ||
          e?.code === '42501' ||
          errMsg.includes('Unauthorized') ||
          errMsg.includes('Forbidden') ||
          errMsg.includes('not found') ||
          errMsg.includes('violates foreign key') ||
          errMsg.includes('duplicate key')
        );

        if (isPermanent) {
          console.error(`❌ [Offline Sync] Item permanently failed (${item.action}):`, errMsg);
          failedQueue.push({
            ...item,
            retries: currentRetries,
            failedAt: new Date().toISOString(),
            error: errMsg
          });
        } else {
          console.warn(`⚠️ [Offline Sync] Item failed (attempt ${currentRetries}/${MAX_QUEUE_RETRIES}), keeping in queue:`, item);
          remainingQueue.push({
            ...item,
            retries: currentRetries,
            lastError: errMsg
          });
        }
      }
    }

    safeSetItem(QUEUE_KEY, JSON.stringify(remainingQueue));
    safeSetItem(FAILED_QUEUE_KEY, JSON.stringify(failedQueue));
    notifyQueueChange();

    return {
      processed: processedCount,
      remaining: remainingQueue.length,
      failed: failedQueue.length
    };
  } finally {
    isSyncing = false;
  }
};

/**
 * يعيد محاولة جميع العمليات الفاشلة نهائياً بنقلها إلى طابور الانتظار
 */
export const retryFailedQueue = async () => {
  const failed = getFailedQueue();
  if (!failed.length) return { processed: 0, remaining: 0, failed: 0 };
  const pending = getPendingQueue();
  const resetItems = failed.map(item => ({
    ...item,
    retries: 0,
    lastError: null
  }));
  savePendingQueue([...pending, ...resetItems]);
  clearFailedQueue();
  return processPendingSync();
};

// يعيد المحاولة تلقائياً عند عودة الاتصال
window.addEventListener('online', () => {
  processPendingSync();
});

/**
 * Wrapper مشترك: يُشغّل أي Supabase call مع fallback صامت عند انقطاع الاتصال
 * @param {string} actionName - اسم العملية للـ queue
 * @param {Function} promiseFn - الدالة التي ترسل الطلب لـ Supabase
 * @param {object|null} queuePayload - البيانات التي ستُخزّن في الـ queue إذا فشلت
 * @param {boolean} skipQueue - تخطي الـ queue (للـ retry من الـ queue نفسها)
 */
const newMutationId = () => (
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `mut-${Date.now()}-${Math.random().toString(16).slice(2)}`
);

const withOfflineSupport = async (actionName, promiseFn, queuePayload, skipQueue = false) => {
  try {
    if (!navigator.onLine) throw new Error('Offline');
    return await promiseFn();
  } catch (err) {
    console.warn(`⚠️ [${actionName}] error:`, err?.message || err);
    
    // Do NOT queue if it is a Postgres validation exception (code 'P0001')
    const isValidationError = err && (
      err.code === 'P0001' || 
      (err.message && (
        err.message.includes('Too early') || 
        err.message.includes('Active orders') || 
        err.message.includes('نشطة') || 
        err.message.includes('الوردية')
      ))
    );
    
    if (isValidationError) {
      throw err;
    }

    if (!skipQueue && queuePayload) queueSync(actionName, queuePayload);
    return null;
  }
};

// ============================================================
// SCHEMA REFERENCE (orders table - authoritative column names)
// ============================================================
// id, customer_name, customer_phone, customer_phone_2,
// order_type, total_amount, delivery_fee, service_fee,
// paid_now, remaining_amount, status, delivery_address,
// payment_method, payment_screenshot, latitude, longitude,
// raw_payload, source, original_id, pilot_id, pilot_name, created_at

// SCHEMA REFERENCE (delivery table - pilots)
// id, name, phone, number_motor, number_id, state,
// last_return_time, total_minutes, orders_count, shift_used,
// shift_started_at, shift_ended_at, status(bool), created_at

// SCHEMA REFERENCE (reservations table)
// id, customer_name, customer_phone, reservation_date,
// reservation_time, guests_count, location_type, notes,
// status, payment_proof_url, deposit_amount, ref_number, created_at

// ============================================================
// TIME HELPERS
// ============================================================

/**
 * Converts a 24-h time string ("HH:MM:SS" or "HH:MM") → 12-h short format
 * e.g. "08:00:00" → "8:00A"  |  "22:00:00" → "10:00P"
 */
const formatTime = (t) => {
  if (!t) return null;
  const [hourStr, minuteStr] = t.split(':');
  let hour = parseInt(hourStr, 10);
  const minute = minuteStr || '00';
  const ampm = hour >= 12 ? 'P' : 'A';
  hour = hour % 12 || 12;
  return `${hour}:${minute}${ampm}`;
};

// ============================================================
export const supabaseService = {

  // ─────────────────────────────────────────────────────────
  // 1. fetchOrders
  //    يجلب الطلبات من جدول orders ويحوّلها لشكل الـ UI
  // ─────────────────────────────────────────────────────────
  async fetchOrders(shiftId = null) {
    return withOfflineSupport('fetchOrders', async () => {
      let query = supabase
        .from('orders')
        .select('*, order_items(*), delivery:delivery_id(id, name, phone, state)')
        .order('created_at', { ascending: false });

      if (shiftId) {
        query = query.eq('shift_id', shiftId);
      } else {
        query = query.limit(50);
      }

      const { data, error } = await query;

      if (error) { console.error('❌ fetchOrders:', error); return []; }
      if (!data) return [];

      return data.map(row => {
        const rawPayload = row.raw_payload || {};

        // Order items: from order_items join OR raw_payload fallback
        const rawItems = (row.order_items && row.order_items.length > 0)
          ? row.order_items.map(i => ({
              name: i.product_name || 'صنف غير معروف',
              count: Number(i.quantity || 1),
              price: Number(i.unit_price || 0),
              category: 'عام',
              total: Number(i.total_price || 0),
              menuItemId: i.item_id || i.menu_item_id || null
            }))
          : (rawPayload.items || []).map(item => ({
              name: item.name || item.item_name || 'صنف غير معروف',
              count: Number(item.quantity || item.count || 1),
              price: Number(item.price || item.unit_price || 0),
              category: item.category || 'عام',
              total: Number(item.total || (Number(item.price || 0) * Number(item.quantity || 1))),
              menuItemId: item.menuItemId || item.menu_item_id || null
            }));

        const itemsDescription = rawItems.length > 0
          ? rawItems.map(i => `${i.count}x ${i.name}`).join(', ')
          : 'طلب خارجي (بدون تفاصيل)';

        // Status mapping: DB English/Arabic → internal status
        let mappedStatus = 'pending';
        const rawStatus = String(row.status || '').trim();
        if (rawStatus === 'out_for_delivery' || rawStatus === 'active') mappedStatus = 'active';
        else if (rawStatus === 'confirmed' || rawStatus === 'في التحضير') mappedStatus = 'waiting_driver';
        else if (rawStatus === 'تم الإسناد للطيار') mappedStatus = 'driver_assigned';
        else if (rawStatus === 'في الطريق للتسليم') mappedStatus = 'active';
        else if (rawStatus === 'تم التوصيل' || rawStatus === 'delivered') mappedStatus = 'completed';
        // نقوم بإضافة هذين السطرين قبل فلترة الحالة في دالة fetchOrders:
        else if (rawStatus.startsWith('ملغي') || rawStatus === 'ملغي') mappedStatus = 'cancelled';
        else if (rawStatus.startsWith('فشل التوصيل') || rawStatus === 'فشل التوصيل') mappedStatus = 'failed_delivery';
        else if (['pending', 'waiting_driver', 'driver_assigned', 'completed', 'delivered', 'cancelled', 'failed_delivery'].includes(rawStatus)) {
          mappedStatus = rawStatus === 'delivered' ? 'completed' : rawStatus;
        }

        // original_id: DB column first, then raw_payload fallback
        const orderId = row.original_id || rawPayload.order_id || `#${row.id.slice(0, 6)}`;

        // Strict Pricing Logic
        const itemsTotal = rawItems.reduce((sum, item) => sum + (item.price * item.count), 0);
        const deliveryFee = Number(row.delivery_fee || rawPayload.totals?.delivery_fee || 0);
        const serviceFee = Number(row.service_fee || rawPayload.totals?.service_fee || 0);
        const computedTotal = itemsTotal + deliveryFee + serviceFee;

        const isCashOnDelivery = (!row.payment_method || row.payment_method === 'Cash' || String(row.payment_method).toLowerCase().includes('cash'));
        const paidNow = isCashOnDelivery ? 0 : Number(row.paid_now || rawPayload.totals?.paid_now || 0);
        const remainingAmount = isCashOnDelivery ? computedTotal : (computedTotal - paidNow);

        return {
          supabaseId: row.id,
          id: `EXT-${row.id}`,
          originalId: String(orderId),
          type: row.order_type || 'delivery',
          source: row.source || 'online',
          customerName: row.customer_name || rawPayload.customer?.full_name || 'عميل غير معروف',
          phone: row.customer_phone || rawPayload.customer?.phone_1 || 'غير مسجل',
          phone2: row.customer_phone_2 || rawPayload.customer?.phone_2 || '',
          area: row.delivery_address || rawPayload.customer?.delivery_info?.address || 'استلام من المطعم',
          total: computedTotal,
          deliveryFee,
          subtotal: itemsTotal,
          serviceFee,
          paidNow,
          remainingAmount,
          items: rawItems,
          itemsDescription,
          paymentMethod: row.payment_method || rawPayload.customer?.payment_method || 'Cash',
          paymentScreenshot: row.payment_screenshot || rawPayload.payment?.screenshot || null,
          status: mappedStatus,
          canonicalStatus: row.status || mappedStatus,
          paymentStatus: row.payment_status || (isCashOnDelivery ? 'cash_on_delivery' : (row.payment_screenshot ? 'pending_verification' : 'pending_payment')),
          cancellationReason: row.cancellation_reason || null,
          statusHistory: row.status_history || [],
          displayStatus: rawStatus || 'pending',
          timestamp: row.created_at || rawPayload.timestamp || new Date().toISOString(),
          pilotId: row.pilot_id || null,
          pilotName: row.pilot_name || null,
          deliveryId: row.delivery_id || null,
          delivery: row.delivery || null,
          lat: Number(row.latitude) || rawPayload.customer?.delivery_info?.coordinates?.lat || null,
          lng: Number(row.longitude) || rawPayload.customer?.delivery_info?.coordinates?.lon || null,
          rawPayload
        };
      });
    }, null);
  },

  // ─────────────────────────────────────────────────────────
  // 1.5 createManualOrder
  //    ينشئ صف الطلب أولاً بدون صورة إيصال (لتجنب تضارب الـ payload)
  // ─────────────────────────────────────────────────────────
  async createManualOrder(orderData, skipQueue = false) {
    return withOfflineSupport('createManualOrder', async () => {
      const items = (orderData.items || []).map(item => ({
        item_id: item.itemId || item.id || null,
        name: item.name,
        quantity: Number(item.count || item.quantity || 1),
        price: Number(item.price || item.unit_price || 0)
      }));

      const mutationId = orderData.mutationId || newMutationId();

      const rpcParams = {
        p_receipt_no: orderData.id ? String(orderData.id) : null,
        p_order_type: orderData.type || 'delivery',
        p_source: orderData.source || 'manual',
        p_customer_name: orderData.customerName || 'عميل مطعم',
        p_customer_phone: orderData.phone || null,
        p_customer_phone_2: orderData.phone2 || null,
        p_delivery_address: orderData.area || null,
        p_payment_method: orderData.paymentMethod || 'Cash',
        p_delivery_fee: Number(orderData.deliveryFee || orderData.delivery_fee || 0),
        p_service_fee: Number(orderData.serviceFee || orderData.service_fee || 0),
        p_paid_now: orderData.paidNow !== undefined ? Number(orderData.paidNow) : null,
        p_latitude: Number(orderData.lat || orderData.latitude) || null,
        p_longitude: Number(orderData.lng || orderData.longitude) || null,
        p_items: items,
        p_shift_id: orderData.shiftId || null,
        p_idempotency_key: mutationId
      };

      const { data, error } = await supabase.rpc('create_manual_order', rpcParams);

      if (error) throw error;
      return { id: data?.order_id, ...data };
    }, orderData, skipQueue);
  },

  // ─────────────────────────────────────────────────────────
  // 1.6 updateOrderPaymentScreenshot
  //    يحدّث رابط صورة الإيصال بعد رفعها بنجاح إلى Storage
  // ─────────────────────────────────────────────────────────
  async updateOrderPaymentScreenshot(supabaseId, screenshotUrl, skipQueue = false) {
    if (!supabaseId) return;

    return withOfflineSupport('updateOrderPaymentScreenshot', async () => {
      const { error } = await supabase
        .from('orders')
        .update({ payment_screenshot: screenshotUrl })
        .eq('id', supabaseId);

      if (error) throw error;
    }, { supabaseId, screenshotUrl }, skipQueue);
  },

  // ─────────────────────────────────────────────────────────
  // ─────────────────────────────────────────────────────────
  // 2. updateOrderStatus (Authoritative Canonical State Transition)
  // ─────────────────────────────────────────────────────────
  async updateOrderStatus(supabaseId, newStatus, reason = null, extraFields = {}, skipQueue = false) {
    if (!supabaseId) return; // Manual orders have no supabaseId

    return withOfflineSupport('updateOrderStatus', async () => {
      // Map frontend action to canonical state
      let canonical = newStatus;
      if (newStatus === 'confirmed' || newStatus === 'waiting_driver') canonical = 'preparing';
      else if (newStatus === 'active' || newStatus === 'out_for_delivery') canonical = 'out_for_delivery';
      else if (newStatus === 'completed' || newStatus === 'delivered') canonical = 'delivered';
      else if (newStatus === 'failed_delivery') canonical = 'failed_delivery';
      else if (newStatus === 'cancelled') canonical = 'cancelled';

      const mutationId = newMutationId();
      const { data, error } = await supabase.rpc('transition_order_status', {
        p_order_id: supabaseId,
        p_target_status: canonical,
        p_reason: reason,
        p_mutation_id: mutationId
      });

      if (error) {
        // Fallback for fields not managed by transition_order_status (e.g. direct pilot re-assignment metadata)
        if (extraFields && Object.keys(extraFields).length > 0) {
          const updatePayload = {};
          if (extraFields.pilot_id !== undefined) updatePayload.pilot_id = String(extraFields.pilot_id);
          if (extraFields.pilot_name !== undefined) updatePayload.pilot_name = extraFields.pilot_name;
          if (extraFields.delivery_id !== undefined) updatePayload.delivery_id = extraFields.delivery_id;
          await supabase.from('orders').update(updatePayload).eq('id', supabaseId);
        }
        throw error;
      }

      if (extraFields && Object.keys(extraFields).length > 0) {
        const updatePayload = {};
        if (extraFields.pilot_id !== undefined) updatePayload.pilot_id = String(extraFields.pilot_id);
        if (extraFields.pilot_name !== undefined) updatePayload.pilot_name = extraFields.pilot_name;
        if (extraFields.delivery_id !== undefined) updatePayload.delivery_id = extraFields.delivery_id;
        await supabase.from('orders').update(updatePayload).eq('id', supabaseId);
      }

      return data;
    }, { supabaseId, newStatus, reason, extraFields }, skipQueue);
  },

  /**
   * التحقق من حالة دفع الطلب من قبل الكاشير / الإدارة
   */
  async verifyOrderPayment(supabaseId, paymentStatus, notes = null, skipQueue = false) {
    if (!supabaseId) return;

    return withOfflineSupport('verifyOrderPayment', async () => {
      const mutationId = newMutationId();
      const { data, error } = await supabase.rpc('verify_order_payment', {
        p_order_id: supabaseId,
        p_payment_status: paymentStatus,
        p_notes: notes,
        p_mutation_id: mutationId
      });

      if (error) throw error;
      return data;
    }, { supabaseId, paymentStatus, notes }, skipQueue);
  },

  // ─────────────────────────────────────────────────────────
  // 3. fetchReservations
  //    يجلب الحجوزات بأسماء الأعمدة الصحيحة من الـ Schema
  // ─────────────────────────────────────────────────────────
  async fetchReservations() {
    return withOfflineSupport('fetchReservations', async () => {
      const { data, error } = await supabase
        .from('reservations')
        .select('*')
        .neq('status', 'deleted')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error || !data) return [];

      return data.map(row => ({
        supabaseId: row.id,
        id: `RES-${row.id}`,
        customerName: row.customer_name || 'عميل بدون اسم',
        phone: row.customer_phone || '',          // customer_phone (not phone)
        date: row.reservation_date || '',         // reservation_date (not date)
        time: row.reservation_time || '',         // reservation_time (not time)
        guests: row.guests_count || 2,            // guests_count (not guests)
        locationType: row.location_type || 'restaurant',
        notes: row.notes || '',
        paymentProof: row.payment_proof_url || null,
        status: row.status || 'pending',
        deposit: Number(row.deposit_amount) || 0, // deposit_amount (not deposit)
        refNumber: row.ref_number || null,
        timestamp: row.created_at || new Date().toISOString()
      }));
    }, null);
  },

  // ─────────────────────────────────────────────────────────
  // 4. updateReservationStatus
  // ─────────────────────────────────────────────────────────
  async updateReservationStatus(id, newStatus, refNum = null, paymentProof = null, skipQueue = false) {
    return withOfflineSupport('updateReservationStatus', async () => {
      const { error } = await supabase
        .from('reservations')
        .update({ status: newStatus, ref_number: refNum, payment_proof_url: paymentProof })
        .eq('id', id);
      if (error) throw error;
    }, { id, newStatus, refNum, paymentProof }, skipQueue);
  },

  // ─────────────────────────────────────────────────────────
  // 5. fetchDeliveryDrivers
  //    يجلب الطيارين من جدول delivery (بالأعمدة الصحيحة)
  // ─────────────────────────────────────────────────────────
  async fetchDeliveryDrivers() {
    return withOfflineSupport('fetchDeliveryDrivers', async () => {
      const { data, error } = await supabase
        .from('delivery')
        .select('*')
        .order('id', { ascending: true });

      if (error || !data) return [];

      return data.map(row => ({
        id: row.id,
        name: row.name || 'طيار غير معروف',
        phone: row.phone || 'غير مسجل',
        state: (row.state === 'out' ? 'on_delivery' : (row.state || 'available')), // available | on_delivery | off
        balance: 0,                                   // لا يوجد في الـ Schema، يُحسب محلياً
        vehicle: 'موتوسيكل',                          // لا يوجد في الـ Schema
        created_at: row.created_at,
        shiftStatus: row.shift_started_at && !row.shift_ended_at ? 'open' : 'closed', // مشتق
        lastReturnTime: row.last_return_time || null,
        lastOpenedAt: row.shift_started_at || null,   // shift_started_at → lastOpenedAt
        lastClosedAt: row.shift_ended_at || null,    // shift_ended_at → lastClosedAt
        totalMinutes: capShiftMinutes(Number(row.total_minutes) || 0),
        ordersCount: Number(row.orders_count) || 0,
        shift: `${row.start_shift || '01:00'} - ${row.end_shift || '11:00'}`,
        numberMotor: row.number_motor || '',
        numberId: row.number_id || null,
        shiftUsed: Boolean(row.shift_used) || false,
        idDelivery: row.id_delivery || null
      }));
    }, null);
  },

  // ─────────────────────────────────────────────────────────
  // 6. addDeliveryDriver
  //    يضيف طيار جديد لجدول delivery
  // ─────────────────────────────────────────────────────────
  async addDeliveryDriver(driverData, skipQueue = false) {
    return withOfflineSupport('addDeliveryDriver', async () => {
      const { data, error } = await supabase
        .from('delivery')
        .insert([{
          name: driverData.name,
          phone: driverData.phone || null,
          number_motor: driverData.number_motor || null,
          number_id: driverData.number_id ? Number(driverData.number_id) : null,
          start_shift: driverData.start_shift || '01:00:00',
          end_shift: driverData.end_shift || '11:00:00'
        }])
        .select();
      if (error) throw error;
      return data;
    }, driverData, skipQueue);
  },

  async deleteDeliveryDriver(id, skipQueue = false) {
    return withOfflineSupport('deleteDeliveryDriver', async () => {
      const { error } = await supabase
        .from('delivery')
        .delete()
        .eq('id', id);
      if (error) throw error;
      return true;
    }, { id }, skipQueue);
  },

  // ─────────────────────────────────────────────────────────
  // 7. updatePilotState
  //    يحدّث حالة طيار في جدول delivery
  //    يُرمّز شفت الطيار عبر shift_started_at / shift_ended_at
  // ─────────────────────────────────────────────────────────
  async updatePilotState(id, stateUpdates, skipQueue = false) {
    return withOfflineSupport('updatePilotState', async () => {
      // Map frontend field names → DB column names
      const dbUpdates = {};
      if (stateUpdates.state !== undefined) dbUpdates.state = stateUpdates.state;
      if (stateUpdates.last_return_time !== undefined) dbUpdates.last_return_time = stateUpdates.last_return_time;
      if (stateUpdates.total_minutes !== undefined) dbUpdates.total_minutes = stateUpdates.total_minutes;
      if (stateUpdates.orders_count !== undefined) dbUpdates.orders_count = stateUpdates.orders_count;
      if (stateUpdates.shift_used !== undefined) dbUpdates.shift_used = stateUpdates.shift_used;

      // shift_status 'open' → set shift_started_at + clear shift_ended_at
      // shift_status 'closed' → set shift_ended_at فقط (نُبقي shift_started_at)
      if (stateUpdates.shift_status === 'open') {
        dbUpdates.shift_started_at = new Date().toISOString();
        dbUpdates.shift_ended_at = null;
      } else if (stateUpdates.shift_status === 'closed') {
        dbUpdates.shift_ended_at = stateUpdates.last_closed_at || new Date().toISOString();
      }

      // last_opened_at → shift_started_at (فقط عند تمرير وقت فعلي — لا نُصفّر وقت البداية عند الإغلاق)
      if (stateUpdates.last_opened_at) {
        dbUpdates.shift_started_at = stateUpdates.last_opened_at;
      }

      // last_closed_at → shift_ended_at (عند الإغلاق الصريح)
      if (stateUpdates.last_closed_at) {
        dbUpdates.shift_ended_at = stateUpdates.last_closed_at;
      }

      if (!Object.keys(dbUpdates).length) return;

      const { error } = await supabase
        .from('delivery')
        .update(dbUpdates)
        .eq('id', id);
      if (error) throw error;
    }, { id, stateUpdates }, skipQueue);
  },

  async updateDriverStatus(id, isOnline) {
    return this.updatePilotState(id, { shift_status: isOnline ? 'open' : 'closed' });
  },

  // ─────────────────────────────────────────────────────────
  // 7.5 Pilot/order lifecycle RPCs (atomic — prevents assignment races)
  // ─────────────────────────────────────────────────────────
  async assignOrderToPilot(orderId, pilotId, pilotName, mutationId = null, skipQueue = false) {
    const pMutationId = mutationId || newMutationId();
    return withOfflineSupport('assignOrderToPilot', async () => {
      const { data, error } = await supabase.rpc('assign_order_to_pilot', {
        p_order_id: orderId,
        p_pilot_id: pilotId,
        p_pilot_name: pilotName,
        p_mutation_id: pMutationId
      });
      if (error) throw error;
      return data;
    }, { orderId, pilotId, pilotName, mutationId: pMutationId }, skipQueue);
  },

  async startPilotTrip(orderId, mutationId = null, skipQueue = false) {
    const pMutationId = mutationId || newMutationId();
    return withOfflineSupport('startPilotTrip', async () => {
      const { data, error } = await supabase.rpc('start_pilot_trip', {
        p_order_id: orderId,
        p_mutation_id: pMutationId
      });
      if (error) throw error;
      return data;
    }, { orderId, mutationId: pMutationId }, skipQueue);
  },

  async completeOrderDelivery(orderId, mutationId = null, skipQueue = false) {
    const pMutationId = mutationId || newMutationId();
    return withOfflineSupport('completeOrderDelivery', async () => {
      const { data, error } = await supabase.rpc('complete_order_delivery', {
        p_order_id: orderId,
        p_mutation_id: pMutationId
      });
      if (error) throw error;
      return data;
    }, { orderId, mutationId: pMutationId }, skipQueue);
  },

  async failOrderDelivery(orderId, reason = null, mutationId = null, skipQueue = false) {
    const pMutationId = mutationId || newMutationId();
    return withOfflineSupport('failOrderDelivery', async () => {
      const { data, error } = await supabase.rpc('fail_order_delivery', {
        p_order_id: orderId,
        p_reason: reason,
        p_mutation_id: pMutationId
      });
      if (error) throw error;
      return data;
    }, { orderId, reason, mutationId: pMutationId }, skipQueue);
  },

  async togglePilotShift(pilotId, forceReopen = false, mutationId = null, skipQueue = false) {
    const pMutationId = mutationId || newMutationId();
    return withOfflineSupport('togglePilotShift', async () => {
      const { data, error } = await supabase.rpc('toggle_pilot_shift', {
        p_pilot_id: pilotId,
        p_force_reopen: forceReopen,
        p_mutation_id: pMutationId
      });
      if (error) throw error;
      return data;
    }, { pilotId, forceReopen, mutationId: pMutationId }, skipQueue);
  },

  // ─────────────────────────────────────────────────────────
  // 8. saveShiftReport & close_shift
  //    يغلق الوردية في Supabase مع الحساب المالي المعتمد من السيرفر
  // ─────────────────────────────────────────────────────────
  async saveShiftReport(reportData, skipQueue = false) {
    return withOfflineSupport('saveShiftReport', async () => {
      const { data, error } = await supabase.rpc('close_shift', {
        p_shift_id: String(reportData.id),
        p_stats: null, // الحساب المالي يتم بالكامل authoritative من جهة السيرفر
        p_force_close: Boolean(reportData.forceClose)
      });

      if (error) throw error;
      return data;
    }, reportData, skipQueue);
  },

  // ─────────────────────────────────────────────────────────
  // 8.2 fetchShiftReports
  //    يجلب تقارير الورديات المغلقة مع الإحصائيات المالية المعتمدة
  // ─────────────────────────────────────────────────────────
  async fetchShiftReports() {
    return withOfflineSupport('fetchShiftReports', async () => {
      const { data, error } = await supabase
        .from('shifts')
        .select('*')
        .eq('status', 'closed')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data || []).map(row => ({
        id: row.id,
        date: row.date,
        startTime: row.start_time,
        endTime: row.end_time,
        status: row.status,
        ordersCount: row.total_orders || row.stats?.ordersCount || 0,
        totalDeliveryFees: row.stats?.totalDeliveryFees || 0,
        totalAttendancePay: row.stats?.totalAttendancePay || 0,
        totalPilotDues: row.stats?.totalPilotDues || 0,
        pilotStats: row.stats?.pilotStats || row.stats?.pilotPerformance || [],
        financials: row.stats?.financials || {},
        sourceBreakdown: row.stats?.sourceBreakdown || {},
        reservationStats: row.stats?.reservationStats || {},
        stats: row.stats,
        ...row.stats
      }));
    }, null);
  },

  // ─────────────────────────────────────────────────────────
  // 8.3 getShiftStats
  //    يحسب الإحصائيات اللحظية للوردية من قاعدة البيانات مباشرة
  // ─────────────────────────────────────────────────────────
  async getShiftStats(shiftId) {
    if (!shiftId) return null;
    return withOfflineSupport('getShiftStats', async () => {
      const { data, error } = await supabase.rpc('calculate_shift_stats', {
        p_shift_id: String(shiftId)
      });
      if (error) throw error;
      return data;
    }, { shiftId });
  },

  // ─────────────────────────────────────────────────────────
  // 8.5 resetAllPilots
  // ─────────────────────────────────────────────────────────
  async resetAllPilots(pilotIds, skipQueue = false) {
    if (!pilotIds || !pilotIds.length) return;
    return withOfflineSupport('resetAllPilots', async () => {
      const { error } = await supabase
        .from('delivery')
        .update({
          state: 'available',
          shift_started_at: null,
          shift_ended_at: null,
          total_minutes: 0,
          orders_count: 0,
          shift_used: false
        })
        .in('id', pilotIds);
      if (error) throw error;
    }, { pilotIds }, skipQueue);
  },

  // ─────────────────────────────────────────────────────────
  // 9. createShift
  //    يفتح وردية جديدة في DB (مع تجاهل أخطاء الجدول)
  // ─────────────────────────────────────────────────────────
  async createShift(shiftData, skipQueue = false) {
    return withOfflineSupport('createShift', async () => {
      // open_shift RPC enforces the DB-controlled opening window (Africa/Cairo)
      // server-side, then inserts (or resumes) the shift atomically.
      const { data, error } = await supabase.rpc('open_shift', {
        p_id: shiftData.id,
        p_date: shiftData.date,
        p_start_time: shiftData.start_time || shiftData.startTime
      });
      if (error) throw error;
      return data;
    }, shiftData, skipQueue);
  },

  // ─────────────────────────────────────────────────────────
  // 9.5 getShiftByDate
  //     يبحث عن وردية مفتوحة بنفس التاريخ لاستئنافها
  // ─────────────────────────────────────────────────────────
  async getShiftByDate(dateString) {
    return withOfflineSupport('getShiftByDate', async () => {
      const { data, error } = await supabase
        .from('shifts')
        .select('*')
        .eq('date', dateString)
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return data;
    }, null);
  },

  // ─────────────────────────────────────────────────────────
  // 10. createReservation
  //     يحفظ حجز جديد بأسماء الأعمدة الصحيحة
  // ─────────────────────────────────────────────────────────
  async createReservation(resData, skipQueue = false) {
    return withOfflineSupport('createReservation', async () => {
      const { data, error } = await supabase
        .from('reservations')
        .insert([{
          customer_name: resData.customerName,
          customer_phone: resData.phone,            // customer_phone (not phone)
          reservation_date: resData.date,           // reservation_date (not date)
          reservation_time: resData.time,           // reservation_time (not time)
          guests_count: resData.guests || 2,        // guests_count (not guests)
          location_type: resData.type || resData.locationType,
          notes: resData.notes || null,
          deposit_amount: resData.deposit || 50,    // deposit_amount (not deposit)
          status: 'pending'
        }])
        .select();
      if (error) throw error;
      return data;
    }, resData, skipQueue);
  },

  async deleteReservation(id, skipQueue = false) {
    return withOfflineSupport('deleteReservation', async () => {
      const cleanId = String(id).replace(/^RES-/, '');
      const isNumericId = /^\d+$/.test(cleanId) || !isNaN(parseInt(cleanId, 10));
      if (!isNumericId) { console.warn('Invalid reservation ID for deletion:', cleanId); return; }
      
      const { error } = await supabase
        .from('reservations')
        .update({ status: 'deleted' })
        .eq('id', cleanId);
        
      if (error) throw error;
    }, { id }, skipQueue);
  },

  // ─────────────────────────────────────────────────────────
  // 11. Menu Items & Categories (إدارة المنيو والأقسام الرسمية)
  // ─────────────────────────────────────────────────────────

  /**
   * يجلب كافة التصنيفات مرتبة حسب display_order
   */
  async fetchCategories() {
    return withOfflineSupport('fetchCategories', async () => {
      const { data, error } = await supabase
        .from('categories')
        .select('*')
        .order('display_order', { ascending: true })
        .order('name', { ascending: true });
      if (error) throw error;
      return data || [];
    }, null);
  },

  /**
   * إضافة قسم جديد
   */
  async createCategory(categoryData) {
    return withOfflineSupport('createCategory', async () => {
      const { data, error } = await supabase
        .from('categories')
        .insert([{
          name: categoryData.name.trim(),
          slug: categoryData.slug?.trim() || categoryData.name.trim().toLowerCase().replace(/\s+/g, '-'),
          display_order: Number(categoryData.display_order) || 0
        }])
        .select()
        .single();
      if (error) throw error;
      return data;
    }, categoryData, true);
  },

  /**
   * تعديل بيانات قسم
   */
  async updateCategory(id, categoryData) {
    if (!id) return;
    return withOfflineSupport('updateCategory', async () => {
      const updatePayload = {};
      if (categoryData.name !== undefined) updatePayload.name = categoryData.name.trim();
      if (categoryData.slug !== undefined) updatePayload.slug = categoryData.slug.trim();
      if (categoryData.display_order !== undefined) updatePayload.display_order = Number(categoryData.display_order);

      const { data, error } = await supabase
        .from('categories')
        .update(updatePayload)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    }, { id, categoryData }, true);
  },

  /**
   * حذف قسم
   */
  async deleteCategory(id) {
    if (!id) return;
    return withOfflineSupport('deleteCategory', async () => {
      const { error } = await supabase
        .from('categories')
        .delete()
        .eq('id', id);
      if (error) throw error;
      return true;
    }, { id }, true);
  },

  /**
   * يجلب كافة أصناف المنيو مع التصنيفات للوحة التحكم
   */
  async fetchMenuItemsAdmin() {
    return withOfflineSupport('fetchMenuItemsAdmin', async () => {
      const { data, error } = await supabase.rpc('get_menu_items_admin');
      if (error) throw error;
      return data || [];
    }, null);
  },

  /**
   * إنشاء صنف جديد في المنيو
   */
  async createMenuItem(itemData) {
    return withOfflineSupport('createMenuItem', async () => {
      const payload = {
        name: itemData.name.trim(),
        description: itemData.description?.trim() || null,
        price: Number(itemData.price) || 0,
        category_id: itemData.category_id || null,
        image_url: itemData.image_url?.trim() || null,
        status: itemData.status || 'available',
        is_popular: Boolean(itemData.is_popular),
        display_order: Number(itemData.display_order) || 0,
        unit_type: itemData.unit_type || 'qty',
        base_qty: Number(itemData.base_qty) || 1
      };
      const { data, error } = await supabase
        .from('menu_items')
        .insert([payload])
        .select()
        .single();
      if (error) throw error;
      return data;
    }, itemData, true);
  },

  /**
   * تعديل صنف بالكامل في المنيو
   */
  async updateMenuItem(id, itemData) {
    if (!id) return;
    return withOfflineSupport('updateMenuItem', async () => {
      const payload = {
        updated_at: new Date().toISOString()
      };
      if (itemData.name !== undefined) payload.name = itemData.name.trim();
      if (itemData.description !== undefined) payload.description = itemData.description?.trim() || null;
      if (itemData.price !== undefined) payload.price = Number(itemData.price) || 0;
      if (itemData.category_id !== undefined) payload.category_id = itemData.category_id || null;
      if (itemData.image_url !== undefined) payload.image_url = itemData.image_url?.trim() || null;
      if (itemData.status !== undefined) payload.status = itemData.status;
      if (itemData.is_popular !== undefined) payload.is_popular = Boolean(itemData.is_popular);
      if (itemData.display_order !== undefined) payload.display_order = Number(itemData.display_order);
      if (itemData.unit_type !== undefined) payload.unit_type = itemData.unit_type;
      if (itemData.base_qty !== undefined) payload.base_qty = Number(itemData.base_qty);

      const { data, error } = await supabase
        .from('menu_items')
        .update(payload)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    }, { id, itemData }, true);
  },

  /**
   * حذف صنف من المنيو
   */
  async deleteMenuItem(id) {
    if (!id) return;
    return withOfflineSupport('deleteMenuItem', async () => {
      const { error } = await supabase
        .from('menu_items')
        .delete()
        .eq('id', id);
      if (error) throw error;
      return true;
    }, { id }, true);
  },

  /**
   * رفع صورة صنف إلى Supabase Storage
   */
  async uploadMenuImage(file) {
    if (!file) throw new Error('الملف غير صالح');
    const fileExt = file.name.split('.').pop() || 'jpg';
    const fileName = `item_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${fileExt}`;
    const filePath = `items/${fileName}`;

    const { error } = await supabase.storage
      .from('menu-images')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false
      });
    if (error) throw error;

    const { data: publicData } = supabase.storage
      .from('menu-images')
      .getPublicUrl(filePath);

    return publicData?.publicUrl || null;
  },

  /**
   * يحدّث حالة صنف في المنيو (available, out_of_stock, paused, hidden)
   */
  async updateMenuItemStatus(itemId, status, skipQueue = false) {
    if (!itemId) return;
    return withOfflineSupport('updateMenuItemStatus', async () => {
      const { data, error } = await supabase.rpc('update_menu_item_status', {
        p_item_id: itemId,
        p_status: status
      });
      if (error) throw error;
      return data;
    }, { itemId, status }, skipQueue);
  },

  /**
   * تبديل إتاحة الصنف (متاح / غير متاح)
   */
  async toggleMenuItemAvailability(itemId, isAvailable, skipQueue = false) {
    if (!itemId) return;
    return withOfflineSupport('toggleMenuItemAvailability', async () => {
      const { data, error } = await supabase.rpc('toggle_menu_item_availability', {
        p_item_id: itemId,
        p_is_available: Boolean(isAvailable)
      });
      if (error) throw error;
      return data;
    }, { itemId, isAvailable }, skipQueue);
  },

  /**
   * [Legacy Compatibility] يجلب كل حالات الإتاحة معتمدة على جدول menu_items
   * يُعيد Map { itemName: boolean }
   */
  async fetchMenuAvailability() {
    return withOfflineSupport('fetchMenuAvailability', async () => {
      const { data, error } = await supabase
        .from('menu_items')
        .select('name, status');
      if (error) throw error;

      const map = {};
      (data || []).forEach(row => {
        map[row.name] = (row.status === 'available');
      });
      return map;
    }, null);
  },

  /**
   * [Legacy Compatibility] يحدّث إتاحة عنصر بالاسم في menu_items
   */
  async updateMenuAvailability(itemName, isAvailable, skipQueue = false) {
    return withOfflineSupport('updateMenuAvailability', async () => {
      const newStatus = isAvailable ? 'available' : 'out_of_stock';
      const { error } = await supabase
        .from('menu_items')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('name', itemName);
      if (error) throw error;
    }, { itemName, isAvailable }, skipQueue);
  },

  // ─────────────────────────────────────────────────────────
  // 11.5 App Config (جدول app_config) — مصدر الحقيقة لأوقات الورديات
  //      key/value editable from the database, applied live to all users.
  // ─────────────────────────────────────────────────────────

  /**
   * يجلب كل الإعدادات من app_config ويُعيدها كـ Map { key: value }
   */
  async fetchAppConfig() {
    return withOfflineSupport('fetchAppConfig', async () => {
      const { data, error } = await supabase
        .from('app_config')
        .select('key, value');
      if (error) throw error;

      const map = {};
      (data || []).forEach(row => { map[row.key] = row.value; });
      return map;
    }, null);
  },

  /**
   * يحدّث (أو يضيف) قيمة إعداد في app_config — يطبّق فوراً على كل المستخدمين
   * عبر الـ realtime subscription.
   */
  async updateAppConfig(key, value, skipQueue = false) {
    return withOfflineSupport('updateAppConfig', async () => {
      const { error } = await supabase
        .from('app_config')
        .upsert(
          { key, value: String(value), updated_at: new Date().toISOString() },
          { onConflict: 'key' }
        );
      if (error) throw error;
    }, { key, value }, skipQueue);
  },

  /**
   * يشترك في تغييرات app_config بحيث يُطبّق أي تعديل للأوقات فوراً.
   */
  subscribeToAppConfig(callback) {
    const channelId = `app-config-realtime-${Date.now()}`;
    return supabase
      .channel(channelId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_config' }, payload => {
        console.log('🔄 Realtime AppConfig:', payload);
        callback(payload);
      })
      .subscribe();
  },

  // ─────────────────────────────────────────────────────────
  // 11.6 Restaurant Settings (إعدادات المطعم والأسعار والتوصيل)
  // ─────────────────────────────────────────────────────────
  async fetchRestaurantSettings() {
    return withOfflineSupport('fetchRestaurantSettings', async () => {
      let map = {};
      try {
        const { data, error } = await supabase
          .from('restaurant_settings')
          .select('key, value');
        if (!error && data && data.length > 0) {
          data.forEach(row => { map[row.key] = row.value; });
          return map;
        }
      } catch (e) {
        console.warn('[RestaurantSettings] Falling back to app_config:', e?.message);
      }

      const { data: acData, error: acError } = await supabase
        .from('app_config')
        .select('key, value');
      if (acError) throw acError;

      (acData || []).forEach(row => { map[row.key] = row.value; });
      return map;
    }, null);
  },

  async updateRestaurantSetting(key, value, skipQueue = false) {
    return withOfflineSupport('updateRestaurantSetting', async () => {
      const now = new Date().toISOString();
      const valStr = typeof value === 'object' ? JSON.stringify(value) : String(value);

      // Save to app_config
      const { error: acErr } = await supabase
        .from('app_config')
        .upsert({ key, value: valStr, updated_at: now }, { onConflict: 'key' });
      if (acErr) console.warn('[RestaurantSettings] app_config error:', acErr.message);

      // Attempt to save to restaurant_settings
      try {
        await supabase
          .from('restaurant_settings')
          .upsert({ key, value: valStr, updated_at: now }, { onConflict: 'key' });
      } catch (e) {
        // Silently catch if RLS restricts restaurant_settings table
      }
    }, { key, value }, skipQueue);
  },

  subscribeToRestaurantSettings(callback) {
    const channelId = `restaurant-settings-rt-${Date.now()}`;
    return supabase
      .channel(channelId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'restaurant_settings' }, payload => {
        console.log('🔄 Realtime RestaurantSettings:', payload);
        callback(payload);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_config' }, payload => {
        console.log('🔄 Realtime RestaurantSettings (via app_config):', payload);
        callback(payload);
      })
      .subscribe();
  },

  // ─────────────────────────────────────────────────────────
  // 12. fetchFeedbacks (جدول feedback)
  // ─────────────────────────────────────────────────────────
  async fetchFeedbacks() {
    return withOfflineSupport('fetchFeedbacks', async () => {
      const { data, error } = await supabase
        .from('feedback')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    }, null);
  },

  async deleteFeedback(id, skipQueue = false) {
    return withOfflineSupport('deleteFeedback', async () => {
      const { error } = await supabase.from('feedback').delete().eq('id', id);
      if (error) throw error;
      return true;
    }, { id }, skipQueue);
  },

  // ─────────────────────────────────────────────────────────
  // 13. Realtime Subscriptions
  // ─────────────────────────────────────────────────────────

  subscribeToOrders(callback, onStatusChange = null) {
    const channelId = `orders-realtime-${Date.now()}`;
    return supabase
      .channel(channelId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, payload => {
        console.log('🔄 Realtime Order:', payload);
        callback(payload);
      })
      .subscribe((status, err) => {
        if (onStatusChange) onStatusChange(status, err);
      });
  },

  subscribeToReservations(callback, onStatusChange = null) {
    const channelId = `reservations-realtime-${Date.now()}`;
    return supabase
      .channel(channelId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations' }, payload => {
        console.log('🔄 Realtime Reservation:', payload);
        callback(payload);
      })
      .subscribe((status, err) => {
        if (onStatusChange) onStatusChange(status, err);
      });
  },

  subscribeToDrivers(callback, onStatusChange = null) {
    const channelId = `delivery-realtime-${Date.now()}`;
    return supabase
      .channel(channelId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery' }, payload => {
        console.log('🔄 Realtime Driver:', payload);
        callback(payload);
      })
      .subscribe((status, err) => {
        if (onStatusChange) onStatusChange(status, err);
      });
  },

  // ─────────────────────────────────────────────────────────
  // 14. Authentication & Staff Roles (Supabase Auth)
  // ─────────────────────────────────────────────────────────

  /**
   * تسجيل دخول موظف عبر Supabase Auth والتحقق من دوره وحالته
   */
  async signInStaff({ email, password }) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    
    const profile = await this.getCurrentStaffProfile(data.user.id);
    if (!profile) {
      await supabase.auth.signOut();
      throw new Error('هذا الحساب ليس لديه صلاحية وصول إلى لوحة التحكم (Staff Role Required).');
    }
    if (!profile.is_active) {
      await supabase.auth.signOut();
      throw new Error('تم تعطيل هذا الحساب من قبل الإدارة.');
    }

    return { user: data.user, profile };
  },

  /**
   * تسجيل خروج الموظف وإنهاء الجلسة
   */
  async signOutStaff() {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.warn('[Auth] SignOut warning:', e?.message);
    } finally {
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          Object.keys(window.localStorage).forEach(key => {
            if (key.startsWith('sb-') || key.includes('supabase.auth.token')) {
              window.localStorage.removeItem(key);
            }
          });
        }
      } catch {}
    }
  },

  /**
   * جلب الملف التعريفي والدور الموثق للموظف من السيرفر
   */
  async getCurrentStaffProfile(userId = null) {
    try {
      let targetUid = userId;
      if (!targetUid) {
        const { data } = await supabase.auth.getSession();
        targetUid = data?.session?.user?.id;
      }
      if (!targetUid) return null;

      // First try the RPC
      const { data: rpcData, error: rpcError } = await supabase.rpc('get_my_staff_profile');
      if (!rpcError && rpcData && rpcData.length > 0) {
        return rpcData[0];
      }

      // Fallback to direct query on staff_roles
      const { data, error } = await supabase
        .from('staff_roles')
        .select('*')
        .eq('user_id', targetUid)
        .maybeSingle();

      if (error) {
        console.warn('[StaffProfile] Error fetching profile:', error.message);
        return null;
      }
      return data;
    } catch (e) {
      console.warn('[StaffProfile] Exception fetching profile:', e?.message);
      return null;
    }
  },

  /**
   * الاستماع لتغيرات جلسة المستخدم من Supabase Auth
   */
  onAuthStateChange(callback) {
    return supabase.auth.onAuthStateChange((event, session) => {
      callback(event, session);
    });
  }
};

