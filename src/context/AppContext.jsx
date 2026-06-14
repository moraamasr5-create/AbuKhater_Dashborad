// Developed & Owned by D.AmrMamdouh - 01038035884
import React, { createContext, useContext, useState, useEffect, useRef, useMemo } from 'react';
import { API_CONFIG } from '../config/apiConfig';
import { supabaseService, processPendingSync } from '../services/supabaseService';
import { printerService } from '../services/printerService';
import { safeGetItem, safeSetItem } from '../utils/safeStorage';

const AppContext = createContext();

import {
  getNormalizedNow,
  getLogicalShiftDateString,
  calculateDelayMinutes,
  getSafeISOTime,
  generateSafeId,
  generateUUID,
  capShiftMinutes
} from '../utils/shiftLogic';
import { safeParseOrder } from '../utils/safeOrderParser';

/**
 * 🔴 الدالة دي هي المسؤولة عن إرسال أي تحديث عام للبيانات لـ Supabase
 */
const sendToN8N = async (payload, type) => {
  try {
    if (type === 'SHIFT_CLOSE') {
      await supabaseService.saveShiftReport(payload);
    }
  } catch (e) {
    console.error('Supabase Integration Error:', e);
  }
};

const mergePilots = (prevPilots, fetchedPilots) => {
  const mergedFetched = fetchedPilots.map(fp => {
    const existing = prevPilots.find(p => p.id === fp.id);
    if (!existing) return fp;
    const LOCAL_PILOT_FIELDS = ['ordersCount', 'totalMinutes', 'balance', 'shiftStatus', 'state', 'lastReturnTime', 'shiftUsed', 'lastOpenedAt', 'shift'];
    const mergedFields = {};
    LOCAL_PILOT_FIELDS.forEach(f => {
      if (existing[f] !== undefined) {
        mergedFields[f] = existing[f];
      }
    });
    return { ...fp, ...mergedFields };
  });

  const localOnly = prevPilots.filter(p => !fetchedPilots.some(fp => fp.id === p.id));
  return [...mergedFetched, ...localOnly];
};

export const AppProvider = ({ children }) => {
  // 🔴 نظام الأدوار (Role System)
  // بنحدد هنا إذا كان المستخدم 'admin' (مدير) أو 'casher' (كاشير) أو '' (غير مسجل دخول)
  const [userRole, setUserRole] = useState(() => {
    return sessionStorage.getItem('b_delivery_session_user') || '';
  });

  const [isThermalPrintMode, setIsThermalPrintMode] = useState(() => {
    return safeGetItem('is_thermal_print_mode') === 'true';
  });

  useEffect(() => {
    safeSetItem('is_thermal_print_mode', isThermalPrintMode);
    if (isThermalPrintMode) {
      document.body.classList.add('thermal-print-active');
    } else {
      document.body.classList.remove('thermal-print-active');
    }
  }, [isThermalPrintMode]);

  // حفظ الدور في المتصفح ودور الجلسة
  useEffect(() => {
    if (userRole) {
      sessionStorage.setItem('b_delivery_session_user', userRole);
    } else {
      sessionStorage.removeItem('b_delivery_session_user');
    }
  }, [userRole]);

  // تهيئة كلمات المرور الافتراضية إذا لم تكن موجودة
  useEffect(() => {
    if (!safeGetItem('b_delivery_password_admin')) {
      safeSetItem('b_delivery_password_admin', '8080');
    }
    if (!safeGetItem('b_delivery_password_casher')) {
      safeSetItem('b_delivery_password_casher', '8080');
    }
  }, []);

  const [orders, setOrders] = useState([]);

  // الحجوزات: تُحمّل من localStorage أولاً ثم يُحدّث من Supabase في الخلفية
  const [reservations, setReservations] = useState([]);
  const [pilots, setPilots] = useState([]);

  const [currentShift, setCurrentShift] = useState(() => {
    try {
      const saved = safeGetItem('delivery_current_shift');
      return (saved && saved !== 'undefined') ? JSON.parse(saved) : null;
    } catch { return null; }
  });

  const [dailyReports, setDailyReports] = useState([]);

  useEffect(() => {
    safeSetItem('delivery_current_shift', JSON.stringify(currentShift));
  }, [currentShift]);

  const [auditLogs, setAuditLogs] = useState([]);

  // عند تحميل التطبيق: أعد محاولة العمليات المعلّقة (pendingSync) في حال وجود اتصال
  useEffect(() => {
    localStorage.removeItem('order_sequence_num'); // Remove legacy sequential ID
    processPendingSync();
  }, []);

  // إغلاق تلقائي للوردية عند الساعة 4 صباحاً
  useEffect(() => {
    const checkAutoClose = () => {
      const now = getNormalizedNow();
      if (currentShift && now.getHours() === 4) {
        closeShift(true);
      }
    };

    const timer = setInterval(checkAutoClose, 10 * 60 * 1000);
    return () => clearInterval(timer);
  }, [currentShift]);

  // 🔥 3. Real-time Dashboard (Supabase Live System)
  const retryRef = useRef(0);
  const pendingUpdatesRef = useRef(new Set()); // Set of supabaseIds being updated

  /**
   * يُحدّث حالة الطلب في Supabase مع حماية من التحديثات المكررة أثناء الـ polling
   */
  const updateExternalOrderStatus = async (orderId, newStatus, reason = null, extraFields = {}) => {
    pendingUpdatesRef.current.add(String(orderId));
    try {
      await supabaseService.updateOrderStatus(orderId, newStatus, reason, extraFields);
    } catch (e) {
      console.error('External Status Update Exception:', e);
    } finally {
      setTimeout(() => {
        pendingUpdatesRef.current.delete(String(orderId));
      }, 2000);
    }
  };

  useEffect(() => {
    if (currentShift?.status !== 'open' || !API_CONFIG.AUTO_REFRESH) return;

    let ordersSub, pilotsSub, resSub;

    const fetchInitialData = async () => {
      try {
        const [fetchedOrders, fetchedPilots, fetchedRes] = await Promise.all([
          supabaseService.fetchOrders(currentShift?.id),
          supabaseService.fetchDeliveryDrivers(),
          supabaseService.fetchReservations()
        ]);

        if (fetchedPilots) setPilots(prev => mergePilots(prev, fetchedPilots));
        if (fetchedRes) setReservations(fetchedRes);

        if (fetchedOrders && fetchedOrders.length > 0) {
          setOrders(prev => {
            const newOrdersForAudio = fetchedOrders.filter(fo => {
              const notInPrev = !prev.some(o => (o.originalId || o.id) === fo.originalId);
              const isRecentlyCreated = fo.timestamp &&
                (Date.now() - new Date(fo.timestamp).getTime()) < 3 * 60 * 1000;
              return notInPrev && isRecentlyCreated;
            });

            if (newOrdersForAudio.length > 0) {
              new Audio(API_CONFIG.SOUNDS.NEW_ORDER).play().catch(() => { });
              logAction('LIVE_SYNC', `Supabase Sync: Received ${newOrdersForAudio.length} new orders`, 'System');
            }

            const LOCAL_ONLY_FIELDS = ['pilotId', 'deliveryId', 'assignedAt', 'confirmedAt', 'startTime', 'endTime', 'failureReason', 'cancellationReason', 'cancelledAt', 'logs', 'shiftId'];

            const mergedOrders = fetchedOrders.map(fo => {
              const existing = prev.find(o => (o.originalId || o.id) === fo.originalId);
              if (!existing) return fo;

              const isPending = pendingUpdatesRef.current.has(String(fo.supabaseId)) || pendingUpdatesRef.current.has(String(fo.originalId));
              const localIsNewer = existing.confirmedAt || existing.assignedAt || existing.startTime;

              const mergedStatus = isPending ? existing.status : (localIsNewer ? existing.status : fo.status);

              const localFields = {};
              LOCAL_ONLY_FIELDS.forEach(f => {
                if (existing[f] !== undefined) localFields[f] = existing[f];
              });

              return { ...fo, ...localFields, status: mergedStatus };
            });

            const manualOrders = prev.filter(p => !p.supabaseId && !fetchedOrders.some(fo => fo.originalId === (p.originalId || p.id)));

            return [...mergedOrders, ...manualOrders];
          });
        }
      } catch (err) {
        console.error('📡 Supabase Fetch Error:', err);
      }
    };

    fetchInitialData();

    // 🚀 Subscribing to Realtime Database Changes
    ordersSub = supabaseService.subscribeToOrders(() => {
      fetchInitialData(); // Re-fetch all data gently on change
    });

    pilotsSub = supabaseService.subscribeToDrivers(() => {
      supabaseService.fetchDeliveryDrivers().then(fetched => {
        if (fetched) setPilots(prev => mergePilots(prev, fetched));
      });
    });

    resSub = supabaseService.subscribeToReservations(() => {
      supabaseService.fetchReservations().then(setReservations);
    });

    // Fallback polling just in case WebSocket drops
    const pollTimer = setInterval(fetchInitialData, 30000);

    return () => {
      clearInterval(pollTimer);
      if (ordersSub) ordersSub.unsubscribe();
      if (pilotsSub) pilotsSub.unsubscribe();
      if (resSub) resSub.unsubscribe();
    };
  }, [currentShift]);

  // Keep pilots' ordersCount synchronized with the completed orders of the current shift
  useEffect(() => {
    if (!currentShift) return;
    setPilots(prev => {
      let changed = false;
      const updated = prev.map(p => {
        const finishedCount = orders.filter(o => String(o.pilotId) === String(p.id) && (o.status === 'completed' || o.status === 'delivered')).length;
        if (p.ordersCount !== finishedCount) {
          changed = true;
          return { ...p, ordersCount: finishedCount };
        }
        return p;
      });
      return changed ? updated : prev;
    });
  }, [orders, currentShift]);

  const syncExternalOrders = async () => {
    if (currentShift?.status !== 'open') return;
    try {
      const fetchedOrders = await supabaseService.fetchOrders(currentShift?.id);
      setOrders(prev => {
        const onlyNew = fetchedOrders.filter(fo => !prev.some(p => (p.originalId || p.id) === fo.originalId));
        return [...onlyNew, ...prev];
      });
    } catch (e) {
      console.error('Manual sync failed', e);
    }
  };

  const logAction = (action, details, user = 'System') => {
    const newLog = {
      id: generateSafeId('log'),
      timestamp: getSafeISOTime(),
      action,
      details,
      user,
      shiftId: currentShift?.id || 'NO_SHIFT'
    };
    setAuditLogs(prev => [newLog, ...prev]);
  };

  const getSuggestedPilot = () => {
    // 1. Filter Available Pilots
    const available = pilots.filter(p => p.shiftStatus === 'open' && p.state === 'available');
    if (available.length === 0) return null;

    const getTime = (timeStr) => {
      if (!timeStr) return 0;
      const parsed = new Date(timeStr).getTime();
      return isNaN(parsed) ? 0 : parsed;
    };

    // 2. Sort by Last Return Time (Oldest First - FIFO), then by Order Count (Balancing)
    return available.sort((a, b) => {
      const timeA = getTime(a.lastReturnTime);
      const timeB = getTime(b.lastReturnTime);
      if (timeA !== timeB) return timeA - timeB; // First back
      return (a.ordersCount || 0) - (b.ordersCount || 0); // Least orders
    })[0];
  };

  /**
   * فتح وردية جديدة: يتحقق من وجود وردية بنفس التاريخ، يستأنفها أو يُنشئ جديدة
   * يعمل بدون إنترنت بفضل localStorage + pendingSync
   */
  const openShift = async () => {
    const logicalDate = getLogicalShiftDateString();
    console.log(`[Shift] Checking shift for date: ${logicalDate}`);

    try {
      // التحقق من وجود وردية مفتوحة في Supabase
      const existingShift = await supabaseService.getShiftByDate(logicalDate);

      if (existingShift) {
        console.log(`[Shift] Resuming existing shift: ${existingShift.id}`);
        setCurrentShift({
          id: existingShift.id,
          date: existingShift.date,
          startTime: existingShift.start_time,
          status: 'open'
        });
        logAction('SHIFT_RESUME', `استئناف وردية ${logicalDate}`, 'Manager');
        alert(`✅ تم استئناف الوردية المفتوحة بتاريخ ${logicalDate}`);
        return;
      }
    } catch (e) {
      console.warn('[Shift] Could not check existing shift:', e.message);
    }

    // إنشاء وردية جديدة
    try {
      const newId = generateUUID();
      console.log(`[Shift] Creating new shift with ID: ${newId}`);

      const newShift = {
        id: newId,
        date: logicalDate,
        start_time: getSafeISOTime(),   // مهم: اسم العمود start_time
        status: 'open',
        total_orders: 0,
        stats: {}
      };

      setCurrentShift(newShift);

      const result = await supabaseService.createShift(newShift);

      console.log('✅ Shift created successfully in Supabase');
      logAction('SHIFT_OPEN', `فتح وردية جديدة - ${logicalDate}`, 'Manager');
      alert('✅ تم فتح وردية جديدة بنجاح');

    } catch (error) {
      console.error('❌ Failed to create shift:', error);
      alert(`❌ خطأ في فتح الوردية: ${error.message}`);
    }
  };

  /**
   * إغلاق الوردية: يحفظ التقرير ويُرسله لـ Supabase
   * يعمل بشكل كامل offline ويتزامن لاحقاً
   */
  const closeShift = (force = false) => {
    if (!currentShift) return false;

    const activeOrderStatuses = ['active', 'waiting_driver', 'driver_assigned', 'pending', 'pending_timer'];
    const hasActiveOrders = orders.some(o => activeOrderStatuses.includes(o.status));
    const hasOpenPilotShifts = pilots.some(p => p.shiftStatus === 'open');

    // If forced (4 AM), we allow closing even if pilots are open (they will be auto-closed by reset)
    // But we still block if there are active orders (safety)
    if (hasActiveOrders || (!force && hasOpenPilotShifts)) {
      const msg = hasActiveOrders
        ? '⚠️ لا يمكن إغلاق الوردية! يوجد طلبات نشطة.'
        : '⚠️ لا يمكن إغلاق الوردية! يوجد طيارين لم يغلقوا شفتاتهم بعد.';
      alert(msg);
      return false;
    }

    const stats = activeStats();

    const snapshot = {
      ...currentShift,
      endTime: getSafeISOTime(),
      status: 'closed',
      ordersCount: stats.totalOrders,
      totalDeliveryFees: stats.pilotPerformance.reduce((sum, p) => sum + p.feeEarnings, 0),
      totalAttendancePay: stats.pilotPerformance.reduce((sum, p) => sum + p.attendancePay, 0),
      totalPilotDues: stats.pilotPerformance.reduce((sum, p) => sum + p.totalEarnings, 0),
      pilotStats: stats.pilotPerformance,
      archivedOrders: orders
    };

    setDailyReports(prev => [snapshot, ...prev]);

    // Automatic JSON Download removed to prevent browser errors


    logAction('SHIFT_CLOSE', `Shift closed. Orders: ${stats.totalOrders}. File Generated.`, 'Manager');
    sendToN8N(snapshot, 'SHIFT_CLOSE');

    // Bulk reset all pilots in the Supabase delivery table
    const allPilotIds = pilots.map(p => p.id);
    if (allPilotIds.length > 0) {
      supabaseService.resetAllPilots(allPilotIds);
    }

    setOrders([]);
    setCurrentShift(null);
    setPilots(prev => prev.map(p => ({ ...p, shiftStatus: 'closed', state: 'available', balance: 0, totalMinutes: 0, ordersCount: 0, shiftUsed: false, lastOpenedAt: null })));
    return true;
  };

  /**
   * إضافة طلب جديد: يحفظ محلياً أولاً ثم يرسل لـ Supabase
   * يتحقق من التكرارات ورقم البون
   */
  const addOrder = (orderData) => {
    if (!orderData.id) {
      alert('خطأ: لا يوجد رقم بون');
      return;
    }

    // Check for duplicates based on originalId or id
    const existingCount = orders.filter(o => (o.originalId || o.id) === orderData.id).length;

    if (existingCount >= 2) {
      alert(`رقم البون ${orderData.id} مكرر أكثر من الحد المسموح (مرتين فقط)!`);
      return;
    }

    if (!currentShift) {
      alert('⚠️ يجب فتح وردية أولاً لإضافة طلبات!');
      return;
    }

    // Generate unique ID using server-generated UUID
    const finalId = generateUUID();

    const items = orderData.items || [];
    const itemsTotal = items.reduce((sum, item) => {
      const price = Number(item.price || item.unit_price || 0);
      const count = Number(item.count || item.quantity || 1);
      return sum + (price * count);
    }, 0);
    const serviceFee = Number(orderData.serviceFee || orderData.service_fee || 0);
    const deliveryFee = Number(orderData.deliveryFee || orderData.delivery_fee || 0);
    const totalAmount = itemsTotal + deliveryFee + serviceFee;

    const isCashOnDelivery = (!orderData.paymentMethod || orderData.paymentMethod === 'Cash' || String(orderData.paymentMethod).toLowerCase().includes('cash'));
    const paidNow = isCashOnDelivery ? 0 : Number(orderData.paidNow || orderData.paid_now || 0);
    const remainingAmount = isCashOnDelivery ? totalAmount : (totalAmount - paidNow);

    const newOrder = {
      ...orderData,
      id: finalId,
      originalId: orderData.id, // Store original receipt No for display
      source: orderData.source || 'manual',
      status: 'pending_timer', // Initial status
      timestamp: getSafeISOTime(),
      shiftId: currentShift.id, // Link to Shift
      logs: [{ time: getSafeISOTime(), action: 'CREATED', user: 'System' }], // Internal Order Log
      total: totalAmount,
      deliveryFee,
      serviceFee,
      paidNow,
      remainingAmount
    };
    setOrders(prev => [newOrder, ...prev]);
    logAction('ORDER_CREATE', `Order #${orderData.id} created`, 'Operator');
    sendToN8N(newOrder, 'ORDER_CREATE');

    setTimeout(() => {
      setOrders(currentOrders => currentOrders.map(o =>
        (o.id === newOrder.id && o.status === 'pending_timer')
          ? { ...o, status: 'pending' } // New (Review)
          : o
      ));
    }, 5000);
  };

  const updateOrder = (oldId, updatedData) => {
    setOrders(prev => {
      // If ID is being changed, check for duplicates
      if (oldId !== updatedData.id && prev.some(o => o.id === updatedData.id)) {
        alert(`رقم البون ${updatedData.id} مستخدم بالفعل! لا يمكن التعديل.`);
        return prev;
      }

      return prev.map(o => {
        if (o.id === oldId) {
          const merged = { ...o, ...updatedData };
          const items = merged.items || [];
          const itemsTotal = items.reduce((sum, item) => {
            const price = Number(item.price || item.unit_price || 0);
            const count = Number(item.count || item.quantity || 1);
            return sum + (price * count);
          }, 0);
          const serviceFee = Number(merged.serviceFee || merged.service_fee || 0);
          const deliveryFee = Number(merged.deliveryFee || merged.delivery_fee || 0);
          const totalAmount = itemsTotal + deliveryFee + serviceFee;

          const isCashOnDelivery = (!merged.paymentMethod || merged.paymentMethod === 'Cash' || String(merged.paymentMethod).toLowerCase().includes('cash'));
          const paidNow = isCashOnDelivery ? 0 : Number(merged.paidNow || merged.paid_now || 0);
          const remainingAmount = isCashOnDelivery ? totalAmount : (totalAmount - paidNow);

          return {
            ...merged,
            total: totalAmount,
            deliveryFee,
            serviceFee,
            paidNow,
            remainingAmount
          };
        }
        return o;
      });
    });
    logAction('ORDER_UPDATE', `Order #${oldId} updated (New ID: ${updatedData.id})`, 'Supervisor');
  };

  const deleteOrder = (orderId) => {
    setOrders(prev => prev.filter(o => o.id !== orderId));
    logAction('ORDER_DELETE', `Order #${orderId} deleted`, 'Supervisor');
  };

  const cancelOrder = (orderId, reason) => {
    const order = orders.find(o => o.id === orderId);
    if (!order || order.status === 'cancelled') return;

    setOrders(prev => prev.map(o =>
      o.id === orderId
        ? { ...o, status: 'cancelled', cancellationReason: reason, cancelledAt: getSafeISOTime() }
        : o
    ));
    logAction('ORDER_CANCEL', `Order #${orderId} cancelled. Reason: ${reason}`, 'Supervisor');
    sendToN8N({ ...order, status: 'cancelled', cancellationReason: reason }, 'ORDER_CANCEL');
    if (order.supabaseId) {
      updateExternalOrderStatus(order.supabaseId, 'cancelled', reason);
    }
  };

  // Step 1: Manager Confirms Details -> Waiting For Driver
  const confirmOrder = async (orderId) => {
    const order = orders.find(o => o.id === orderId);
    if (!order || !['pending', 'pending_timer'].includes(order.status)) return;

    const updatedOrder = { ...order, status: 'waiting_driver', confirmedAt: getSafeISOTime() };

    setOrders(prev => prev.map(o =>
      o.id === orderId ? updatedOrder : o
    ));
    logAction('ORDER_CONFIRM', `Order #${orderId} confirmed. Waiting for driver.`, 'Supervisor');
    if (order.supabaseId) {
      updateExternalOrderStatus(order.supabaseId, 'confirmed');
    }

    try {
      await printerService.printKitchenReceipt(updatedOrder);
      await printerService.printCashierReceipt(updatedOrder);
    } catch (err) {
      console.error('❌ فشل الطباعة التلقائية:', err);
    }
  };

  // Step 2: Assign Driver (Locks Order, Ready to Print)
  const assignPilot = (orderId, pilotId) => {
    const order = orders.find(o => o.id === orderId);
    if (!order || ['driver_assigned', 'active', 'completed', 'delivered', 'cancelled', 'failed_delivery'].includes(order.status)) return;

    const pilot = pilots.find(p => String(p.id) === String(pilotId));
    if (!pilot) {
      console.error(`Pilot ${pilotId} not found.`);
      alert(`⚠️ خطأ: لم يتم العثور على الطيار!`);
      return;
    }

    if (pilot.state !== 'available') {
      const errorMsg = `Cannot assign order to pilot ${pilot.name} because their state is '${pilot.state}'.`;
      console.error(errorMsg);
      alert(`⚠️ خطأ: الطيار ${pilot.name} غير متاح حالياً (حالة الطيار: ${pilot.state})!`);
      return;
    }

    const safeDeliveryId = !isNaN(Number(pilotId)) ? Number(pilotId) : null;

    setOrders(prev => prev.map(o =>
      o.id === orderId
        ? { ...o, status: 'driver_assigned', pilotId, deliveryId: safeDeliveryId, assignedAt: getSafeISOTime() }
        : o
    ));
    const pilotName = pilot.name || 'Unknown';
    logAction('ORDER_ASSIGN', `Order #${orderId} assigned to ${pilotName}`, 'Supervisor');
    if (order.supabaseId) {
      updateExternalOrderStatus(order.supabaseId, 'driver_assigned', null, {
        pilot_id: String(pilotId),
        pilot_name: pilotName,
        delivery_id: safeDeliveryId
      });
    }

    // Set pilot's state to 'busy' or 'on_delivery' (using 'busy')
    setPilots(prev => prev.map(p =>
      String(p.id) === String(pilotId)
        ? { ...p, state: 'busy' }
        : p
    ));
    supabaseService.updatePilotState(pilotId, { state: 'busy' });
  };

  // Step 3: Start Delivery (Pilot Leaves -> Status Out)
  const startDelivery = (orderId) => {
    const order = orders.find(o => o.id === orderId);
    if (!order || !(order.deliveryId || order.pilotId) || order.status === 'active' || order.status === 'completed' || order.status === 'delivered') return;

    setOrders(prev => prev.map(o =>
      o.id === orderId
        ? { ...o, status: 'active', startTime: getSafeISOTime() }
        : o
    ));

    // Mark Pilot as OUT
    setPilots(prev => prev.map(p =>
      String(p.id) === String(order.deliveryId || order.pilotId)
        ? { ...p, state: 'on_delivery' }
        : p
    ));

    if (order.supabaseId) {
      supabaseService.updatePilotState(order.deliveryId || order.pilotId, { state: 'on_delivery' });
    }

    logAction('DELIVERY_START', `Order #${orderId} out for delivery`, 'System');
    if (order.supabaseId) {
      updateExternalOrderStatus(order.supabaseId, 'out_for_delivery');
    }
  };

  // Step 4: Complete (Pilot Returns -> Status Available + Queue Update)
  /**
   * إتمام الطلب: يُعيد الطيار لقائمة الانتظار ويحدّث الحالة
   */
  const completeOrder = (orderId) => {
    const order = orders.find(o => o.id === orderId);
    if (!order || order.status === 'completed' || order.status === 'delivered') return;

    const nowTime = getSafeISOTime();
    setOrders(prev => prev.map(o =>
      o.id === orderId
        ? { ...o, status: 'delivered', endTime: nowTime, deliveredAt: nowTime }
        : o
    ));

    // Return Pilot to Queue (Last Return Time = Now)
    const pilotIdToUse = order.deliveryId || order.pilotId;
    if (pilotIdToUse) {
      setPilots(prev => prev.map(p => {
        if (String(p.id) === String(pilotIdToUse)) {
          return {
            ...p,
            state: 'available',
            lastReturnTime: nowTime,
            ordersCount: (p.ordersCount || 0) + 1
          };
        }
        return p;
      }));

      const targetPilot = pilots.find(p => String(p.id) === String(pilotIdToUse));
      const returnUpdates = {
        state: 'available',
        last_return_time: nowTime,
        orders_count: (targetPilot ? (targetPilot.ordersCount || 0) : 0) + 1
      };

      supabaseService.updatePilotState(pilotIdToUse, returnUpdates);
    }
    logAction('ORDER_COMPLETE', `Order #${orderId} completed`, 'Supervisor');
    sendToN8N({ ...order, status: 'delivered', endTime: nowTime, deliveredAt: nowTime }, 'ORDER_COMPLETE');
    if (order.supabaseId) {
      updateExternalOrderStatus(order.supabaseId, 'delivered');
    }
  };

  const failDelivery = (orderId, reason) => {
    const order = orders.find(o => o.id === orderId);
    if (!order || order.status === 'failed_delivery') return;

    const nowTime = getSafeISOTime();
    setOrders(prev => prev.map(o =>
      o.id === orderId
        ? { ...o, status: 'failed_delivery', failureReason: reason, endTime: nowTime, failedAt: nowTime }
        : o
    ));

    // Return Pilot to Queue (Last Return Time = Now) only if they have no other active orders left
    const pilotIdToUse = order.deliveryId || order.pilotId;
    if (pilotIdToUse) {
      const otherActive = orders.some(o => String(o.deliveryId || o.pilotId) === String(pilotIdToUse) && o.status === 'active' && o.id !== orderId);
      const nextState = otherActive ? 'out' : 'available';

      setPilots(prev => prev.map(p => {
        if (String(p.id) === String(pilotIdToUse)) {
          const returnTimeUpdates = nextState === 'available' ? { lastReturnTime: nowTime } : {};
          return {
            ...p,
            state: nextState,
            ...returnTimeUpdates
          };
        }
        return p;
      }));

      const returnUpdates = nextState === 'available'
        ? { state: 'available', last_return_time: nowTime }
        : { state: 'out' };

      const targetPilot = pilots.find(p => String(p.id) === String(pilotIdToUse));
      if (targetPilot) {
        const currentActiveSession = (targetPilot.shiftStatus === 'open' && targetPilot.lastOpenedAt)
          ? calculateDelayMinutes(targetPilot.lastOpenedAt)
          : 0;
        returnUpdates.total_minutes = (targetPilot.totalMinutes || 0) + currentActiveSession;
        returnUpdates.orders_count = orders.filter(o => String(o.pilotId) === String(pilotIdToUse) && o.status === 'completed' && o.id !== orderId).length;
      }

      supabaseService.updatePilotState(order.pilotId || pilotIdToUse, returnUpdates);
    }
    logAction('DELIVERY_FAIL', `Order #${orderId} failed delivery. Reason: ${reason}`, 'Supervisor');
    sendToN8N({ ...order, status: 'failed_delivery', failureReason: reason, endTime: nowTime, failedAt: nowTime }, 'ORDER_FAIL');
    if (order.supabaseId) {
      updateExternalOrderStatus(order.supabaseId, 'failed_delivery', reason);
    }
  };

  /**
   * فتح/إغلاق وردية الطيار: يحدّث الحالة محلياً ويُزامنها مع Supabase
   * يحسب دقائق العمل تلقائياً عند الإغلاق
   */
  const togglePilotShift = async (pilotId) => {
    const pilot = pilots.find(p => String(p.id) === String(pilotId));
    if (!pilot) return;

    const newStatus = pilot.shiftStatus === 'open' ? 'closed' : 'open';

    if (newStatus === 'open' && pilot.shiftUsed) {
      const password = prompt('⚠️ الطيار فتح وردية مسبقاً! للضرورة القصوى أدخل كلمة سر الأدمن لفتحه مرة أخرى:');
      if (password !== '8080') {
        alert('❌ كلمة السر غير صحيحة، تم إلغاء العملية.');
        return;
      }
    }

    let sessionMinutes = 0;
    if (newStatus === 'closed' && pilot.lastOpenedAt) {
      sessionMinutes = calculateDelayMinutes(pilot.lastOpenedAt);
    }

    // Call Supabase to update status
    await supabaseService.updatePilotState(pilotId, {
      shift_status: newStatus,
      ...(newStatus === 'open' ? {
        state: 'available',
        last_return_time: getSafeISOTime(),
        last_opened_at: getSafeISOTime()
      } : {
        state: 'off',
        last_opened_at: null,
        shift_used: true,
        total_minutes: (pilot.totalMinutes || 0) + sessionMinutes
      })
    });

    // Optimistically update UI
    setPilots(prev => prev.map(p => {
      if (String(p.id) === String(pilotId)) {
        const now = getNormalizedNow();
        let sessionMinutes = 0;
        if (newStatus === 'closed' && p.lastOpenedAt) {
          sessionMinutes = calculateDelayMinutes(p.lastOpenedAt);
        }

        const updates = newStatus === 'open'
          ? { state: 'available', lastReturnTime: getSafeISOTime(), lastOpenedAt: getSafeISOTime() }
          : {
            state: 'off',
            lastOpenedAt: null,
            shiftUsed: true,
            totalMinutes: (p.totalMinutes || 0) + sessionMinutes
          };

        return {
          ...p,
          shiftStatus: newStatus,
          ...updates
        };
      }
      return p;
    }));
  };

  /**
   * إحصائيات الوردية الحالية: يحسب أداء كل طيار وإجمالي الطلبات
   * يُستدعى في كل render للـ Dashboard
   */
  const activeStats = () => {
    const finishedOrders = orders.filter(o => o.status === 'completed' || o.status === 'delivered');
    const failedOrders = orders.filter(o => o.status === 'failed_delivery');

    const pilotPerformance = pilots.map(p => {
      const pOrders = finishedOrders.filter(o => String(o.pilotId) === String(p.id));
      const pFailed = failedOrders.filter(o => String(o.pilotId) === String(p.id));

      // Calculate current active minutes if still open
      const currentActiveSession = (p.shiftStatus === 'open' && p.lastOpenedAt)
        ? calculateDelayMinutes(p.lastOpenedAt)
        : 0;

      const totalMinutes = (p.totalMinutes || 0) + currentActiveSession;

      let feeEarnings = 0;
      let restaurantEarnings = 0;
      let talabatEarnings = 0;
      let onlineEarnings = 0;
      let tripEarnings = 0;
      let ordersCount = 0;
      let tripsCount = 0;
      let restaurantOrdersCount = 0;
      let talabatOrdersCount = 0;
      let onlineOrdersCount = 0;

      [...pOrders, ...pFailed].forEach(o => {
        const fee = Number(o.deliveryFee) || 0;
        const source = o.source || (o.type === 'trip' ? 'external' : o.type === 'talabat' || o.type === 'external' ? 'talabat' : 'manual');
        const isCompleted = o.status === 'completed' || o.status === 'delivered';

        if (source === 'external') {
          if (isCompleted) {
            feeEarnings += fee;
            tripEarnings += fee;
          }
          tripsCount++;
        } else {
          const share = fee / 2;
          if (isCompleted) {
            feeEarnings += share;
            ordersCount++;
          }

          if (source === 'online') {
            if (isCompleted) onlineEarnings += share;
            onlineOrdersCount++;
          } else if (source === 'talabat') {
            if (isCompleted) talabatEarnings += share;
            talabatOrdersCount++;
          } else {
            if (isCompleted) restaurantEarnings += share;
            restaurantOrdersCount++;
          }
        }
      });

      const attendancePay = Math.floor(capShiftMinutes(totalMinutes) / 35) * 15;

      return {
        ...p,
        ordersCount,
        tripsCount,
        restaurantOrdersCount,
        talabatOrdersCount,
        onlineOrdersCount,
        failedCount: pFailed.length,
        totalMinutes,
        feeEarnings,
        restaurantEarnings,
        talabatEarnings,
        onlineEarnings,
        tripEarnings,
        attendancePay,
        totalEarnings: feeEarnings + attendancePay
      };
    });

    const delays = orders
      .filter(o => o.status === 'pending' || o.status === 'active')
      .map(o => {
        if (o.status === 'active' && o.startTime) {
          return calculateDelayMinutes(o.startTime);
        }
        return calculateDelayMinutes(o.timestamp);
      });

    const averageDelay = delays.length > 0
      ? Math.floor(delays.reduce((a, b) => a + b, 0) / delays.length)
      : 0;

    return {
      totalOrders: finishedOrders.length + failedOrders.length,
      onlineOrdersCount: finishedOrders.filter(o => o.source === 'online').length + failedOrders.filter(o => o.source === 'online').length,
      averageDelay,
      activeDelaysCount: delays.filter(d => d > 30).length, // Orders delayed more than 30 mins
      pilotPerformance,
      reservationStats: {
        totalDeposits: reservations.filter(r => r.status === 'confirmed').reduce((sum, r) => sum + (Number(r.deposit) || 0), 0),
        count: reservations.length,
        pendingCount: reservations.filter(r => r.status === 'pending').length
      }
    };
  };

  const addReservation = async (resData) => {
    // Save to Supabase
    const savedData = await supabaseService.createReservation(resData);

    if (savedData && savedData.length > 0) {
      const row = savedData[0];
      const newRes = {
        supabaseId: row.id,
        id: `RES-${row.id}`,
        timestamp: row.created_at || getSafeISOTime(),
        status: 'pending',
        deposit: resData.deposit || 105,
        ...resData
      };
      // Optimistic update
      setReservations(prev => [newRes, ...prev]);
      logAction('RES_CREATE', `Reservation for ${resData.customerName}`, 'Cashier');
    } else {
      // حالة العمل بدون إنترنت (Offline Support)
      if (!navigator.onLine) {
        const tempId = `TEMP-${Date.now()}`;
        const newRes = {
          id: tempId,
          timestamp: getSafeISOTime(),
          status: 'pending',
          deposit: resData.deposit || 105,
          ...resData
        };
        setReservations(prev => [newRes, ...prev]);
        logAction('RES_CREATE', `Reservation for ${resData.customerName} (سيتم المزامنة لاحقاً)`, 'Cashier');
      } else {
        alert('حدث خطأ أثناء حفظ الحجز.');
      }
    }
  };

  const confirmReservation = async (id, refNum, paymentProof = null) => {
    const existing = reservations.find(r => r.id === id);
    if (!existing || existing.status === 'confirmed') return; // Idempotent check

    if (existing.supabaseId) {
      await supabaseService.updateReservationStatus(existing.supabaseId, 'confirmed', refNum, paymentProof);
    }

    setReservations(prev => prev.map(r => r.id === id ? { ...r, status: 'confirmed', refNumber: refNum, paymentProof, confirmedAt: getSafeISOTime() } : r));
    logAction('RES_CONFIRM', `Reservation ${id} confirmed with Ref: ${refNum}`, 'Manager');
    sendToN8N({ ...existing, status: 'confirmed', refNumber: refNum, paymentProof }, 'RESERVATION_CONFIRM');
  };

  const deleteReservation = async (id) => {
    await supabaseService.deleteReservation(id);
    setReservations(prev => prev.filter(r => r.id !== id));
    logAction('RES_DELETE', `Reservation ${id} deleted`, 'Supervisor');
  };

  const addNewPilot = async (pilotData) => {
    const { name, phone, start_shift, end_shift, number_id, number_motor } = pilotData;

    if (pilots.some(p => p.name === name)) {
      return { success: false, error: 'اسم الطيار موجود بالفعل!' };
    }

    const savedData = await supabaseService.addDeliveryDriver(pilotData);

    if (savedData && savedData.length > 0) {
      const row = savedData[0];
      const newPilot = {
        id: row.id,
        name,
        phone,
        numberId: row.number_id,
        numberMotor: row.number_motor,
        shift: `${start_shift || '01:00'} - ${end_shift || '11:00'}`,
        state: 'available',
        shiftStatus: 'closed',
        vehicle: 'موتوسيكل',
        ordersCount: 0,
        totalMinutes: 0,
        balance: 0,
        shiftUsed: false
      };
      setPilots(prev => [...prev, newPilot]);
      logAction('PILOT_ADD', `New pilot added: ${name}`, 'Manager');
      return { success: true };
    } else {
      return { success: false, error: 'حدث خطأ أثناء إضافة الطيار.' };
    }
  };

  const deletePilot = async (pilotId) => {
    const password = prompt('أدخل كلمة المرور لحذف هذا الطيار:');
    if (password !== '8080') {
      if (password !== null) alert('كلمة المرور غير صحيحة');
      return { success: false, error: 'كلمة المرور غير صحيحة' };
    }

    if (window.confirm('هل أنت متأكد من حذف هذا الطيار نهائياً؟')) {
      try {
        const success = await supabaseService.deleteDeliveryDriver(pilotId);
        if (success) {
          setPilots(prev => prev.filter(p => String(p.id) !== String(pilotId)));
          logAction('PILOT_DELETE', `Pilot deleted`, 'Manager');
          return { success: true };
        }
      } catch (error) {
        console.error('Delete Pilot Error:', error);
        return { success: false, error: 'حدث خطأ أثناء الحذف' };
      }
    }
    return { success: false, error: 'تم الإلغاء' };
  };

  const computedStats = useMemo(() => activeStats(), [orders, pilots, reservations, currentShift]);

  return (
    <AppContext.Provider value={{
      orders, pilots, currentShift, dailyReports, auditLogs, reservations,
      userRole, setUserRole, // 🔐 تصدير بيانات الدور لباقي السيستم
      isThermalPrintMode, setIsThermalPrintMode,
      openShift, closeShift, addOrder, deleteOrder, cancelOrder, confirmOrder, completeOrder, failDelivery, togglePilotShift, updateOrder, addNewPilot, deletePilot,
      addReservation, confirmReservation, deleteReservation,
      isShiftOpen: currentShift?.status === 'open',
      activeStats: computedStats,
      recalcStats: activeStats,     // expose raw function for manual recalc if needed
      assignPilot, startDelivery, getSuggestedPilot,
      sendToN8N, syncExternalOrders
    }}>
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => useContext(AppContext);
