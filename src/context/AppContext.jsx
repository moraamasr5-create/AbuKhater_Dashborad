// Developed & Owned by D.AmrMamdouh - 01038035884
import React, { createContext, useContext, useState, useEffect, useRef, useMemo } from 'react';
import { API_CONFIG } from '../config/apiConfig';
import { supabaseService, processPendingSync } from '../services/supabaseService';
import { attachReceiptToOrder } from '../services/storageService';
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
import {
  isShiftOperationAllowed,
  isAutoCloseTimeNow,
  DEFAULT_SHIFT_OPEN_TIME,
  DEFAULT_SHIFT_CLOSE_TIME
} from '../utils/shiftGovernance';
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

const mergePilots = (prevPilots, fetchedPilots, pendingPilotIds = new Set()) => {
  // حقول تُزامَن من Supabase — لا نُبقي النسخة المحلية إلا أثناء تحديث معلّق
  const SYNC_FIELDS = ['shiftStatus', 'state', 'lastOpenedAt', 'lastClosedAt', 'totalMinutes', 'shiftUsed', 'lastReturnTime', 'ordersCount'];

  const mergedFetched = fetchedPilots.map(fp => {
    const existing = prevPilots.find(p => String(p.id) === String(fp.id));
    if (!existing) return fp;

    if (pendingPilotIds.has(String(fp.id))) {
      const overlay = {};
      SYNC_FIELDS.forEach(f => {
        if (existing[f] !== undefined) overlay[f] = existing[f];
      });
      return { ...fp, ...overlay, balance: existing.balance ?? 0 };
    }

    // مصدر الحقيقة: بيانات DB — نُبقي فقط الحقول المحلية غير المخزّنة في DB
    return {
      ...fp,
      balance: existing.balance ?? fp.balance ?? 0,
    };
  });

  const localOnly = prevPilots.filter(p => !fetchedPilots.some(fp => String(fp.id) === String(p.id)));
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

  // 🕐 إعدادات أوقات تشغيل الورديات (المصدر: قاعدة البيانات app_config).
  // تُحمَّل من الكاش محلياً أولاً لضمان عمل offline، ثم تُحدّث من DB وتتزامن live.
  const [shiftConfig, setShiftConfig] = useState(() => {
    try {
      const saved = safeGetItem('delivery_shift_config');
      const parsed = (saved && saved !== 'undefined') ? JSON.parse(saved) : null;
      return {
        openTime: parsed?.openTime || DEFAULT_SHIFT_OPEN_TIME,
        closeTime: parsed?.closeTime || DEFAULT_SHIFT_CLOSE_TIME
      };
    } catch {
      return { openTime: DEFAULT_SHIFT_OPEN_TIME, closeTime: DEFAULT_SHIFT_CLOSE_TIME };
    }
  });

  // المرجع يضمن أن أحدث الإعدادات متاحة داخل دوال فتح/إغلاق الوردية دون
  // الاعتماد على closure قديم.
  const shiftConfigRef = useRef(shiftConfig);
  useEffect(() => {
    shiftConfigRef.current = shiftConfig;
    safeSetItem('delivery_shift_config', JSON.stringify(shiftConfig));
  }, [shiftConfig]);

  // يحوّل Map الإعدادات القادمة من DB إلى شكل shiftConfig
  const applyConfigMap = (map) => {
    if (!map) return;
    setShiftConfig(prev => ({
      openTime: map.shift_open_time || prev.openTime,
      closeTime: map.shift_close_time || prev.closeTime
    }));
  };

  // تحميل الإعدادات من قاعدة البيانات + الاشتراك في التغييرات اللحظية
  useEffect(() => {
    let configSub;
    const loadConfig = async () => {
      try {
        const map = await supabaseService.fetchAppConfig();
        applyConfigMap(map);
      } catch (e) {
        console.warn('[ShiftConfig] Could not load app_config:', e?.message);
      }
    };

    loadConfig();

    // أي تعديل للأوقات من قاعدة البيانات يُطبَّق فوراً على كل المستخدمين
    configSub = supabaseService.subscribeToAppConfig(() => {
      supabaseService.fetchAppConfig().then(applyConfigMap);
    });

    return () => {
      if (configSub) configSub.unsubscribe();
    };
  }, []);

  /**
   * تحديث أوقات التشغيل في قاعدة البيانات (للمدير فقط).
   * يُطبَّق التغيير فوراً محلياً ثم يُبثّ لباقي المستخدمين عبر realtime.
   */
  const updateShiftConfig = async ({ openTime, closeTime }) => {
    const updates = [];
    if (openTime && openTime !== shiftConfig.openTime) {
      updates.push(supabaseService.updateAppConfig('shift_open_time', openTime));
    }
    if (closeTime && closeTime !== shiftConfig.closeTime) {
      updates.push(supabaseService.updateAppConfig('shift_close_time', closeTime));
    }
    if (!updates.length) return { success: true };

    try {
      await Promise.all(updates);
      setShiftConfig(prev => ({
        openTime: openTime || prev.openTime,
        closeTime: closeTime || prev.closeTime
      }));
      logAction('SHIFT_CONFIG_UPDATE', `تحديث أوقات التشغيل: فتح ${openTime}, إغلاق ${closeTime}`, 'Admin');
      return { success: true };
    } catch (e) {
      console.error('❌ Failed to update shift config:', e);
      return { success: false, error: e?.message || 'تعذّر حفظ الإعدادات' };
    }
  };

  useEffect(() => {
    safeSetItem('delivery_current_shift', JSON.stringify(currentShift));
  }, [currentShift]);

  const [auditLogs, setAuditLogs] = useState([]);

  // عند تحميل التطبيق: أعد محاولة العمليات المعلّقة (pendingSync) في حال وجود اتصال
  useEffect(() => {
    localStorage.removeItem('order_sequence_num'); // Remove legacy sequential ID
    processPendingSync();
  }, []);

  // إغلاق تلقائي للوردية عند بلوغ وقت الإغلاق (المصدر: قاعدة البيانات، بتوقيت القاهرة)
  useEffect(() => {
    const checkAutoClose = () => {
      if (currentShift && isAutoCloseTimeNow(shiftConfigRef.current.closeTime, getNormalizedNow())) {
        closeShift(true);
      }
    };

    const timer = setInterval(checkAutoClose, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, [currentShift]);

  // 🔥 3. Real-time Dashboard (Supabase Live System)
  const retryRef = useRef(0);
  const pendingUpdatesRef = useRef(new Set()); // Set of supabaseIds being updated
  const pendingPilotUpdatesRef = useRef(new Set()); // pilot ids with in-flight DB writes
  const pendingReceiptFilesRef = useRef(new Map()); // localOrderId -> File (awaiting upload after DB insert)

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

        if (fetchedPilots) setPilots(prev => mergePilots(prev, fetchedPilots, pendingPilotUpdatesRef.current));
        if (fetchedRes) setReservations(fetchedRes);

        if (fetchedOrders && fetchedOrders.length > 0) {
          setOrders(prev => {
            const newOrdersForAudio = fetchedOrders.filter(fo => {
              const notInPrev = !prev.some(o => o.supabaseId === fo.supabaseId);
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
              // Try to find the local order matching this fetched order uniquely by supabaseId first
              let existing = prev.find(o => o.supabaseId === fo.supabaseId);
              if (!existing) {
                // Fallback to matching by originalId/id for pending manual orders that don't have a supabaseId yet
                existing = prev.find(o => !o.supabaseId && (o.originalId || o.id) === fo.originalId);
              }
              if (!existing) return fo;

              const isPending = pendingUpdatesRef.current.has(String(fo.supabaseId));
              const localIsNewer = existing.confirmedAt || existing.assignedAt || existing.startTime;

              const mergedStatus = isPending ? existing.status : (localIsNewer ? existing.status : fo.status);

              const localFields = {};
              LOCAL_ONLY_FIELDS.forEach(f => {
                if (existing[f] !== undefined) localFields[f] = existing[f];
              });

              return { ...fo, ...localFields, status: mergedStatus };
            });

            const manualOrders = prev.filter(p => !p.supabaseId);

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
        if (fetched) setPilots(prev => mergePilots(prev, fetched, pendingPilotUpdatesRef.current));
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
        const onlyNew = fetchedOrders.filter(fo => {
          // Check if it is already in prev uniquely by supabaseId
          const existsBySupabaseId = prev.some(p => p.supabaseId === fo.supabaseId);
          if (existsBySupabaseId) return false;

          // If not in prev by supabaseId, verify if it matches a pending manual order
          const existsByOriginalId = prev.some(p => !p.supabaseId && (p.originalId || p.id) === fo.originalId);
          if (existsByOriginalId) return false;

          return true;
        });
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
    const config = shiftConfigRef.current;
    const logicalDate = getLogicalShiftDateString(config.openTime);
    console.log(`[Shift] Checking shift for date: ${logicalDate}`);

    try {
      // التحقق من وجود وردية مفتوحة في Supabase (الاستئناف مسموح دائماً)
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

    // 🛡️ حوكمة فتح الوردية (Frontend) — المرجع المركزي isShiftOperationAllowed
    const gate = isShiftOperationAllowed({
      operation: 'open',
      openTime: config.openTime,
      closeTime: config.closeTime,
      isAdmin: userRole === 'admin'
    });
    if (!gate.allowed) {
      alert(gate.reason);
      logAction('SHIFT_OPEN_BLOCKED', gate.reason, userRole || 'User');
      return;
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

      await supabaseService.createShift(newShift);

      console.log('✅ Shift created successfully in Supabase');
      logAction('SHIFT_OPEN', `فتح وردية جديدة - ${logicalDate}`, 'Manager');
      alert('✅ تم فتح وردية جديدة بنجاح');

    } catch (error) {
      console.error('❌ Failed to create shift:', error);
      // رفض السيرفر (مثل خارج وقت التشغيل) — تراجع عن الفتح المتفائل
      const serverReason = error?.message || '';
      const isGovernanceBlock = error?.code === 'P0001' ||
        serverReason.includes('الوردية') || serverReason.includes('التشغيل');
      if (isGovernanceBlock) {
        setCurrentShift(null);
        alert(serverReason || '❌ تعذّر فتح الوردية (خارج وقت التشغيل).');
        logAction('SHIFT_OPEN_BLOCKED', serverReason, userRole || 'User');
      } else {
        alert(`❌ خطأ في فتح الوردية: ${serverReason}`);
      }
    }
  };

  /**
   * إغلاق الوردية: يحفظ التقرير ويُرسله لـ Supabase
   * يعمل بشكل كامل offline ويتزامن لاحقاً
   */
  const closeShift = async (force = false) => {
    if (!currentShift) return false;

    const config = shiftConfigRef.current;
    const isAdmin = userRole === 'admin';

    // 🛡️ حوكمة إغلاق الوردية (Frontend) — المرجع المركزي isShiftOperationAllowed
    // force=true يأتي من الإغلاق التلقائي (System) أو من الإغلاق الإجباري للمدير.
    let forceClose = force;
    const gate = isShiftOperationAllowed({
      operation: 'close',
      openTime: config.openTime,
      closeTime: config.closeTime,
      isAdmin,
      forceClose
    });

    if (!gate.allowed) {
      // المدير فقط يمكنه تجاوز موعد الإغلاق عبر الإغلاق الإجباري
      if (isAdmin) {
        const confirmed = window.confirm(
          `${gate.reason}\n\nأنت مدير (Admin): هل تريد تنفيذ إغلاق إجباري (Force Close)؟`
        );
        if (!confirmed) return false;
        forceClose = true;
        logAction('SHIFT_FORCE_CLOSE', 'إغلاق إجباري للوردية بواسطة المدير', 'Admin');
      } else {
        alert(gate.reason);
        logAction('SHIFT_CLOSE_BLOCKED', gate.reason, userRole || 'User');
        return false;
      }
    }

    const hasOpenPilotShifts = pilots.some(p => p.shiftStatus === 'open');

    // منع الإغلاق إذا كان هناك طيارين مفتوحين (إلا إذا تم الإجبار)
    if (!forceClose && hasOpenPilotShifts) {
      alert('⚠️ لا يمكن إغلاق الوردية! يوجد طيارين لم يغلقوا شفتاتهم بعد.');
      return false;
    }

    const stats = activeStats();

    const snapshot = {
      ...currentShift,
      forceClose,
      endTime: getSafeISOTime(),
      status: 'closed',
      ordersCount: stats.totalOrders,
      totalDeliveryFees: stats.pilotPerformance.reduce((sum, p) => sum + p.feeEarnings, 0),
      totalAttendancePay: stats.pilotPerformance.reduce((sum, p) => sum + p.attendancePay, 0),
      totalPilotDues: stats.pilotPerformance.reduce((sum, p) => sum + p.totalEarnings, 0),
      pilotStats: stats.pilotPerformance,
      archivedOrders: orders
    };

    try {
      // استدعاء RPC close_shift من خلال saveShiftReport
      await supabaseService.saveShiftReport(snapshot);

      setDailyReports(prev => [snapshot, ...prev]);

      logAction('SHIFT_CLOSE', `Shift closed. Orders: ${stats.totalOrders}.`, 'Manager');
      sendToN8N(snapshot, 'SHIFT_CLOSE');

      // Bulk reset all pilots in the Supabase delivery table
      const allPilotIds = pilots.map(p => p.id);
      if (allPilotIds.length > 0) {
        supabaseService.resetAllPilots(allPilotIds);
      }

      setOrders([]);
      setCurrentShift(null);
      setPilots(prev => prev.map(p => ({ ...p, shiftStatus: 'closed', state: 'available', balance: 0, totalMinutes: 0, ordersCount: 0, shiftUsed: false, lastOpenedAt: null })));
      alert('✅ تم إغلاق الوردية بنجاح.');
      return true;

    } catch (error) {
      console.error('❌ Failed to close shift:', error);
      let errorMsg = 'حدث خطأ أثناء إغلاق الوردية.';
      if (error.message && (error.message.includes('Too early') || error.message.includes('موعد الإغلاق') || error.message.includes('قبل الساعة 4:00'))) {
        errorMsg = error.message.includes('موعد الإغلاق')
          ? error.message
          : '⚠️ لا يمكن إغلاق الوردية قبل موعد الإغلاق المحدد!';
      } else if (error.message && (error.message.includes('Active orders') || error.message.includes('طلبات نشطة'))) {
        errorMsg = '⚠️ لا يمكن إغلاق الوردية! يوجد طلبات نشطة.';
      } else if (error.message) {
        errorMsg = `❌ خطأ من السيرفر: ${error.message}`;
      }
      alert(errorMsg);
      return false;
    }
  };

  /**
   * يرفع صورة الإيصال بعد إنشاء صف الطلب في Supabase
   */
  const uploadOrderReceipt = async (localOrderId, supabaseId) => {
    const file = pendingReceiptFilesRef.current.get(localOrderId);
    if (!file || !supabaseId) return;

    setOrders(prev => prev.map(o =>
      o.id === localOrderId ? { ...o, receiptUploadStatus: 'uploading' } : o
    ));

    try {
      const url = await attachReceiptToOrder(supabaseId, file);
      pendingReceiptFilesRef.current.delete(localOrderId);
      setOrders(prev => prev.map(o =>
        o.id === localOrderId
          ? { ...o, paymentScreenshot: url, paymentProof: url, receiptUploadStatus: 'done' }
          : o
      ));
    } catch (err) {
      console.error('❌ Receipt upload failed:', err);
      setOrders(prev => prev.map(o =>
        o.id === localOrderId ? { ...o, receiptUploadStatus: 'failed' } : o
      ));
    }
  };

  const retryReceiptUpload = (localOrderId) => {
    const order = orders.find(o => o.id === localOrderId);
    if (order?.supabaseId) {
      uploadOrderReceipt(localOrderId, order.supabaseId);
    }
  };

  /**
   * يحفظ طلب الكول سنتر/التابلت في Supabase أولاً ثم يرفع الإيصال بشكل غير متزامن
   */
  const persistManualOrderToSupabase = async (localOrderId, orderPayload) => {
    const persistableSources = ['manual', 'talabat'];
    if (!persistableSources.includes(orderPayload.source)) return;

    try {
      const row = await supabaseService.createManualOrder({
        ...orderPayload,
        shiftId: currentShift?.id
      });

      if (!row?.id) return;

      setOrders(prev => prev.map(o =>
        o.id === localOrderId ? { ...o, supabaseId: row.id } : o
      ));

      if (pendingReceiptFilesRef.current.has(localOrderId)) {
        uploadOrderReceipt(localOrderId, row.id);
      }
    } catch (err) {
      console.error('❌ Failed to persist manual order to Supabase:', err);
    }
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
      alert(`رقم البون ${orderData.id} مكرر أكثر من الحد المسموح (مرتين كاحد أقصي)!`);
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

    const { paymentReceiptFile, ...orderFields } = orderData;

    const newOrder = {
      ...orderFields,
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
      remainingAmount,
      receiptUploadStatus: paymentReceiptFile ? 'pending' : null
    };

    if (paymentReceiptFile instanceof File) {
      pendingReceiptFilesRef.current.set(finalId, paymentReceiptFile);
    }

    setOrders(prev => [newOrder, ...prev]);
    logAction('ORDER_CREATE', `Order #${orderData.id} created`, 'Operator');
    sendToN8N(newOrder, 'ORDER_CREATE');

    persistManualOrderToSupabase(finalId, { ...orderFields, id: orderData.id });

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
  const assignPilot = async (orderId, pilotId) => {
    const order = orders.find(o => o.id === orderId);
    if (!order || ['driver_assigned', 'active', 'completed', 'delivered', 'cancelled', 'failed_delivery'].includes(order.status)) return;

    const pilot = pilots.find(p => String(p.id) === String(pilotId));
    if (!pilot) {
      console.error(`Pilot ${pilotId} not found.`);
      alert(`⚠️ خطأ: لم يتم العثور على الطيار!`);
      return;
    }

    if (pilot.shiftStatus !== 'open') {
      alert(`⚠️ خطأ: وردية الطيار ${pilot.name} غير مفتوحة!`);
      return;
    }

    if (pilot.state !== 'available') {
      const errorMsg = `Cannot assign order to pilot ${pilot.name} because their state is '${pilot.state}'.`;
      console.error(errorMsg);
      alert(`⚠️ خطأ: الطيار ${pilot.name} غير متاح حالياً (حالة الطيار: ${pilot.state})!`);
      return;
    }

    const deliveryId = Number(pilotId);
    if (!Number.isFinite(deliveryId)) {
      alert('⚠️ خطأ: معرف الطيار غير صالح');
      return;
    }

    const pilotName = pilot.name || 'Unknown';
    const assignedAt = getSafeISOTime();
    const optimisticOrder = {
      ...order,
      status: 'driver_assigned',
      pilotId: String(deliveryId),
      deliveryId,
      assignedAt
    };

    setOrders(prev => prev.map(o => (o.id === orderId ? optimisticOrder : o)));
    logAction('ORDER_ASSIGN', `Order #${orderId} assigned to ${pilotName}`, 'Supervisor');

    if (!order.supabaseId) return;

    pendingUpdatesRef.current.add(String(order.supabaseId));
    try {
      await supabaseService.assignOrderToPilot(order.supabaseId, deliveryId, pilotName);
    } catch (e) {
      setOrders(prev => prev.map(o => (o.id === orderId ? order : o)));
      const msg = e?.message || '';
      if (msg.includes('not available')) alert(`⚠️ الطيار ${pilotName} غير متاح — ربما سُند لطلب آخر.`);
      else if (msg.includes('shift is not open')) alert(`⚠️ وردية الطيار ${pilotName} غير مفتوحة.`);
      else if (msg.includes('7 assigned')) alert(`⚠️ الطيار ${pilotName} وصل للحد الأقصى (7 طلبات).`);
      else alert(`⚠️ فشل إسناد الطلب: ${msg || 'خطأ غير معروف'}`);
    } finally {
      setTimeout(() => {
        pendingUpdatesRef.current.delete(String(order.supabaseId));
      }, 2000);
    }
  };

  // Step 3: Start Delivery — one order at a time; pilot leaves restaurant (on_delivery) on first start
  const startDelivery = async (orderId) => {
    const order = orders.find(o => o.id === orderId);
    if (!order || order.status !== 'driver_assigned' || !(order.deliveryId || order.pilotId)) return;

    const deliveryId = Number(order.deliveryId || order.pilotId);
    if (!Number.isFinite(deliveryId)) return;

    const startTime = getSafeISOTime();
    const prevOrders = orders;
    const prevPilots = pilots;

    setOrders(prev => prev.map(o =>
      o.id === orderId ? { ...o, status: 'active', startTime } : o
    ));

    setPilots(prev => prev.map(p =>
      Number(p.id) === deliveryId ? { ...p, state: 'on_delivery' } : p
    ));

    logAction('DELIVERY_START', `Order #${order.originalId || order.id} out for delivery`, 'System');

    if (!order.supabaseId) return;

    pendingPilotUpdatesRef.current.add(String(deliveryId));
    pendingUpdatesRef.current.add(String(order.supabaseId));

    try {
      await supabaseService.startPilotTrip(order.supabaseId);
    } catch (e) {
      setOrders(prevOrders);
      setPilots(prevPilots);
      alert(`⚠️ فشل بدء الرحلة: ${e?.message || 'خطأ غير معروف'}`);
    } finally {
      setTimeout(() => {
        pendingPilotUpdatesRef.current.delete(String(deliveryId));
        pendingUpdatesRef.current.delete(String(order.supabaseId));
      }, 2000);
    }
  };

  // Step 4: Complete (Pilot Returns -> Status Available + Queue Update)
  /**
   * إتمام الطلب: يُعيد الطيار لقائمة الانتظار ويحدّث الحالة
   */
  const completeOrder = async (orderId) => {
    const order = orders.find(o => o.id === orderId);
    if (!order || order.status === 'completed' || order.status === 'delivered') return;

    const nowTime = getSafeISOTime();
    const deliveryId = Number(order.deliveryId || order.pilotId);
    const prevOrders = orders;
    const prevPilots = pilots;

    const otherPending = Number.isFinite(deliveryId) && orders.some(o =>
      Number(o.deliveryId || o.pilotId) === deliveryId &&
      o.id !== orderId &&
      (o.status === 'active' || o.status === 'driver_assigned')
    );
    const nextPilotState = otherPending ? 'on_delivery' : 'available';

    setOrders(prev => prev.map(o =>
      o.id === orderId
        ? { ...o, status: 'delivered', endTime: nowTime, deliveredAt: nowTime }
        : o
    ));

    if (Number.isFinite(deliveryId)) {
      setPilots(prev => prev.map(p => {
        if (Number(p.id) !== deliveryId) return p;
        const returnTimeUpdates = nextPilotState === 'available'
          ? { lastReturnTime: nowTime, ordersCount: (p.ordersCount || 0) + 1 }
          : {};
        return { ...p, state: nextPilotState, ...returnTimeUpdates };
      }));
    }

    logAction('ORDER_COMPLETE', `Order #${orderId} completed`, 'Supervisor');
    sendToN8N({ ...order, status: 'delivered', endTime: nowTime, deliveredAt: nowTime }, 'ORDER_COMPLETE');

    if (!order.supabaseId) return;

    pendingUpdatesRef.current.add(String(order.supabaseId));
    if (Number.isFinite(deliveryId)) pendingPilotUpdatesRef.current.add(String(deliveryId));

    try {
      await supabaseService.completeOrderDelivery(order.supabaseId);
    } catch (e) {
      setOrders(prevOrders);
      setPilots(prevPilots);
      alert(`⚠️ فشل إتمام التوصيل: ${e?.message || 'خطأ غير معروف'}`);
    } finally {
      setTimeout(() => {
        pendingUpdatesRef.current.delete(String(order.supabaseId));
        if (Number.isFinite(deliveryId)) pendingPilotUpdatesRef.current.delete(String(deliveryId));
      }, 2000);
    }
  };

  const failDelivery = async (orderId, reason) => {
    const order = orders.find(o => o.id === orderId);
    if (!order || order.status === 'failed_delivery') return;

    const nowTime = getSafeISOTime();
    const deliveryId = Number(order.deliveryId || order.pilotId);
    const prevOrders = orders;
    const prevPilots = pilots;

    const otherPending = Number.isFinite(deliveryId) && orders.some(o =>
      Number(o.deliveryId || o.pilotId) === deliveryId &&
      o.id !== orderId &&
      (o.status === 'active' || o.status === 'driver_assigned')
    );
    const nextPilotState = otherPending ? 'on_delivery' : 'available';

    setOrders(prev => prev.map(o =>
      o.id === orderId
        ? { ...o, status: 'failed_delivery', failureReason: reason, endTime: nowTime, failedAt: nowTime }
        : o
    ));

    if (Number.isFinite(deliveryId)) {
      setPilots(prev => prev.map(p => {
        if (Number(p.id) !== deliveryId) return p;
        const returnTimeUpdates = nextPilotState === 'available' ? { lastReturnTime: nowTime } : {};
        return { ...p, state: nextPilotState, ...returnTimeUpdates };
      }));
    }

    logAction('DELIVERY_FAIL', `Order #${orderId} failed delivery. Reason: ${reason}`, 'Supervisor');
    sendToN8N({ ...order, status: 'failed_delivery', failureReason: reason, endTime: nowTime, failedAt: nowTime }, 'ORDER_FAIL');

    if (!order.supabaseId) return;

    pendingUpdatesRef.current.add(String(order.supabaseId));
    if (Number.isFinite(deliveryId)) pendingPilotUpdatesRef.current.add(String(deliveryId));

    try {
      await supabaseService.failOrderDelivery(order.supabaseId, reason);
    } catch (e) {
      setOrders(prevOrders);
      setPilots(prevPilots);
      alert(`⚠️ فشل تسجيل فشل التوصيل: ${e?.message || 'خطأ غير معروف'}`);
    } finally {
      setTimeout(() => {
        pendingUpdatesRef.current.delete(String(order.supabaseId));
        if (Number.isFinite(deliveryId)) pendingPilotUpdatesRef.current.delete(String(deliveryId));
      }, 2000);
    }
  };

  /**
   * فتح/إغلاق وردية الطيار: يحدّث الحالة محلياً ويُزامنها مع Supabase
   * يحسب دقائق العمل تلقائياً عند الإغلاق
   */
  const togglePilotShift = async (pilotId) => {
    const pilot = pilots.find(p => String(p.id) === String(pilotId));
    if (!pilot) return;

    const deliveryId = Number(pilotId);
    if (!Number.isFinite(deliveryId)) return;

    const newStatus = pilot.shiftStatus === 'open' ? 'closed' : 'open';
    let forceReopen = false;

    if (newStatus === 'open' && pilot.shiftUsed) {
      const password = prompt('⚠️ الطيار فتح وردية مسبقاً! للضرورة القصوى أدخل كلمة سر الأدمن لفتحه مرة أخرى:');
      if (password !== '8080') {
        alert('❌ كلمة السر غير صحيحة، تم إلغاء العملية.');
        return;
      }
      forceReopen = true;
    }

    const closedAt = getSafeISOTime();
    const prevPilots = pilots;

    setPilots(prev => prev.map(p => {
      if (String(p.id) !== String(pilotId)) return p;

      let sessionMinutes = 0;
      if (newStatus === 'closed' && p.lastOpenedAt) {
        sessionMinutes = calculateDelayMinutes(p.lastOpenedAt, closedAt);
      }

      const updates = newStatus === 'open'
        ? { state: 'available', lastReturnTime: getSafeISOTime(), lastOpenedAt: getSafeISOTime(), lastClosedAt: null }
        : {
          state: 'off',
          lastClosedAt: closedAt,
          shiftUsed: true,
          totalMinutes: (p.totalMinutes || 0) + sessionMinutes
        };

      return { ...p, shiftStatus: newStatus, ...updates };
    }));

    pendingPilotUpdatesRef.current.add(String(deliveryId));
    try {
      await supabaseService.togglePilotShift(deliveryId, forceReopen);
    } catch (e) {
      setPilots(prevPilots);
      const msg = e?.message || '';
      if (msg.includes('force reopen')) alert('⚠️ الطيار فتح وردية مسبقاً — يتطلب موافقة الأدمن.');
      else alert(`⚠️ فشل تحديث وردية الطيار: ${msg || 'خطأ غير معروف'}`);
    } finally {
      setTimeout(() => {
        pendingPilotUpdatesRef.current.delete(String(deliveryId));
      }, 1500);
    }
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
      // 🕐 حوكمة أوقات الورديات (المصدر: قاعدة البيانات)
      shiftConfig, updateShiftConfig,
      checkShiftOperation: (operation, opts = {}) => isShiftOperationAllowed({
        operation,
        openTime: shiftConfig.openTime,
        closeTime: shiftConfig.closeTime,
        isAdmin: userRole === 'admin',
        ...opts
      }),
      openShift, closeShift, addOrder, deleteOrder, cancelOrder, confirmOrder, completeOrder, failDelivery, togglePilotShift, updateOrder, addNewPilot, deletePilot,
      retryReceiptUpload,
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
