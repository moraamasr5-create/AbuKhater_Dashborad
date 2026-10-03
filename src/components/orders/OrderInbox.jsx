// Developed & Owned by D.AmrMamdouh - 01038035884
import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import {
  Check, X, AlertCircle, UserPlus, RotateCcw, Clock, Bike,
  RefreshCw, ShoppingCart, ChevronDown, ChevronUp, MapPin,
  Search, Filter, Phone, DollarSign, AlertTriangle, Printer,
  Eye, CheckCircle2, Flame, Sparkles, Navigation, Layers, Package
} from 'lucide-react';
import { printerService } from '../../services/printerService';
import { ReceiptThumbnail } from '../../services/storageService';
import { motion, AnimatePresence } from 'framer-motion';
import { isPilotOnDelivery } from '../../utils/pilotState';
import { Disclosure, toast } from '../common/ui';
import { parseItemCommercialDetails } from '../../utils/commercialItemParser';

const RESTAURANT_COORDS = { lat: 30.126131, lng: 31.298350 };

const calculateDistance = (lat1, lon1, lat2, lon2) => {
  if (!lat1 || !lon1 || !lat2 || !lon2) return null;
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return (R * c).toFixed(1);
};

const getZone = (dist) => {
  if (dist === null || dist === undefined) return null;
  const d = Number(dist);
  if (d <= 3) return { id: 1, label: 'نطاق 1 (قريب)', color: '#10b981', bg: 'rgba(16, 185, 129, 0.15)' };
  if (d <= 7) return { id: 2, label: 'نطاق 2 (متوسط)', color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.15)' };
  if (d <= 10) return { id: 3, label: 'نطاق 3 (بعيد)', color: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.15)' };
  if (d <= 15) return { id: 4, label: 'نطاق 4 (أطراف)', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)' };
  return { id: 'Out', label: 'خارج النطاق', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.15)' };
};

const getOrderPaymentScreenshot = (order) =>
  order.paymentScreenshot || order.screenshot || order.image || order.attachment || order.paymentProof || null;

const getElapsedMinutes = (timestamp) => {
  if (!timestamp) return 0;
  const diffMs = Date.now() - new Date(timestamp).getTime();
  return Math.max(0, Math.floor(diffMs / 60000));
};

// ⏱️ مكون حساب وعرض الوقت المنقضي بألوان تحذيرية حية (Memoized للأداء العالي)
const LiveElapsedBadge = React.memo(({ timestamp, startTime, isOut }) => {
  const [minutes, setMinutes] = useState(() => getElapsedMinutes(startTime || timestamp));

  useEffect(() => {
    const update = () => setMinutes(getElapsedMinutes(startTime || timestamp));
    update();
    const timer = setInterval(update, 15000);
    return () => clearInterval(timer);
  }, [timestamp, startTime]);

  let color = '#10b981';
  let bg = 'rgba(16, 185, 129, 0.12)';
  let border = 'rgba(16, 185, 129, 0.25)';
  let label = `${minutes} دقيقة`;
  let isUrgent = false;

  if (minutes >= 45) {
    color = '#ef4444';
    bg = 'rgba(239, 68, 68, 0.2)';
    border = 'rgba(239, 68, 68, 0.4)';
    label = `🚨 ${minutes} د (تأخير حرج)`;
    isUrgent = true;
  } else if (minutes >= 30) {
    color = '#f97316';
    bg = 'rgba(249, 115, 22, 0.18)';
    border = 'rgba(249, 115, 22, 0.35)';
    label = `⚠️ ${minutes} د (متأخر)`;
  } else if (minutes >= 15) {
    color = '#f59e0b';
    bg = 'rgba(245, 158, 11, 0.15)';
    border = 'rgba(245, 158, 11, 0.3)';
    label = `⏱️ ${minutes} د`;
  } else {
    label = `⏱️ ${minutes} د`;
  }

  return (
    <div
      className={isUrgent ? 'pulse-urgent' : ''}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '4px 10px',
        borderRadius: '20px',
        fontSize: '0.8rem',
        fontWeight: '700',
        color,
        background: bg,
        border: `1px solid ${border}`,
        whiteSpace: 'nowrap'
      }}
      title={isOut ? `منذ بدء الرحلة: ${minutes} دقيقة` : `منذ إنشاء الطلب: ${minutes} دقيقة`}
    >
      <Clock size={13} />
      <span>{label}</span>
    </div>
  );
});

// 🚫 نافذة مودال عصرية لإلغاء الطلب (بديل لـ prompt)
const CancelOrderModal = ({ isOpen, onClose, onConfirm, orderNumber }) => {
  const [reason, setReason] = useState('');
  const quickReasons = [
    'العميل طلب الإلغاء',
    'العنوان خارج نطاق التوصيل',
    'الصنف غير متوفر بالمطبخ',
    'تأخر الرد على الهاتف',
    'طلب مكرر بالخطأ'
  ];

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(4, 7, 14, 0.8)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 9999, backdropFilter: 'blur(10px)', padding: '16px'
    }}>
      <div className="glass-card" style={{
        width: '100%', maxWidth: '440px', padding: '24px',
        background: 'linear-gradient(180deg, #162035 0%, #111827 100%)',
        border: '1px solid rgba(239, 68, 68, 0.45)',
        boxShadow: 'var(--highlight-top-strong), var(--elevation-5)',
        borderRadius: '20px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#f87171', marginBottom: '14px' }}>
          <AlertTriangle size={24} />
          <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: '900' }}>إلغاء الطلب #{orderNumber}</h3>
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '16px', lineHeight: '1.5' }}>
          يرجى تحديد أو كتابة سبب إلغاء هذا الطلب لحفظه في سجل العمليات:
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' }}>
          {quickReasons.map(r => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(r)}
              style={{
                background: reason === r ? 'rgba(239, 68, 68, 0.22)' : 'rgba(255, 255, 255, 0.05)',
                color: reason === r ? '#f87171' : 'var(--text-main)',
                border: `1px solid ${reason === r ? 'rgba(239, 68, 68, 0.5)' : 'var(--border)'}`,
                boxShadow: reason === r ? 'var(--highlight-top), 0 2px 8px rgba(239, 68, 68, 0.25)' : 'var(--elevation-1)',
                padding: '6px 12px', borderRadius: '8px', fontSize: '0.8rem', cursor: 'pointer',
                minHeight: '34px', fontWeight: reason === r ? '800' : '600'
              }}
            >
              {r}
            </button>
          ))}
        </div>

        <textarea
          autoFocus
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="اكتب سبب الإلغاء هنا..."
          rows={3}
          style={{
            width: '100%', marginBottom: '20px', resize: 'none'
          }}
        />

        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={() => {
              if (!reason.trim()) {
                alert('⚠️ يرجى كتابة سبب الإلغاء');
                return;
              }
              onConfirm(reason.trim());
              setReason('');
            }}
            className="btn-primary"
            style={{
              flex: 1,
              background: 'linear-gradient(180deg, #ef4444 0%, #dc2626 100%)',
              color: 'white',
              boxShadow: 'var(--bevel-btn), 0 4px 14px var(--danger-glow)',
              fontWeight: '800'
            }}
          >
            تأكيد الإلغاء
          </button>
          <button
            onClick={() => {
              setReason('');
              onClose();
            }}
            className="btn-secondary"
            style={{ flex: 0.6 }}
          >
            تراجع
          </button>
        </div>
      </div>
    </div>
  );
};

// ⚠️ نافذة مودال عصرية لتعذر / فشل التوصيل (بديل لـ prompt)
const FailDeliveryModal = ({ isOpen, onClose, onConfirm, orderNumber }) => {
  const [reason, setReason] = useState('');
  const quickReasons = [
    'العميل لا يجيب على الهاتف',
    'العنوان غير دقيق / تعذر الوصول',
    'العميل رفض استلام الأوردر',
    'مشكلة في الدفع عند الاستلام',
    'العميل ألغى بعد خروج الطيار'
  ];

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(4, 7, 14, 0.8)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 9999, backdropFilter: 'blur(10px)', padding: '16px'
    }}>
      <div className="glass-card" style={{
        width: '100%', maxWidth: '440px', padding: '24px',
        background: 'linear-gradient(180deg, #162035 0%, #111827 100%)',
        border: '1px solid rgba(245, 158, 11, 0.45)',
        boxShadow: 'var(--highlight-top-strong), var(--elevation-5)',
        borderRadius: '20px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#fbbf24', marginBottom: '14px' }}>
          <AlertCircle size={24} />
          <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: '900' }}>تسجيل تعذر توصيل #{orderNumber}</h3>
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '16px', lineHeight: '1.5' }}>
          حدد سبب عدم تسليم الطلب لإرجاع الطيار وتسجيل الحالة:
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' }}>
          {quickReasons.map(r => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(r)}
              style={{
                background: reason === r ? 'rgba(245, 158, 11, 0.22)' : 'rgba(255, 255, 255, 0.05)',
                color: reason === r ? '#fbbf24' : 'var(--text-main)',
                border: `1px solid ${reason === r ? 'rgba(245, 158, 11, 0.5)' : 'var(--border)'}`,
                boxShadow: reason === r ? 'var(--highlight-top), 0 2px 8px rgba(245, 158, 11, 0.25)' : 'var(--elevation-1)',
                padding: '6px 12px', borderRadius: '8px', fontSize: '0.8rem', cursor: 'pointer',
                minHeight: '34px', fontWeight: reason === r ? '800' : '600'
              }}
            >
              {r}
            </button>
          ))}
        </div>

        <textarea
          autoFocus
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="اكتب ملاحظة التوصيل هنا..."
          rows={3}
          style={{
            width: '100%', marginBottom: '20px', resize: 'none'
          }}
        />

        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={() => {
              if (!reason.trim()) {
                alert('⚠️ يرجى كتابة سبب تعذر التوصيل');
                return;
              }
              onConfirm(reason.trim());
              setReason('');
            }}
            className="btn-primary"
            style={{
              flex: 1,
              background: 'linear-gradient(180deg, #f59e0b 0%, #d97706 100%)',
              color: '#000',
              boxShadow: 'var(--bevel-btn), 0 4px 14px var(--warning-glow)',
              fontWeight: '900'
            }}
          >
            تسجيل الفشل
          </button>
          <button
            onClick={() => {
              setReason('');
              onClose();
            }}
            className="btn-secondary"
            style={{ flex: 0.6 }}
          >
            تراجع
          </button>
        </div>
      </div>
    </div>
  );
};

const OrderInbox = ({ onReedit }) => {
  const {
    orders, pilots, confirmOrder, readyOrder, deleteOrder, cancelOrder, isShiftOpen,
    assignPilot, startDelivery, completeOrder, failDelivery, getSuggestedPilot,
    syncExternalOrders, userRole, isThermalPrintMode, retryReceiptUpload
  } = useApp();

  // Filters & State
  const [statusTab, setStatusTab] = useState('all'); // 'all' | 'pending' | 'preparing' | 'ready' | 'driver_assigned' | 'delayed'
  const [sourceFilter, setSourceFilter] = useState('all'); // 'all' | 'online' | 'restaurant' | 'talabat' | 'trip'
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPilot, setSelectedPilot] = useState({});
  const [auditTimers, setAuditTimers] = useState({});
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [previewImage, setPreviewImage] = useState(null);
  const [expandedOrderId, setExpandedOrderId] = useState(null);
  const [selectedPreviewOrderId, setSelectedPreviewOrderId] = useState(null);
  const [cancelModalOrder, setCancelModalOrder] = useState(null);
  const [failModalOrder, setFailModalOrder] = useState(null);
  const [viewPilotId, setViewPilotId] = useState(null);

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    try {
      await syncExternalOrders();
    } finally {
      setTimeout(() => setIsRefreshing(false), 1000);
    }
  };

  // تصفية الطلبات المعروضة بصندوق الوارد حسب صلاحية المستخدم
  const rawInboxOrders = useMemo(() => {
    return orders.filter(o => {
      if (userRole === 'admin' || userRole === 'casher') {
        return ['pending', 'pending_timer', 'preparing', 'waiting_driver', 'ready', 'driver_assigned', 'out_for_delivery', 'active'].includes(o.status);
      } else {
        return ['driver_assigned', 'out_for_delivery', 'active'].includes(o.status);
      }
    });
  }, [orders, userRole]);

  // إحصائيات الفلاتر اللحظية
  const stageCounts = useMemo(() => {
    const pendingCount = rawInboxOrders.filter(o => ['pending', 'pending_timer'].includes(o.status)).length;
    const preparingCount = rawInboxOrders.filter(o => ['preparing', 'waiting_driver'].includes(o.status)).length;
    const readyPickupCount = rawInboxOrders.filter(o => o.status === 'ready').length;
    const assignedCount = rawInboxOrders.filter(o => ['driver_assigned', 'out_for_delivery', 'active'].includes(o.status)).length;
    const delayedCount = rawInboxOrders.filter(o => getElapsedMinutes(o.timestamp) >= 30).length;
    return {
      all: rawInboxOrders.length,
      pending: pendingCount,
      preparing: preparingCount,
      ready: readyPickupCount,
      driver_assigned: assignedCount,
      delayed: delayedCount
    };
  }, [rawInboxOrders]);

  // تطبيق الفلاتر والبحث
  const filteredOrders = useMemo(() => {
    return rawInboxOrders.filter(o => {
      // 1. Status tab filter
      if (statusTab === 'pending') {
        if (!['pending', 'pending_timer'].includes(o.status)) return false;
      } else if (statusTab === 'preparing' || statusTab === 'waiting_driver') {
        if (!['preparing', 'waiting_driver'].includes(o.status)) return false;
      } else if (statusTab === 'ready') {
        if (o.status !== 'ready') return false;
      } else if (statusTab === 'driver_assigned') {
        if (!['driver_assigned', 'out_for_delivery', 'active'].includes(o.status)) return false;
      } else if (statusTab === 'delayed') {
        if (getElapsedMinutes(o.timestamp) < 30) return false;
      }

      // 2. Source filter
      if (sourceFilter !== 'all') {
        const orderSrc = (o.source || o.type || 'manual').toLowerCase();
        if (sourceFilter === 'online' && o.source !== 'online') return false;
        if (sourceFilter === 'restaurant' && o.type !== 'restaurant' && o.source === 'online') return false;
        if (sourceFilter === 'talabat' && o.type !== 'talabat' && !orderSrc.includes('talabat')) return false;
        if (sourceFilter === 'trip' && o.type !== 'trip') return false;
      }

      // 3. Search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const orderIdStr = String(o.originalId || o.id || '').toLowerCase();
        const customerName = String(o.customerName || '').toLowerCase();
        const phone = String(o.phone || '').toLowerCase();
        const phone2 = String(o.phone2 || '').toLowerCase();
        const area = String(o.area || '').toLowerCase();

        const match = orderIdStr.includes(q) ||
          customerName.includes(q) ||
          phone.includes(q) ||
          phone2.includes(q) ||
          area.includes(q);

        if (!match) return false;
      }

      return true;
    });
  }, [rawInboxOrders, statusTab, sourceFilter, searchQuery]);

  const previewOrder = filteredOrders.find(o => o.id === selectedPreviewOrderId) || filteredOrders[0];

  // Active trips for pilot assignment section
  const activeOrders = useMemo(() => orders.filter(o => o.status === 'active' || o.status === 'out_for_delivery'), [orders]);
  const ordersByPilot = useMemo(() => {
    return activeOrders.reduce((acc, o) => {
      const key = String(o.pilotId || o.deliveryId);
      if (!acc[key]) acc[key] = [];
      acc[key].push(o);
      return acc;
    }, {});
  }, [activeOrders]);

  const pilotsWithOrders = useMemo(() => {
    return pilots.filter(p => ordersByPilot[String(p.id)]);
  }, [pilots, ordersByPilot]);

  useEffect(() => {
    if (pilotsWithOrders.length === 0) {
      setViewPilotId(null);
    } else if (!viewPilotId || !pilotsWithOrders.some(p => String(p.id) === String(viewPilotId))) {
      setViewPilotId(pilotsWithOrders[0].id);
    }
  }, [pilotsWithOrders, viewPilotId]);

  const availablePilots = useMemo(() => pilots.filter(p => p.shiftStatus === 'open'), [pilots]);

  // Handle local countdown for grace period — optimized to only run when pending_timer orders exist
  useEffect(() => {
    const hasPendingTimer = rawInboxOrders.some(o => o.status === 'pending_timer');
    if (!hasPendingTimer) {
      setAuditTimers({});
      return;
    }

    const interval = setInterval(() => {
      const now = Date.now();
      const newTimers = {};
      let anyActive = false;
      rawInboxOrders.forEach(order => {
        if (order.status === 'pending_timer' && order.timestamp) {
          const diff = Math.max(0, 5 - Math.floor((now - new Date(order.timestamp).getTime()) / 1000));
          newTimers[order.id] = diff;
          if (diff > 0) anyActive = true;
        }
      });
      setAuditTimers(newTimers);
      if (!anyActive) clearInterval(interval);
    }, 500);

    return () => clearInterval(interval);
  }, [rawInboxOrders]);

  const handlePrint = (order, pilotName = null) => {
    let pName = pilotName;
    if (!pName && order.pilotId) {
      pName = pilots.find(p => String(p.id) === String(order.pilotId))?.name || null;
    }
    printerService.printKitchenReceipt(order, true, pName);
  };

  const handleAssignAndPrint = (orderId, explicitPilotId = null) => {
    let pilotId = explicitPilotId || selectedPilot[orderId];

    if (!pilotId) {
      const suggested = getSuggestedPilot();
      if (suggested) pilotId = suggested.id;
    }

    if (!pilotId) {
      alert('⚠️ يرجى اختيار طيار أولاً');
      return;
    }

    const selectedPilotObj = pilots.find(p => String(p.id) === String(pilotId));
    if (selectedPilotObj && isPilotOnDelivery(selectedPilotObj.state)) {
      alert('⚠️ هذا الطيار في رحلة توصيل حالياً ولا يمكن إسناد طلب جديد له 🚫');
      return;
    }

    assignPilot(orderId, pilotId);

    const pilotName = pilots.find(p => String(p.id) === String(pilotId))?.name || 'Unknown';
    const order = orders.find(o => o.id === orderId);
    if (order) handlePrint({ ...order, pilotId }, pilotName);
  };

  if (!isShiftOpen) {
    return (
      <div className="glass-card" style={{ padding: '60px 24px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', maxWidth: '600px', margin: '40px auto' }}>
        <AlertCircle size={52} color="var(--warning)" />
        <h2 style={{ fontSize: '1.5rem', fontWeight: '800', margin: 0 }}>الوردية مغلقة حالياً</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', margin: 0 }}>
          يجب فتح الوردية أولاً من القائمة الجانبية أو الصفحة الرئيسية لاستقبال وإدارة طلبات التوصيل.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* 🚀 Header & Operational Stats Bar */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h2 style={{ fontSize: '1.75rem', fontWeight: '900', margin: '0 0 6px 0', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span>صندوق الوارد والتشغيل</span>
            {stageCounts.pending > 0 && (
              <span className="pulse-new" style={{ fontSize: '0.8rem', background: '#f59e0b', color: '#000', padding: '3px 10px', borderRadius: '12px', fontWeight: '900' }}>
                {stageCounts.pending} طلب جديد!
              </span>
            )}
          </h2>
          <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: '0.9rem' }}>
            متابعة مراحل الطلبات، الإسناد الذكي للطيارين، وإدارة رحلات التوصيل اللحظية
          </p>
        </div>

        <button
          onClick={handleManualRefresh}
          disabled={isRefreshing}
          className="btn-primary"
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-strong)',
            color: 'var(--text-main)',
            gap: '8px',
            padding: '10px 18px',
            fontSize: '0.9rem'
          }}
          title="تحديث البيانات من الخادم"
        >
          <RefreshCw size={16} className={isRefreshing ? 'pulse-dot' : ''} />
          <span>{isRefreshing ? 'جاري التحديث...' : 'تحديث البيانات'}</span>
        </button>
      </header>

      {/* 🧭 Stage Tabs & Search Toolbar */}
      <div className="glass-card" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {/* Stage Status Tabs */}
        <div className="tab-strip" style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border)', paddingBottom: '14px', overflowX: 'auto' }}>
          {[
            { id: 'all', label: 'جميع المراحل', count: stageCounts.all, color: '#6366f1' },
            { id: 'pending', label: 'طلبات جديدة', count: stageCounts.pending, color: '#f59e0b', highlight: stageCounts.pending > 0 },
            { id: 'preparing', label: 'بالمطبخ / قيد التحضير', count: stageCounts.preparing, color: '#10b981' },
            { id: 'ready', label: 'جاهز للاستلام 🛍️', count: stageCounts.ready, color: '#8b5cf6', highlight: stageCounts.ready > 0 },
            { id: 'driver_assigned', label: 'مع الطيار / بالتوصيل 🛵', count: stageCounts.driver_assigned, color: '#3b82f6' },
            { id: 'delayed', label: 'طلبات متأخرة', count: stageCounts.delayed, color: '#ef4444', highlight: stageCounts.delayed > 0 },
          ].map(tab => {
            const isActive = statusTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setStatusTab(tab.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 16px',
                  borderRadius: '12px',
                  border: `1px solid ${isActive ? tab.color : 'rgba(255,255,255,0.08)'}`,
                  background: isActive ? `${tab.color}25` : 'rgba(255,255,255,0.02)',
                  color: isActive ? '#fff' : 'var(--text-muted)',
                  fontWeight: isActive ? '800' : '600',
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  minHeight: '44px'
                }}
              >
                <span>{tab.label}</span>
                <span style={{
                  padding: '2px 8px',
                  borderRadius: '10px',
                  fontSize: '0.75rem',
                  fontWeight: '900',
                  background: isActive ? tab.color : 'rgba(255,255,255,0.1)',
                  color: isActive ? '#fff' : 'var(--text-main)',
                  boxShadow: tab.highlight && !isActive ? `0 0 10px ${tab.color}80` : 'none'
                }}>
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Search & Source Filter Bar */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', justifyContent: 'space-between' }}>
          {/* Search Box */}
          <div style={{ position: 'relative', flex: '1 1 280px', maxWidth: '420px' }}>
            <Search size={18} style={{ position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' }} />
            <input
              type="text"
              placeholder="ابحث برقم البون، اسم العميل، الهاتف، أو المنطقة..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 42px 10px 14px',
                background: 'rgba(0, 0, 0, 0.35)',
                border: '1px solid var(--border)',
                borderRadius: '10px',
                color: 'white',
                fontSize: '0.9rem',
                minHeight: '44px'
              }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                style={{
                  position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: '4px'
                }}
              >
                <X size={16} />
              </button>
            )}
          </div>

          {/* Source Filter Pills */}
          <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', padding: '2px' }}>
            {[
              { id: 'all', label: 'الكل' },
              { id: 'online', label: '🌐 أونلاين' },
              { id: 'restaurant', label: '🍽️ المطبخ' },
              { id: 'talabat', label: '🛵 طلبات' },
              { id: 'trip', label: '📦 مشاوير' }
            ].map(src => (
              <button
                key={src.id}
                onClick={() => setSourceFilter(src.id)}
                style={{
                  padding: '6px 12px',
                  borderRadius: '8px',
                  fontSize: '0.8rem',
                  fontWeight: sourceFilter === src.id ? '800' : '600',
                  background: sourceFilter === src.id ? 'rgba(255, 255, 255, 0.15)' : 'transparent',
                  color: sourceFilter === src.id ? '#fff' : 'var(--text-muted)',
                  border: '1px solid var(--border)',
                  cursor: 'pointer',
                  minHeight: '36px'
                }}
              >
                {src.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 📦 Order Cards List & Thermal Preview Grid */}
      {filteredOrders.length === 0 ? (
        <div className="glass-card" style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
          <ShoppingCart size={48} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
          <h3 style={{ fontSize: '1.2rem', margin: '0 0 6px 0', color: 'var(--text-main)' }}>لا توجد طلبات تطابق الفلتر المحدد</h3>
          <p style={{ fontSize: '0.85rem', margin: 0 }}>جرّب تغيير حالة الفلتر أو إلغاء كلمة البحث</p>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: (isThermalPrintMode && previewOrder) ? '1fr 340px' : '1fr',
          gap: '20px',
          alignItems: 'start'
        }}>
          {/* Main Orders Column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <AnimatePresence mode="popLayout">
              {filteredOrders.map(order => {
                const isInGracePeriod = order.status === 'pending_timer';
                const timeLeft = auditTimers[order.id] || 0;
                const suggestedPilot = (order.status === 'waiting_driver' || order.status === 'pending') ? getSuggestedPilot() : null;
                const isOnline = order.source === 'online';
                const paymentScreenshot = getOrderPaymentScreenshot(order);
                const receiptUploadStatus = order.receiptUploadStatus;

                // Coordinates and zone
                const lat = order.lat || order.latitude || order.rawPayload?.customer?.delivery_info?.coordinates?.lat || null;
                const lng = order.lng || order.longitude || order.rawPayload?.customer?.delivery_info?.coordinates?.lon || null;
                const dist = calculateDistance(RESTAURANT_COORDS.lat, RESTAURANT_COORDS.lng, lat, lng);
                const zoneCfg = getZone(dist);

                // Status border & background styling
                let statusColor = '#6366f1';
                let statusLabel = 'قيد المعالجة';
                let statusBg = 'rgba(99, 102, 241, 0.04)';

                if (order.status === 'pending' || order.status === 'pending_timer') {
                  statusColor = '#f59e0b';
                  statusLabel = 'طلب جديد (يحتاج قبول)';
                  statusBg = 'rgba(245, 158, 11, 0.05)';
                } else if (order.status === 'waiting_driver' || order.status === 'preparing') {
                  statusColor = '#10b981';
                  statusLabel = order.type === 'pickup' ? 'قيد التحضير بالمطبخ 🍳' : 'بالمطبخ / بانتظار طيار 🛵';
                  statusBg = 'rgba(16, 185, 129, 0.05)';
                } else if (order.status === 'ready') {
                  statusColor = '#8b5cf6';
                  statusLabel = 'جاهز للاستلام بالفرع 🛍️';
                  statusBg = 'rgba(139, 92, 246, 0.06)';
                } else if (order.status === 'driver_assigned') {
                  statusColor = '#3b82f6';
                  statusLabel = 'مسند للطيار 🛵';
                  statusBg = 'rgba(59, 130, 246, 0.05)';
                } else if (order.status === 'active' || order.status === 'out_for_delivery') {
                  statusColor = '#22c55e';
                  statusLabel = 'في الطريق للتسليم 🚚';
                  statusBg = 'rgba(34, 197, 94, 0.06)';
                } else if (order.status === 'delivered' || order.status === 'completed') {
                  statusColor = '#22c55e';
                  statusLabel = order.type === 'pickup' ? 'تم الاستلام بالفرع ✅' : 'تم التوصيل ✅';
                  statusBg = 'rgba(34, 197, 94, 0.04)';
                }

                // Pilot badge for driver assigned state
                const pilotIdForBadge = order.pilotId || order.deliveryId;
                const orderPilot = pilotIdForBadge ? pilots.find(p => String(p.id) === String(pilotIdForBadge)) : null;
                const showPilotOutBadge = order.status === 'driver_assigned' && isPilotOnDelivery(orderPilot?.state);
                const isSelectedPreview = isThermalPrintMode && previewOrder && previewOrder.id === order.id;

                // Payment Method badge
                const paymentMethod = String(order.paymentMethod || order.rawPayload?.customer?.payment_method || 'Cash').toLowerCase();
                const isCash = paymentMethod.includes('cash') || paymentMethod === 'cash';
                const isInsta = paymentMethod.includes('insta') || paymentMethod === 'online';
                const isVF = paymentMethod.includes('vodafone') || paymentMethod.includes('wallet') || paymentMethod.includes('فودافون');

                return (
                  <motion.div
                    key={order.id}
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.96 }}
                    transition={{ duration: 0.2 }}
                    onClick={() => isThermalPrintMode && setSelectedPreviewOrderId(order.id)}
                    className={`glass-card order-card ${order.status === 'pending' ? 'pulse-new' : ''}`}
                    style={{
                      padding: '20px',
                      borderRight: `6px solid ${statusColor}`,
                      background: statusBg,
                      border: isSelectedPreview ? '2px solid var(--accent)' : undefined,
                      cursor: isThermalPrintMode ? 'pointer' : 'default',
                      display: 'flex',
                      flexDirection: 'column',
                    }}
                  >
                    {/* 🔝 المستوى الأول: ما الذي يحدث الآن؟ (رقم الطلب، الوقت، الحالة، المبلغ، العميل، والمنطقة) */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '1.35rem', fontWeight: '900', color: 'var(--text-main)', letterSpacing: '0.5px' }}>
                            #{order.originalId || order.id}
                          </span>
                          {order.type === 'pickup' && (
                            <span style={{ fontSize: '0.72rem', background: '#ec4899', color: 'white', padding: '2px 7px', borderRadius: '4px', fontWeight: 'bold' }}>🛍️ استلام (Pickup)</span>
                          )}
                          {order.type === 'talabat' && (
                            <span style={{ fontSize: '0.72rem', background: '#f97316', color: 'white', padding: '2px 7px', borderRadius: '4px', fontWeight: 'bold' }}>طلبات</span>
                          )}
                          {order.type === 'trip' && (
                            <span style={{ fontSize: '0.72rem', background: '#8b5cf6', color: 'white', padding: '2px 7px', borderRadius: '4px', fontWeight: 'bold' }}>مشوار</span>
                          )}
                          {isOnline && (
                            <span style={{ fontSize: '0.72rem', background: 'rgba(99, 102, 241, 0.2)', color: '#818cf8', padding: '2px 7px', borderRadius: '4px', border: '1px solid rgba(99, 102, 241, 0.3)', fontWeight: 'bold' }}>أونلاين</span>
                          )}

                          {/* Live Elapsed Timer */}
                          <LiveElapsedBadge
                            timestamp={order.timestamp || order.created_at}
                            startTime={order.startTime}
                            isOut={order.status === 'active'}
                          />

                          {/* Order Status Badge */}
                          <div style={{
                            padding: '3px 10px',
                            borderRadius: '20px',
                            fontSize: '0.78rem',
                            fontWeight: '800',
                            background: `${statusColor}20`,
                            color: statusColor,
                            border: `1px solid ${statusColor}40`
                          }}>
                            {statusLabel}
                          </div>
                        </div>

                        {/* Financial Total Highlight */}
                        <div style={{ textAlign: 'left', marginRight: 'auto' }}>
                          <div style={{ fontSize: '1.3rem', fontWeight: '900', color: 'var(--accent)' }}>
                            {order.total || 0} <span style={{ fontSize: '0.85rem' }}>ج.م</span>
                          </div>
                          {Number(order.remainingAmount) > 0 && (
                            <div style={{ fontSize: '0.75rem', color: '#ef4444', fontWeight: 'bold' }}>
                              متبقي: {order.remainingAmount} ج.م
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Quick Operational Info: Customer Name + Area + Assigned Pilot */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', fontSize: '0.9rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                          <strong style={{ color: 'var(--text-main)', fontSize: '1.02rem' }}>{order.customerName || 'عميل بدون اسم'}</strong>
                          <span style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <MapPin size={14} color="var(--primary)" />
                            {order.area || 'استلام من المطعم'}
                          </span>
                        </div>

                        {(order.status === 'driver_assigned' || order.status === 'out_for_delivery' || order.status === 'active') && (
                          <div style={{
                            display: 'inline-flex', alignItems: 'center', gap: '6px',
                            padding: '4px 10px', borderRadius: '8px',
                            background: (order.status === 'out_for_delivery' || order.status === 'active') ? 'rgba(34, 197, 94, 0.12)' : 'rgba(59, 130, 246, 0.12)',
                            border: `1px solid ${(order.status === 'out_for_delivery' || order.status === 'active') ? 'rgba(34, 197, 94, 0.3)' : 'rgba(59, 130, 246, 0.3)'}`,
                            fontSize: '0.82rem',
                            color: (order.status === 'out_for_delivery' || order.status === 'active') ? '#86efac' : '#93c5fd',
                            fontWeight: 'bold'
                          }}>
                            <Bike size={14} />
                            <span>الطيار: {orderPilot?.name || order.pilotName || 'طيار'}</span>
                            {(order.status === 'out_for_delivery' || order.status === 'active') ? (
                              <span style={{ color: '#22c55e', fontSize: '0.75rem', fontWeight: '800' }}>(في الطريق 🚚)</span>
                            ) : (
                              showPilotOutBadge && <span style={{ color: '#fbbf24', fontSize: '0.75rem' }}>(في الخارج)</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* ⚡ المستوى الثاني: ما الإجراء الذي يجب عليّ اتخاذه الآن؟ (إجراءات المرحلة الحالية بأول حقل) */}
                    <div style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '10px',
                      background: 'rgba(255, 255, 255, 0.02)',
                      padding: '12px',
                      borderRadius: '10px',
                      border: '1px solid var(--border)'
                    }}>
                      {/* Stage 1: Pending -> Confirm / Accept */}
                      {(order.status === 'pending' || order.status === 'pending_timer') && (userRole === 'admin' || userRole === 'casher') && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', width: '100%' }}>
                          <button
                            onClick={() => {
                              confirmOrder(order.id);
                              toast(`تم تأكيد الطلب #${order.originalId || order.id} وإرساله للمطبخ ✅`);
                            }}
                            className="btn-primary"
                            style={{
                              flex: '2 1 200px',
                              background: '#10b981',
                              boxShadow: '0 4px 14px rgba(16, 185, 129, 0.35)'
                            }}
                          >
                            <Check size={18} />
                            <span>تأكيد وقبول الطلب للمطبخ</span>
                          </button>

                          {isInGracePeriod && (
                            <button
                              onClick={() => onReedit(order)}
                              style={{
                                flex: '1 1 120px',
                                background: '#f59e0b',
                                color: '#000',
                                border: 'none',
                                borderRadius: '10px',
                                fontWeight: '800',
                                fontSize: '0.85rem',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '6px',
                                minHeight: '44px',
                                cursor: 'pointer'
                              }}
                              title="تعديل تفاصيل الطلب خلال مهلة المراجعة"
                            >
                              <RotateCcw size={16} />
                              <span>تعديل ({timeLeft}ث)</span>
                            </button>
                          )}

                          <button
                            onClick={() => setCancelModalOrder(order)}
                            className="btn-danger-outline"
                            style={{ minWidth: '44px' }}
                            title="إلغاء الطلب"
                          >
                            <X size={18} />
                            <span style={{ fontSize: '0.85rem' }}>إلغاء</span>
                          </button>
                        </div>
                      )}

                      {/* Stage 2: Preparing / Kitchen */}
                      {(order.status === 'waiting_driver' || order.status === 'preparing') && (userRole === 'admin' || userRole === 'casher') && (
                        order.type === 'pickup' ? (
                          /* Pickup Action: Mark Ready for Customer Pickup (NO PILOT) */
                          <div style={{ display: 'flex', gap: '10px', width: '100%', flexWrap: 'wrap' }}>
                            <button
                              onClick={() => {
                                readyOrder(order.id);
                                toast(`الطلب #${order.originalId || order.id} جاهز لاستلام العميل بالفرع 🛍️`);
                              }}
                              className="btn-primary"
                              style={{
                                flex: '2 1 200px',
                                background: '#8b5cf6',
                                boxShadow: '0 4px 14px rgba(139, 92, 246, 0.35)'
                              }}
                            >
                              <Package size={18} />
                              <span>جاهز للاستلام بالفرع 🛍️</span>
                            </button>

                            <button
                              onClick={() => handlePrint(order)}
                              className="btn-primary"
                              style={{
                                background: 'var(--bg-surface)',
                                border: '1px solid var(--border-strong)',
                                color: 'var(--text-main)',
                                flex: '1 1 120px'
                              }}
                              title="طباعة بون المطبخ"
                            >
                              <Printer size={16} />
                              <span>طباعة بون</span>
                            </button>

                            <button
                              onClick={() => setCancelModalOrder(order)}
                              className="btn-danger-outline"
                              style={{ minWidth: '44px' }}
                              title="إلغاء الطلب"
                            >
                              <X size={18} />
                            </button>
                          </div>
                        ) : (
                          /* Delivery Action: Pilot Assignment UI */
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '100%' }}>
                            {suggestedPilot && (
                              <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                background: 'rgba(16, 185, 129, 0.1)',
                                border: '1px solid rgba(16, 185, 129, 0.3)',
                                padding: '8px 12px',
                                borderRadius: '10px',
                                flexWrap: 'wrap',
                                gap: '8px'
                              }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem' }}>
                                  <Sparkles size={16} color="#34d399" />
                                  <span>الطيار المقترح بالدور: <strong style={{ color: '#34d399' }}>{suggestedPilot.name}</strong></span>
                                </div>
                                <button
                                  onClick={() => handleAssignAndPrint(order.id, suggestedPilot.id)}
                                  className="btn-primary"
                                  style={{
                                    background: '#10b981',
                                    padding: '6px 14px',
                                    minHeight: '38px',
                                    fontSize: '0.85rem'
                                  }}
                                >
                                  <UserPlus size={15} />
                                  <span>إسناد مباشر وطباعة</span>
                                </button>
                              </div>
                            )}

                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                              <select
                                className="glass-card"
                                style={{
                                  flex: '1 1 200px',
                                  padding: '10px 14px',
                                  background: '#172033',
                                  color: 'white',
                                  border: '1px solid var(--border)',
                                  borderRadius: '10px',
                                  fontSize: '0.9rem',
                                  minHeight: '44px'
                                }}
                                onChange={(e) => setSelectedPilot({ ...selectedPilot, [order.id]: e.target.value })}
                                value={selectedPilot[order.id] || suggestedPilot?.id || ''}
                              >
                                <option value="">-- اختر طيار يدوي --</option>
                                {availablePilots.map(p => (
                                  <option key={p.id} value={p.id} disabled={isPilotOnDelivery(p.state)}>
                                    {p.name} {isPilotOnDelivery(p.state) ? '(في توصيل 🚫)' : '(متاح 🟢)'} - {p.ordersCount || 0} طلبات
                                  </option>
                                ))}
                              </select>

                              <button
                                onClick={() => handleAssignAndPrint(order.id)}
                                disabled={!selectedPilot[order.id] && !suggestedPilot}
                                className="btn-primary"
                                style={{
                                  background: 'var(--primary)',
                                  minHeight: '44px',
                                  padding: '10px 18px'
                                }}
                                title="إسناد للطيار المختار وطباعة البون"
                              >
                                <UserPlus size={18} />
                                <span>إسناد وطباعة</span>
                              </button>

                              <button
                                onClick={() => setCancelModalOrder(order)}
                                className="btn-danger-outline"
                                style={{ minWidth: '44px' }}
                                title="إلغاء الطلب"
                              >
                                <X size={18} />
                              </button>
                            </div>
                          </div>
                        )
                      )}

                      {/* Stage 2.5: Ready for Pickup (Pickup Orders Only) */}
                      {order.status === 'ready' && (userRole === 'admin' || userRole === 'casher') && (
                        <div style={{ display: 'flex', gap: '10px', width: '100%', flexWrap: 'wrap' }}>
                          <button
                            onClick={() => {
                              completeOrder(order.id);
                              toast(`تم تسليم الطلب #${order.originalId || order.id} للعميل بنجاح ✅`);
                            }}
                            className="btn-primary"
                            style={{
                              flex: '2 1 200px',
                              background: '#22c55e',
                              boxShadow: '0 4px 14px rgba(34, 197, 94, 0.35)'
                            }}
                          >
                            <Check size={18} />
                            <span>تم تسليم العميل (استلام بالفرع) ✅</span>
                          </button>

                          <button
                            onClick={() => handlePrint(order)}
                            className="btn-primary"
                            style={{
                              background: 'var(--bg-surface)',
                              border: '1px solid var(--border-strong)',
                              color: 'var(--text-main)',
                              flex: '1 1 120px'
                            }}
                            title="طباعة بون"
                          >
                            <Printer size={16} />
                            <span>طباعة بون</span>
                          </button>

                          <button
                            onClick={() => setCancelModalOrder(order)}
                            className="btn-danger-outline"
                            style={{ minWidth: '44px' }}
                            title="إلغاء الطلب"
                          >
                            <X size={18} />
                          </button>
                        </div>
                      )}

                      {/* Stage 3: Driver Assigned -> Start Trip (Delivery Only) */}
                      {order.status === 'driver_assigned' && (
                        <div style={{ display: 'flex', gap: '10px', width: '100%', flexWrap: 'wrap' }}>
                          <button
                            onClick={() => startDelivery(order.id)}
                            className="btn-primary"
                            style={{
                              flex: '2 1 200px',
                              background: '#22c55e',
                              boxShadow: '0 4px 14px rgba(34, 197, 94, 0.35)'
                            }}
                          >
                            <Bike size={18} />
                            <span>بدء رحلة التوصيل الآن</span>
                          </button>

                          <button
                            onClick={() => handlePrint(order)}
                            className="btn-primary"
                            style={{
                              background: 'var(--bg-surface)',
                              border: '1px solid var(--border-strong)',
                              color: 'var(--text-main)',
                              flex: '1 1 120px'
                            }}
                            title="طباعة نسخة إضافية من البون"
                          >
                            <Printer size={16} />
                            <span>طباعة بون</span>
                          </button>
                        </div>
                      )}

                      {/* Stage 4: Out for Delivery / Active -> Complete / Fail (Delivery Only) */}
                      {(order.status === 'active' || order.status === 'out_for_delivery') && (
                        <div style={{ display: 'flex', gap: '10px', width: '100%', flexWrap: 'wrap' }}>
                          <button
                            onClick={() => completeOrder(order.id)}
                            className="btn-primary"
                            style={{
                              flex: '2 1 180px',
                              background: '#22c55e',
                              boxShadow: '0 4px 14px rgba(34, 197, 94, 0.35)'
                            }}
                          >
                            <Check size={18} />
                            <span>تم التسليم بنجاح</span>
                          </button>

                          <button
                            onClick={() => setFailModalOrder(order)}
                            className="btn-danger-outline"
                            style={{ flex: '1 1 120px' }}
                          >
                            <X size={18} />
                            <span>تعذر التوصيل</span>
                          </button>
                        </div>
                      )}
                    </div>

                    {/* 🔍 المستوى الثالث: ما الذي أحتاج معرفته عند الفحص؟ (إفصاح تدريجي عند النقر فقط) */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {/* تفاصيل العميل، الهاتف، العنوان والدفع */}
                      <Disclosure
                        title="بيانات العميل، العنوان والدفع"
                        meta={zoneCfg ? `${zoneCfg.label}` : (order.phone || '')}
                      >
                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                          gap: '14px',
                          fontSize: '0.85rem'
                        }}>
                          {/* Phones with tap to call & tap to copy */}
                          <div>
                            <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '6px' }}>أرقام الهاتف:</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                              {order.phone ? (
                                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                  <a
                                    href={`tel:${order.phone}`}
                                    style={{
                                      display: 'inline-flex', alignItems: 'center', gap: '4px',
                                      background: 'rgba(59, 130, 246, 0.12)', color: '#60a5fa',
                                      padding: '4px 10px', borderRadius: '8px', textDecoration: 'none', fontWeight: 'bold'
                                    }}
                                  >
                                    <Phone size={13} /> {order.phone}
                                  </a>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      navigator.clipboard.writeText(order.phone);
                                      toast('تم نسخ رقم الهاتف بنجاح 📋');
                                    }}
                                    style={{ background: 'rgba(255,255,255,0.06)', border: 'none', padding: '4px 8px', borderRadius: '6px', color: 'var(--text-dim)', cursor: 'pointer', fontSize: '0.75rem' }}
                                    title="نسخ الرقم"
                                  >
                                    نسخ
                                  </button>
                                </div>
                              ) : (
                                <span style={{ color: 'var(--text-dim)' }}>لا يوجد هاتف مسجل</span>
                              )}

                              {order.phone2 && (
                                <a
                                  href={`tel:${order.phone2}`}
                                  style={{
                                    display: 'inline-flex', alignItems: 'center', gap: '4px',
                                    background: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-muted)',
                                    padding: '4px 10px', borderRadius: '8px', textDecoration: 'none'
                                  }}
                                >
                                  <Phone size={13} /> {order.phone2}
                                </a>
                              )}
                            </div>
                          </div>

                          {/* Full address & coordinates */}
                          <div>
                            <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '6px' }}>العنوان التفصيلي:</div>
                            <p style={{ margin: '0 0 6px 0', color: 'var(--text-main)', lineHeight: '1.4' }}>
                              {order.area || 'استلام من المطعم'}
                            </p>
                            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                              {zoneCfg && (
                                <span style={{ fontSize: '0.75rem', background: zoneCfg.bg, color: zoneCfg.color, padding: '2px 8px', borderRadius: '6px', fontWeight: 'bold', border: `1px solid ${zoneCfg.color}40` }}>
                                  {zoneCfg.label} ({dist} كم)
                                </span>
                              )}
                              {lat && lng && (
                                <button
                                  onClick={() => window.open(`https://www.google.com/maps?q=${lat},${lng}`, '_blank')}
                                  style={{
                                    display: 'inline-flex', alignItems: 'center', gap: '4px',
                                    padding: '3px 8px', borderRadius: '6px',
                                    background: 'rgba(245, 158, 11, 0.15)', color: '#fbbf24',
                                    border: '1px solid rgba(245, 158, 11, 0.3)', fontSize: '0.75rem',
                                    cursor: 'pointer'
                                  }}
                                >
                                  📍 الخريطة
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Payment details & Screenshot thumbnail */}
                          <div>
                            <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '6px' }}>طريقة الدفع والإيصال:</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                              <div style={{
                                display: 'inline-flex', alignItems: 'center', gap: '6px',
                                padding: '4px 10px', borderRadius: '8px', fontSize: '0.8rem', fontWeight: '700',
                                background: isCash ? 'rgba(16, 185, 129, 0.12)' : isInsta ? 'rgba(59, 130, 246, 0.12)' : isVF ? 'rgba(239, 68, 68, 0.12)' : 'rgba(255,255,255,0.05)',
                                color: isCash ? '#34d399' : isInsta ? '#60a5fa' : isVF ? '#f87171' : 'var(--text-muted)',
                                border: '1px solid var(--border)'
                              }}>
                                {isCash ? '💵 نقدي (Cash)' : isInsta ? '⚡ أنستاباي (InstaPay)' : isVF ? '📱 فودافون كاش' : `💳 ${order.paymentMethod || 'أخرى'}`}
                              </div>

                              {paymentScreenshot && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <ReceiptThumbnail
                                    src={paymentScreenshot}
                                    size={40}
                                    borderRadius={8}
                                    border="2px solid var(--border-strong)"
                                    onOpen={(url) => setPreviewImage(url)}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => setPreviewImage(paymentScreenshot)}
                                    style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px' }}
                                    title="تكبير الإيصال"
                                  >
                                    <Eye size={16} />
                                  </button>
                                </div>
                              )}

                              {receiptUploadStatus === 'uploading' && (
                                <span style={{ fontSize: '0.75rem', color: 'var(--accent)' }}>⏳ جاري رفع الإيصال...</span>
                              )}
                              {receiptUploadStatus === 'failed' && (
                                <button
                                  onClick={() => retryReceiptUpload(order.id)}
                                  style={{
                                    padding: '4px 8px', borderRadius: '6px', fontSize: '0.75rem',
                                    background: 'rgba(239, 68, 68, 0.15)', color: 'var(--danger)',
                                    border: '1px solid var(--danger)', cursor: 'pointer'
                                  }}
                                >
                                  🔄 إعادة رفع الإيصال
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </Disclosure>

                      {/* تفاصيل الأصناف (إذا كانت مسجلة) */}
                      {order.items && order.items.length > 0 ? (
                        <Disclosure
                          title={`تفاصيل الأصناف (${order.items.length} صنف)`}
                          meta={`${order.total} ج.م`}
                          icon={<ShoppingCart size={15} color="var(--primary)" />}
                        >
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' }}>
                            {order.items.map((item, idx) => {
                              const details = parseItemCommercialDetails(item);
                              const itemCount = Number(item.count || item.quantity || 1);
                              const itemPrice = Number(item.price || item.unit_price || 0);
                              const lineTotal = itemCount * itemPrice;

                              return (
                                <div
                                  key={idx}
                                  style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'flex-start',
                                    background: 'rgba(255, 255, 255, 0.03)',
                                    padding: '8px 12px',
                                    borderRadius: '8px',
                                    fontSize: '0.9rem',
                                    border: '1px solid rgba(255, 255, 255, 0.05)'
                                  }}
                                >
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                    {/* 1. Parent Product Name */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                      <span style={{ fontWeight: '800', color: 'var(--text-main)', fontSize: '0.96rem' }}>
                                        {details.productName}
                                      </span>
                                      {details.category && (
                                        <span style={{ fontSize: '0.7rem', background: 'rgba(99, 102, 241, 0.2)', color: '#818cf8', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold' }}>
                                          {details.category}
                                        </span>
                                      )}
                                    </div>

                                    {/* 2. Selected Variant (only if exists) */}
                                    {details.variantName && (
                                      <span style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        fontSize: '0.82rem',
                                        color: '#38bdf8',
                                        fontWeight: '700',
                                        background: 'rgba(56, 189, 248, 0.12)',
                                        padding: '2px 8px',
                                        borderRadius: '4px',
                                        width: 'fit-content'
                                      }}>
                                        🔹 {details.variantName}
                                      </span>
                                    )}

                                    {/* 3. Selected Options / Add-ons (only if exist) */}
                                    {details.optionNames && details.optionNames.length > 0 && (
                                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '2px' }}>
                                        {details.optionNames.map((opt, optIdx) => (
                                          <span
                                            key={optIdx}
                                            style={{
                                              fontSize: '0.78rem',
                                              color: '#fbbf24',
                                              fontWeight: '700',
                                              background: 'rgba(251, 191, 36, 0.12)',
                                              padding: '1px 7px',
                                              borderRadius: '4px'
                                            }}
                                          >
                                            + {opt}
                                          </span>
                                        ))}
                                      </div>
                                    )}

                                    {/* 4. Notes (if any) */}
                                    {details.notes && (
                                      <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontStyle: 'italic', marginTop: '2px' }}>
                                        📝 {details.notes}
                                      </span>
                                    )}
                                  </div>

                                  {/* 5. Quantity and Line Total */}
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '14px', paddingTop: '2px' }}>
                                    <span style={{ color: 'var(--text-muted)', fontWeight: '700', fontSize: '0.88rem' }}>
                                      {itemCount} × {itemPrice} ج
                                    </span>
                                    <span style={{ fontWeight: '900', color: 'var(--accent)', minWidth: '55px', textAlign: 'left', fontSize: '1rem' }}>
                                      {lineTotal} ج
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          <div style={{
                            marginTop: '8px',
                            paddingTop: '8px',
                            borderTop: '1px dashed var(--border)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '4px',
                            alignItems: 'flex-end',
                            fontSize: '0.82rem'
                          }}>
                            <div style={{ color: 'var(--text-muted)' }}>قيمة الأصناف: <strong style={{ color: 'var(--text-main)' }}>{order.subtotal || Math.max(0, (order.total || 0) - (order.deliveryFee || 0))} ج.م</strong></div>
                            <div style={{ color: 'var(--text-muted)' }}>خدمة التوصيل: <strong style={{ color: 'var(--text-main)' }}>{order.deliveryFee || 0} ج.م</strong></div>
                            {Number(order.serviceFee) > 0 && <div style={{ color: 'var(--text-muted)' }}>رسوم الخدمة: <strong style={{ color: 'var(--text-main)' }}>{order.serviceFee} ج.م</strong></div>}
                            <div style={{ color: 'var(--accent)', fontSize: '1rem', fontWeight: '900', marginTop: '2px' }}>الإجمالي الكلي: {order.total} ج.م</div>
                          </div>
                        </Disclosure>
                      ) : order.itemsDescription ? (
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', background: 'rgba(0,0,0,0.2)', padding: '8px 12px', borderRadius: '8px' }}>
                          <strong>تفاصيل الطلب:</strong> {order.itemsDescription}
                        </div>
                      ) : null}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>

          {/* 🖨️ Thermal Print Simulation Side Panel */}
          {isThermalPrintMode && previewOrder && (
            <div className="no-print" style={{ position: 'sticky', top: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="glass-card" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                  <Printer size={18} color="var(--primary)" />
                  <span>معاينة البون الحراري</span>
                </h3>

                <div className="thermal-receipt-simulator">
                  <div className="header">
                    <div className="title">مطعم أبو خاطر</div>
                    <div className="subtitle">إدارة وتوصيل الطلبات</div>
                    <div className="dashed-line"></div>
                    <div className="bold" style={{ fontSize: '15px' }}>فاتورة رقم #{previewOrder.originalId || previewOrder.id}</div>
                    {previewOrder.type === 'pickup' ? (
                      <div style={{ background: '#000', color: '#fff', padding: '3px 6px', textAlign: 'center', fontWeight: '900', fontSize: '11px', margin: '4px 0' }}>
                        🛍️ استلام من الفرع (PICKUP)
                      </div>
                    ) : (
                      <div style={{ border: '1px solid #000', padding: '3px 6px', textAlign: 'center', fontWeight: '900', fontSize: '11px', margin: '4px 0' }}>
                        🚚 طلب توصيل (DELIVERY)
                      </div>
                    )}
                  </div>

                  <div style={{ fontSize: '11px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <div><strong>التاريخ:</strong> {new Date(previewOrder.timestamp || Date.now()).toLocaleString('ar-EG')}</div>
                    <div><strong>العميل:</strong> {previewOrder.customerName || (previewOrder.type === 'pickup' ? 'عميل استلام' : 'عميل')}</div>
                    <div><strong>الهاتف:</strong> {previewOrder.phone || 'غير مسجل'}</div>
                    {previewOrder.type !== 'pickup' && previewOrder.area && <div><strong>العنوان:</strong> {previewOrder.area}</div>}
                    <div><strong>الدفع:</strong> {previewOrder.paymentMethod || 'كاش'}</div>
                    {previewOrder.type !== 'pickup' && previewOrder.pilotId && (
                      <div><strong>الطيار:</strong> {pilots.find(p => String(p.id) === String(previewOrder.pilotId))?.name || 'غير معروف'}</div>
                    )}
                  </div>

                  <div className="solid-line"></div>

                  {previewOrder.items && previewOrder.items.length > 0 ? (
                    <table className="items-table">
                      <thead>
                        <tr>
                          <th style={{ textAlign: 'right' }}>الصنف</th>
                          <th style={{ width: '30px', textAlign: 'center' }}>العدد</th>
                          <th style={{ width: '50px', textAlign: 'left' }}>الإجمالي</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewOrder.items.map((item, idx) => {
                          const d = parseItemCommercialDetails(item);
                          const count = item.count || item.quantity || 1;
                          const price = item.price || item.unit_price || 0;
                          return (
                            <tr key={idx} style={{ borderBottom: '1px solid #eee' }}>
                              <td>
                                <div style={{ fontWeight: 'bold' }}>{d.productName}</div>
                                {d.variantName && <div style={{ fontSize: '10px', color: '#333' }}>- {d.variantName}</div>}
                                {d.optionNames && d.optionNames.length > 0 && (
                                  <div style={{ fontSize: '9px', color: '#555' }}>
                                    + {d.optionNames.join(', ')}
                                  </div>
                                )}
                                {d.notes && <div style={{ fontSize: '9px', fontStyle: 'italic', color: '#666' }}>({d.notes})</div>}
                              </td>
                              <td style={{ textAlign: 'center' }}>{count}</td>
                              <td style={{ textAlign: 'left' }}>{(count * price)} ج</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <div style={{ fontSize: '11px', margin: '8px 0', whiteSpace: 'pre-wrap' }}>
                      <strong>الأصناف:</strong> {previewOrder.itemsDescription || 'لا توجد تفاصيل'}
                    </div>
                  )}

                  <div className="solid-line"></div>

                  <div style={{ fontSize: '11px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>المجموع:</span>
                      <span>{previewOrder.subtotal || Math.max(0, previewOrder.total - (previewOrder.deliveryFee || 0))} ج.م</span>
                    </div>
                    {previewOrder.type !== 'pickup' && previewOrder.deliveryFee > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>التوصيل:</span>
                        <span>{previewOrder.deliveryFee} ج.م</span>
                      </div>
                    )}
                    {previewOrder.serviceFee > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>الخدمة:</span>
                        <span>{previewOrder.serviceFee} ج.م</span>
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: '900', fontSize: '13px', borderTop: '1px solid #000', paddingTop: '4px', marginTop: '2px' }}>
                      <span>الإجمالي النهائي:</span>
                      <span>{previewOrder.total} ج.م</span>
                    </div>
                    {Number(previewOrder.paidNow) > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#10b981', fontWeight: 'bold' }}>
                        <span>المدفوع:</span>
                        <span>{previewOrder.paidNow} ج.م</span>
                      </div>
                    )}
                    {Number(previewOrder.remainingAmount) > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#ef4444', fontWeight: 'bold' }}>
                        <span>المتبقي:</span>
                        <span>{previewOrder.remainingAmount} ج.م</span>
                      </div>
                    )}
                  </div>

                  <div className="dashed-line"></div>
                  <div style={{ textAlign: 'center', fontSize: '10px', color: '#666' }}>
                    نظام إدارة دليفري أبو خاطر
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '4px' }}>
                  <button
                    onClick={() => printerService.printCashierReceipt(previewOrder, true)}
                    className="btn-primary"
                    style={{ background: 'var(--accent)', color: 'white', fontWeight: 'bold', fontSize: '0.85rem', padding: '10px' }}
                  >
                    📄 طباعة العميل
                  </button>
                  <button
                    onClick={() => handlePrint(previewOrder)}
                    className="btn-primary"
                    style={{ background: 'var(--primary)', color: 'white', fontWeight: 'bold', fontSize: '0.85rem', padding: '10px' }}
                  >
                    👨‍🍳 طباعة المطبخ
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 🚚 رحلات الدليفري الحالية (Active Deliveries Section) */}
      {(userRole === 'admin' || userRole === 'casher' || userRole === 'driver') && (
        <div className="glass-card" style={{ borderTop: '4px solid var(--primary)', padding: '0', marginTop: '16px' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
            <h3 style={{ fontSize: '1.15rem', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <MapPin size={20} color="var(--primary)" />
              <span>رحلات الدليفري الحالية في الطريق ({activeOrders.length})</span>
            </h3>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', minHeight: '260px' }}>
            {/* Pilots List Side */}
            <div style={{ width: '100%', maxWidth: '280px', borderLeft: '1px solid var(--border)', padding: '16px' }}>
              <h4 style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '12px' }}>الطيارون في الخارج:</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {pilotsWithOrders.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>لا يوجد طيارين في رحلات توصيل حالياً</p>
                ) : (
                  pilotsWithOrders.map(p => (
                    <button
                      key={p.id}
                      onClick={() => setViewPilotId(p.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 14px',
                        borderRadius: '10px',
                        border: 'none',
                        background: viewPilotId === p.id ? 'var(--primary)' : 'rgba(255,255,255,0.03)',
                        color: viewPilotId === p.id ? 'white' : 'var(--text-main)',
                        textAlign: 'right',
                        fontWeight: '700',
                        minHeight: '44px',
                        cursor: 'pointer'
                      }}
                    >
                      <span>{p.name}</span>
                      <span style={{ fontSize: '0.75rem', background: 'rgba(0,0,0,0.25)', padding: '2px 8px', borderRadius: '6px' }}>
                        {ordersByPilot[p.id]?.length || 0}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* Orders Table Side */}
            <div style={{ flex: 1, minWidth: '300px', padding: '16px', overflowX: 'auto' }}>
              {viewPilotId && ordersByPilot[viewPilotId] ? (
                <>
                  {/* Desktop Table View */}
                  <table className="desktop-trip-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                    <thead>
                      <tr style={{ textAlign: 'right', color: 'var(--text-muted)', borderBottom: '2px solid var(--border)' }}>
                        <th style={{ padding: '10px 8px' }}>بون #</th>
                        <th style={{ padding: '10px 8px' }}>العميل</th>
                        <th style={{ padding: '10px 8px' }}>المنطقة</th>
                        <th style={{ padding: '10px 8px' }}>الوقت بالخارج</th>
                        <th style={{ padding: '10px 8px', textAlign: 'center' }}>إجراء</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ordersByPilot[viewPilotId].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)).map(order => {
                        const elapsed = getElapsedMinutes(order.startTime || order.timestamp);
                        const isDelayed = elapsed >= 40;

                        return (
                          <tr key={order.id} style={{ borderBottom: '1px solid var(--border)', background: isDelayed ? 'rgba(239, 68, 68, 0.06)' : 'transparent' }}>
                            <td style={{ padding: '12px 8px' }}>
                              <span style={{ fontWeight: '800', color: 'var(--primary)' }}>#{order.originalId || order.id}</span>
                              <button onClick={() => onReedit(order)} style={{ background: 'none', border: 'none', padding: '4px', cursor: 'pointer', marginRight: '4px', opacity: 0.6 }} title="تعديل">✏️</button>
                            </td>
                            <td style={{ padding: '12px 8px' }}>
                              <p style={{ fontWeight: 'bold', margin: '0 0 2px 0' }}>{order.customerName}</p>
                              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>{order.total > 0 ? `${order.total} ج.م` : ''}</p>
                            </td>
                            <td style={{ padding: '12px 8px' }}>{order.area}</td>
                            <td style={{ padding: '12px 8px' }}>
                              <LiveElapsedBadge startTime={order.startTime} timestamp={order.timestamp} isOut={true} />
                            </td>
                            <td style={{ padding: '12px 8px' }}>
                              <div style={{ display: 'flex', justifyContent: 'center', gap: '6px' }}>
                                <button
                                  onClick={() => completeOrder(order.id)}
                                  style={{
                                    padding: '6px 14px', background: 'var(--success)', border: 'none',
                                    color: 'white', fontSize: '0.85rem', fontWeight: 'bold', borderRadius: '8px', cursor: 'pointer'
                                  }}
                                >
                                  تسليم
                                </button>
                                <button
                                  onClick={() => setFailModalOrder(order)}
                                  style={{
                                    padding: '6px 10px', background: 'transparent', border: '1px solid var(--danger)',
                                    color: 'var(--danger)', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold'
                                  }}
                                  title="تعذر التوصيل"
                                >
                                  ❌
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  {/* Mobile Trips Cards View (Visible on phones without horizontal scroll) */}
                  <div className="mobile-trip-list">
                    {ordersByPilot[viewPilotId].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)).map(order => {
                      const elapsed = getElapsedMinutes(order.startTime || order.timestamp);
                      const isDelayed = elapsed >= 40;
                      return (
                        <div
                          key={order.id}
                          className="glass-card"
                          style={{
                            padding: '14px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '10px',
                            background: isDelayed ? 'rgba(239, 68, 68, 0.08)' : 'rgba(255, 255, 255, 0.02)',
                            borderRight: `4px solid ${isDelayed ? '#ef4444' : 'var(--primary)'}`
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ fontWeight: '900', color: 'var(--primary)', fontSize: '1.1rem' }}>
                                #{order.originalId || order.id}
                              </span>
                              <button onClick={() => onReedit(order)} style={{ background: 'none', border: 'none', padding: '4px', cursor: 'pointer', opacity: 0.7 }} title="تعديل">✏️</button>
                            </div>
                            <LiveElapsedBadge startTime={order.startTime} timestamp={order.timestamp} isOut={true} />
                          </div>

                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                            <div>
                              <div style={{ fontWeight: '800', color: 'var(--text-main)', fontSize: '0.95rem' }}>{order.customerName}</div>
                              <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginTop: '2px' }}>{order.area}</div>
                            </div>
                            {order.total > 0 && (
                              <div style={{ fontWeight: '900', color: 'var(--accent)', fontSize: '1.05rem', whiteSpace: 'nowrap' }}>
                                {order.total} ج.م
                              </div>
                            )}
                          </div>

                          <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                            <button
                              onClick={() => completeOrder(order.id)}
                              className="btn-primary"
                              style={{ flex: 1, minHeight: '44px', background: 'var(--success)', fontWeight: '800' }}
                            >
                              <Check size={16} />
                              <span>تم التسليم</span>
                            </button>
                            <button
                              onClick={() => setFailModalOrder(order)}
                              className="btn-danger-outline"
                              style={{ minHeight: '44px', padding: '0 16px', fontWeight: 'bold' }}
                              title="تعذر التوصيل"
                            >
                              <X size={16} />
                              <span>تعذر</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
                  {pilotsWithOrders.length > 0 ? 'الرجاء اختيار طيار لعرض طلباته النشطة' : 'لا توجد رحلات نشطة حالياً'}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 🖼️ Full Image Modal Preview */}
      <AnimatePresence>
        {previewImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setPreviewImage(null)}
            style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              zIndex: 9999, backdropFilter: 'blur(10px)', padding: '24px'
            }}
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              onClick={(e) => e.stopPropagation()}
              style={{ position: 'relative', maxWidth: '90%', maxHeight: '90%' }}
            >
              <img
                src={previewImage}
                alt="Full receipt view"
                style={{
                  maxWidth: '100%',
                  maxHeight: '80vh',
                  borderRadius: '12px',
                  border: '1px solid rgba(255,255,255,0.15)',
                  boxShadow: '0 20px 60px rgba(0,0,0,0.8)'
                }}
              />
              <button
                onClick={() => setPreviewImage(null)}
                style={{
                  position: 'absolute', top: '-14px', right: '-14px',
                  background: '#ef4444', color: 'white', border: 'none',
                  borderRadius: '50%', width: '36px', height: '36px',
                  cursor: 'pointer', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', boxShadow: '0 4px 12px rgba(0,0,0,0.5)'
                }}
              >
                <X size={20} />
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 🚫 In-App Cancel Modal */}
      <CancelOrderModal
        isOpen={Boolean(cancelModalOrder)}
        onClose={() => setCancelModalOrder(null)}
        orderNumber={cancelModalOrder?.originalId || cancelModalOrder?.id}
        onConfirm={(reason) => {
          if (cancelModalOrder) {
            cancelOrder(cancelModalOrder.id, reason);
            setCancelModalOrder(null);
          }
        }}
      />

      {/* ⚠️ In-App Fail Delivery Modal */}
      <FailDeliveryModal
        isOpen={Boolean(failModalOrder)}
        onClose={() => setFailModalOrder(null)}
        orderNumber={failModalOrder?.originalId || failModalOrder?.id}
        onConfirm={(reason) => {
          if (failModalOrder) {
            failDelivery(failModalOrder.id, reason);
            setFailModalOrder(null);
          }
        }}
      />
    </div>
  );
};

export default OrderInbox;
