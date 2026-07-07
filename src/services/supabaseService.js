// Developed & Owned by D.AmrMamdouh - 01038035884
import { supabase } from './supabase/supabaseClient';
import { safeGetItem, safeSetItem } from '../utils/safeStorage';

// ============================================================
// OFFLINE SYNC QUEUE
// ============================================================

const QUEUE_KEY = 'delivery_pending_sync';

/**
 * يقرأ قائمة العمليات المنتظرة من localStorage
 */
const getPendingQueue = () => {
  try { return JSON.parse(safeGetItem(QUEUE_KEY)) || []; }
  catch { return []; }
};

/**
 * يحفظ قائمة العمليات المنتظرة في localStorage
 */
const savePendingQueue = (queue) => {
  safeSetItem(QUEUE_KEY, JSON.stringify(queue));
};

/**
 * يضيف عملية فاشلة لقائمة الانتظار لإعادة المحاولة عند عودة الاتصال
 */
const queueSync = (action, payload) => {
  const q = getPendingQueue();
  q.push({ action, payload, id: Date.now() });
  savePendingQueue(q);
};

/**
 * يعيد تشغيل العمليات المنتظرة في القائمة عند عودة الاتصال بالإنترنت
 * يُستدعى تلقائياً عند أي reconnect
 */
export const processPendingSync = async () => {
  if (!navigator.onLine) return;
  const q = getPendingQueue();
  if (!q.length) return;

  console.log(`🔄 Processing ${q.length} pending offline syncs...`);
  const remainingQueue = [];

  for (const item of q) {
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
    } catch (e) {
      console.warn('⚠️ Offline sync item failed, keeping in queue:', item);
      remainingQueue.push(item);
    }
  }

  savePendingQueue(remainingQueue);
};

// يعيد المحاولة تلقائياً عند عودة الاتصال
window.addEventListener('online', processPendingSync);

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
      const items = orderData.items || [];
      const itemsTotal = items.reduce((sum, item) => {
        const price = Number(item.price || item.unit_price || 0);
        const count = Number(item.count || item.quantity || 1);
        return sum + (price * count);
      }, 0);

      const deliveryFee = Number(orderData.deliveryFee || orderData.delivery_fee || 0);
      const serviceFee = Number(orderData.serviceFee || orderData.service_fee || 0);
      const totalAmount = itemsTotal + deliveryFee + serviceFee;

      const paymentMethod = orderData.paymentMethod || 'Cash';
      const isCashOnDelivery = (!paymentMethod || paymentMethod === 'Cash' || String(paymentMethod).toLowerCase().includes('cash'));
      const paidNow = isCashOnDelivery ? 0 : Number(orderData.paidNow || orderData.paid_now || 0);
      const remainingAmount = isCashOnDelivery ? totalAmount : (totalAmount - paidNow);

      const rawPayload = {
        order_id: String(orderData.id),
        items: items.map(item => ({
          name: item.name,
          quantity: item.count || item.quantity || 1,
          price: item.price || 0
        })),
        customer: {
          full_name: orderData.customerName,
          phone_1: orderData.phone,
          delivery_info: {
            address: orderData.area,
            coordinates: {
              lat: orderData.lat || orderData.latitude || null,
              lon: orderData.lng || orderData.longitude || null
            }
          },
          payment_method: paymentMethod
        },
        totals: {
          delivery_fee: deliveryFee,
          service_fee: serviceFee,
          paid_now: paidNow,
          remaining_amount: remainingAmount
        },
        route_distance_km: orderData.route_distance_km || null,
        route_duration_minutes: orderData.route_duration_minutes || null,
        calculated_by: orderData.calculated_by || null,
        items_description: orderData.itemsDescription || null,
        timestamp: new Date().toISOString()
      };

      const { data, error } = await supabase
        .from('orders')
        .insert([{
          customer_name: orderData.customerName || 'عميل غير معروف',
          customer_phone: orderData.phone || null,
          customer_phone_2: orderData.phone2 || null,
          order_type: orderData.type || 'delivery',
          total_amount: totalAmount,
          delivery_fee: deliveryFee,
          service_fee: serviceFee,
          paid_now: paidNow,
          remaining_amount: remainingAmount,
          status: 'pending',
          delivery_address: orderData.area || null,
          payment_method: paymentMethod,
          payment_screenshot: null,
          latitude: orderData.lat || orderData.latitude || null,
          longitude: orderData.lng || orderData.longitude || null,
          raw_payload: rawPayload,
          source: orderData.source || 'manual',
          original_id: String(orderData.id),
          shift_id: orderData.shiftId || null
        }])
        .select('id')
        .single();

      if (error) throw error;
      return data;
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
  // 2. updateOrderStatus
  //    يحدّث حالة الطلب في DB ويُعالج كل الحالات العربية
  // ─────────────────────────────────────────────────────────
  async updateOrderStatus(supabaseId, newStatus, reason = null, extraFields = {}, skipQueue = false) {
    if (!supabaseId) return; // Manual orders have no supabaseId

    return withOfflineSupport('updateOrderStatus', async () => {
      let dbStatus = newStatus;
      if (newStatus === 'confirmed' || newStatus === 'waiting_driver') dbStatus = 'في التحضير';
      else if (newStatus === 'cancelled') dbStatus = reason ? `ملغي (${reason})` : 'ملغي';
      else if (newStatus === 'driver_assigned') dbStatus = 'تم الإسناد للطيار';
      else if (newStatus === 'out_for_delivery' || newStatus === 'active') dbStatus = 'في الطريق للتسليم';
      else if (newStatus === 'completed' || newStatus === 'delivered') dbStatus = 'تم التوصيل';
      else if (newStatus === 'failed_delivery') dbStatus = reason ? `فشل التوصيل (${reason})` : 'فشل التوصيل';

      const updatePayload = { status: dbStatus };
      if (extraFields.pilot_id !== undefined) updatePayload.pilot_id = String(extraFields.pilot_id);
      if (extraFields.pilot_name !== undefined) updatePayload.pilot_name = extraFields.pilot_name;
      if (extraFields.delivery_id !== undefined) updatePayload.delivery_id = extraFields.delivery_id;

      const { error } = await supabase
        .from('orders')
        .update(updatePayload)
        .eq('id', supabaseId);

      if (error) throw error;
    }, { supabaseId, newStatus, reason, extraFields }, skipQueue);
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
        totalMinutes: Number(row.total_minutes) || 0,
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
  // 8. saveShiftReport
  //    يحفظ تقرير إغلاق الوردية في جدول shifts
  //    مع الـ offline fallback عند انقطاع الاتصال
  // ─────────────────────────────────────────────────────────
  async saveShiftReport(reportData, skipQueue = false) {
    return withOfflineSupport('saveShiftReport', async () => {
      const { error } = await supabase.rpc('close_shift', {
        p_shift_id: reportData.id,
        p_stats: reportData,
        p_force_close: Boolean(reportData.forceClose)
      });

      if (error) throw error;
    }, reportData, skipQueue);
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
  // 11. Menu Availability (جدول menu_availability)
  //     item_name UNIQUE, is_available bool
  // ─────────────────────────────────────────────────────────

  /**
   * يجلب كل حالات الإتاحة من menu_availability
   * يُعيد Map { itemName: boolean }
   */
  async fetchMenuAvailability() {
    return withOfflineSupport('fetchMenuAvailability', async () => {
      const { data, error } = await supabase
        .from('menu_availability')
        .select('item_name, is_available');
      if (error) throw error;

      const map = {};
      (data || []).forEach(row => { map[row.item_name] = row.is_available; });
      return map;
    }, null);
  },

  /**
   * يحدّث أو يضيف حالة إتاحة عنصر في القائمة
   * @param {string} itemName - اسم العنصر
   * @param {boolean} isAvailable - متاح أم لا
   */
  async updateMenuAvailability(itemName, isAvailable, skipQueue = false) {
    return withOfflineSupport('updateMenuAvailability', async () => {
      const { error } = await supabase
        .from('menu_availability')
        .upsert(
          { item_name: itemName, is_available: isAvailable, updated_at: new Date().toISOString() },
          { onConflict: 'item_name' }
        );
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

  subscribeToOrders(callback) {
    const channelId = `orders-realtime-${Date.now()}`;
    return supabase
      .channel(channelId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, payload => {
        console.log('🔄 Realtime Order:', payload);
        callback(payload);
      })
      .subscribe();
  },

  subscribeToReservations(callback) {
    const channelId = `reservations-realtime-${Date.now()}`;
    return supabase
      .channel(channelId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations' }, payload => {
        console.log('🔄 Realtime Reservation:', payload);
        callback(payload);
      })
      .subscribe();
  },

  subscribeToDrivers(callback) {
    const channelId = `delivery-realtime-${Date.now()}`;
    return supabase
      .channel(channelId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery' }, payload => {
        console.log('🔄 Realtime Driver:', payload);
        callback(payload);
      })
      .subscribe();
  }
};
