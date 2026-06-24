// Developed & Owned by D.AmrMamdouh - 01038035884
import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { Check, X, AlertCircle, UserPlus, RotateCcw, Clock, Bike, RefreshCw, ShoppingCart, ChevronDown, ChevronUp, MapPin } from 'lucide-react';
import { printerService } from '../../services/printerService';
import { motion, AnimatePresence } from 'framer-motion'; // 🪄 استيراد مكتبة التحريك لعمل الـ Live Dashboard
import { isPilotOnDelivery } from '../../utils/pilotState';

const RESTAURANT_COORDS = { lat: 30.126131, lng: 31.298350 };

const calculateDistance = (lat1, lon1, lat2, lon2) => {
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
    if (dist <= 3) return { id: 1, color: '#10b981' };
    if (dist <= 7) return { id: 2, color: '#3b82f6' };
    if (dist <= 10) return { id: 3, color: '#8b5cf6' };
    if (dist <= 15) return { id: 4, color: '#f59e0b' };
    return { id: 'Out', color: '#ef4444' };
};

const getOrderPaymentScreenshot = (order) =>
    order.paymentScreenshot || order.screenshot || order.image || order.attachment || order.paymentProof || null;

const OrderInbox = ({ onReedit }) => {
    const { orders, pilots, confirmOrder, deleteOrder, cancelOrder, isShiftOpen, assignPilot, startDelivery, completeOrder, failDelivery, getSuggestedPilot, syncExternalOrders, userRole, isThermalPrintMode, retryReceiptUpload } = useApp();
    const handleCancel = (id) => {
        const reason = prompt('هل أنت متأكد من إلغاء الطلب؟ يرجى إدخال سبب الإلغاء:');
        if (reason) cancelOrder(id, reason);
    };
    const [selectedPilot, setSelectedPilot] = useState({});
    const [auditTimers, setAuditTimers] = useState({});
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [previewImage, setPreviewImage] = useState(null); // 🖼️ حالة عرض الصورة الكبيرة (Modal)
    const [expandedOrderId, setExpandedOrderId] = useState(null); // 🛒 حالة عرض تفاصيل السلة
    const [selectedPreviewOrderId, setSelectedPreviewOrderId] = useState(null);

    const handleManualRefresh = async () => {
        setIsRefreshing(true);
        try {
            await syncExternalOrders();
        } finally {
            setTimeout(() => setIsRefreshing(false), 1000);
        }
    };

    // 🔴 تصفية الطلبات المعروضة بناءً على نوع المستخدم (ادمن او كاشير او طيار)
    const inboxOrders = orders.filter(o => {
        if (userRole === 'admin' || userRole === 'casher') {
            // الادمن والكاشير بيشوفوا الطلبات في مراحل التجهيز والانتظار (تم استبعاد active لإخفائها من صندوق الوارد)
            return ['pending', 'pending_timer', 'waiting_driver', 'driver_assigned'].includes(o.status);
        } else {
            // الطيار بيشوف بس الطلبات اللي اتسندت ليه (تم استبعاد active لإخفائها من صندوق الوارد)
            return ['driver_assigned'].includes(o.status);
        }
    });

    const previewOrder = inboxOrders.find(o => o.id === selectedPreviewOrderId) || inboxOrders[0];

    const [viewPilotId, setViewPilotId] = useState(null);

    // Group active orders by pilot for the "رحلات الدليفري الحالية" section
    const activeOrders = orders.filter(o => o.status === 'active');
    const ordersByPilot = activeOrders.reduce((acc, o) => {
        const key = String(o.pilotId || o.deliveryId);
        if (!acc[key]) acc[key] = [];
        acc[key].push(o);
        return acc;
    }, {});

    const pilotsWithOrders = pilots.filter(p => ordersByPilot[String(p.id)]);

    // Set default view pilot if none selected and pilots exist, or reset if pilot is no longer outside
    useEffect(() => {
        if (pilotsWithOrders.length === 0) {
            setViewPilotId(null);
        } else if (!viewPilotId || !pilotsWithOrders.some(p => String(p.id) === String(viewPilotId))) {
            setViewPilotId(pilotsWithOrders[0].id);
        }
    }, [pilotsWithOrders, viewPilotId]);

    const getElapsedTime = (timestamp) => {
        const diff = Math.floor((new Date() - new Date(timestamp)) / (1000 * 60));
        return diff;
    };

    const handleFailDelivery = (orderId) => {
        const reason = prompt("يرجى إدخال سبب فشل التوصيل (مثال: العميل لدية شكوة معينة ):");
        if (reason) {
            failDelivery(orderId, reason);
        }
    };
    const availablePilots = pilots.filter(p => p.shiftStatus === 'open');

    // Effect to handle local countdown
    useEffect(() => {
        const interval = setInterval(() => {
            const now = new Date();
            const newTimers = {};
            inboxOrders.forEach(order => {
                if (order.status === 'pending_timer') {
                    const diff = Math.max(0, 5 - Math.floor((now - new Date(order.timestamp)) / 1000));
                    newTimers[order.id] = diff;
                }
            });
            setAuditTimers(newTimers);
        }, 500);
        return () => clearInterval(interval);
    }, [orders]); // Depend on orders to refresh

    const handlePrint = (order, pilotName = null) => {
        let pName = pilotName;
        if (!pName && order.pilotId) {
            pName = pilots.find(p => String(p.id) === String(order.pilotId))?.name || null;
        }
        printerService.printKitchenReceipt(order, true, pName);
    };

    const handleAssignAndPrint = (orderId) => {
        let pilotId = selectedPilot[orderId];

        // If no manual selection, try to get the suggested pilot
        if (!pilotId) {
            const suggested = getSuggestedPilot();
            if (suggested) pilotId = suggested.id;
        }

        if (!pilotId) {
            alert('please select a pilot');
            return;
        }

        // Validate pilot status
        const selectedPilotObj = pilots.find(p => String(p.id) === String(pilotId));
        if (selectedPilotObj && isPilotOnDelivery(selectedPilotObj.state)) {
            alert('هذا الطيار في رحلة توصيل حالياً ولا يمكن إسناد طلب جديد له 🚫');
            return;
        }

        assignPilot(orderId, pilotId);

        // Find pilot name for print
        const pilotName = pilots.find(p => String(p.id) === String(pilotId))?.name || 'Unknown';
        // Need to pass order object, but state might not be updated yet. Use current order data + new pilot.
        const order = orders.find(o => o.id === orderId);
        if (order) handlePrint({ ...order, pilotId }, pilotName);
    };

    if (!isShiftOpen) {
        return (
            <div className="glass-card" style={{ padding: '60px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px' }}>
                <AlertCircle size={48} color="var(--warning)" />
                <h2>يجب فتح الوردية أولاً لاستقبال الطلبات</h2>
            </div>
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', padding: '25px' }}>
            <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h2 style={{ fontSize: '2.5rem', fontWeight: '700' }}>مرحلة التجهيز والإسناد</h2>
                    <p style={{ color: 'var(--text-muted)' }}>مراجعة الطلبات &gt; اختيار الطيار (Fair Queue) &gt; الطباعة والإسناد &gt; خروج الطيار</p>
                </div>
                {/* 
                <button
                    onClick={handleManualRefresh}
                    disabled={isRefreshing}
                    className="btn-primary"
                    style={{
                        background: 'var(--primary)',
                        gap: '8px',
                        padding: '12px 24px',
                        boxShadow: '0 4px 15px rgba(79, 70, 229, 0.4)'
                    }}
                >
                    <RefreshCw size={20} className={isRefreshing ? 'pulse-dot' : ''} />
                    <span style={{ fontWeight: 'bold' }}>تنشيط الاستلام</span>
                </button>
                */}
            </header>

            {inboxOrders.length === 0 ? (
                <div className="glass-card" style={{ padding: '80px', textAlign: 'center' }}>
                    <p style={{ color: 'var(--text-muted)' }}>لا توجد طلبات في مرحلة الإعداد</p>
                </div>
            ) : (
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: (isThermalPrintMode && previewOrder) ? '1fr 340px' : '1fr',
                    gap: '24px',
                    alignItems: 'start'
                }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <AnimatePresence mode="popLayout">
                            {inboxOrders.map(order => {
                                const isInGracePeriod = order.status === 'pending_timer';
                                const timeLeft = auditTimers[order.id] || 0;
                                const suggestedPilot = order.status === 'waiting_driver' ? getSuggestedPilot() : null;
                                const isOnline = order.source === 'online';
                                const paymentScreenshot = getOrderPaymentScreenshot(order);
                                const receiptUploadStatus = order.receiptUploadStatus;

                                const normalized = isOnline ? {
                                    name: order.customerName || order.customer?.name || "عميل غير معروف",
                                    phone: order.phone || order.customer?.phone_primary || "غير متوفر",
                                    phone2: order.phone2 || order.customer?.phone2 || null,
                                    address: order.area || order.customer?.address || "No Address",
                                    deliveryFee: order.deliveryFee || order.totals?.delivery_fee || 0,
                                    total: order.total || order.payment?.amount_total || 0,
                                    paymentMethod: order.paymentMethod || order.payment?.method || "unknown",
                                    lat: order.lat || order.lan || null,
                                    lng: order.lng || order.len || null,
                                    screenshot: getOrderPaymentScreenshot(order)
                                } : null;

                                if (isOnline && normalized.screenshot?.includes("drive.google.com")) {
                                    const match = normalized.screenshot.match(/\/d\/([^\/]+)/);
                                    if (match) normalized.screenshot = `https://drive.google.com/thumbnail?id=${match[1]}&sz=w500`;
                                }

                                let statusColor = 'var(--border)';
                                let statusBg = 'transparent';
                                if (order.status === 'pending') { statusColor = 'var(--warning)'; statusBg = 'rgba(245, 158, 11, 0.05)'; }
                                if (order.status === 'waiting_driver') { statusColor = 'var(--accent)'; statusBg = 'rgba(16, 185, 129, 0.05)'; }
                                if (order.status === 'driver_assigned') { statusColor = '#3b82f6'; statusBg = 'rgba(59, 130, 246, 0.05)'; }
                                if (order.status === 'active') { statusColor = 'var(--success)'; statusBg = 'rgba(16, 185, 129, 0.08)'; }

                                const pilotIdForBadge = order.pilotId || order.deliveryId;
                                const orderPilot = pilotIdForBadge
                                    ? pilots.find(p => String(p.id) === String(pilotIdForBadge))
                                    : null;
                                const showPilotOutBadge = order.status === 'driver_assigned' && isPilotOnDelivery(orderPilot?.state);

                                const isSelectedPreview = isThermalPrintMode && previewOrder && previewOrder.id === order.id;

                                return (
                                    <motion.div
                                        key={order.id}
                                        layout // 🪄 تحريك العناصر الأخرى بسلاسة عند حذف عنصر
                                        initial={{ opacity: 0, x: -20, scale: 0.95 }}
                                        animate={{ opacity: 1, x: 0, scale: 1 }}
                                        exit={{ opacity: 0, x: 20, scale: 0.9, transition: { duration: 0.2 } }}
                                        transition={{ type: "spring", stiffness: 300, damping: 25 }}
                                        onClick={() => isThermalPrintMode && setSelectedPreviewOrderId(order.id)}
                                        className={`glass-card order-card order-card-grid ${order.status === 'pending' ? 'pulse-new' : ''}`}
                                        style={{
                                            padding: '24px',
                                            alignItems: 'center',
                                            borderLeft: `6px solid ${statusColor}`,
                                            background: statusBg,
                                            position: 'relative',
                                            cursor: isThermalPrintMode ? 'pointer' : 'default',
                                            border: isSelectedPreview ? '2px solid var(--accent)' : '1px solid var(--border)',
                                            boxShadow: isSelectedPreview ? '0 0 15px rgba(16, 185, 129, 0.2)' : 'none'
                                        }}
                                    >

                                        {/* Status Indicator Badge */}
                                        <div style={{ position: 'absolute', top: '12px', right: '12px', background: statusColor, color: '#fff', fontSize: '0.7rem', padding: '4px 10px', borderRadius: '12px', fontWeight: 'bold', boxShadow: `0 2px 10px ${statusColor}80` }}>
                                            {order.status === 'pending' ? 'طلب جديد' : order.status === 'waiting_driver' ? 'بانتظار الطيار' : order.status === 'active' ? 'في الطريق 🚚' : 'تم الإسناد'}
                                        </div>

                                        {/* 1. Order ID & Badge */}
                                        <div>
                                            <h3 style={{ fontSize: '1.4rem', fontWeight: 'bold', color: 'var(--primary)' }}>#{order.originalId || order.id} {order.type === 'talabat' && <span style={{ fontSize: '0.6rem', verticalAlign: 'middle', background: '#ff5722', color: 'white', padding: '2px', borderRadius: '4px' }}>Talabat</span>}</h3>
                                            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                                {new Date(order.timestamp).toLocaleTimeString('ar-EG')}
                                            </p>
                                            {showPilotOutBadge && (
                                                <div style={{
                                                    marginTop: '6px', fontSize: '0.72rem', color: 'var(--warning)',
                                                    background: 'rgba(245, 158, 11, 0.12)', border: '1px solid rgba(245, 158, 11, 0.3)',
                                                    borderRadius: '6px', padding: '3px 8px', display: 'inline-flex', alignItems: 'center', gap: '4px'
                                                }}>
                                                    <Bike size={12} /> الطيار خارج — بانتظار بدء الرحلة
                                                </div>
                                            )}
                                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '4px' }}>
                                                {order.confirmedAt && <span style={{ background: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: '4px' }}>✔️ {new Date(order.confirmedAt).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</span>}
                                                {order.assignedAt && <span style={{ background: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: '4px' }}>👤 {new Date(order.assignedAt).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</span>}
                                                {order.startTime && <span style={{ background: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: '4px' }}>🚚 {new Date(order.startTime).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</span>}
                                                {order.deliveredAt && <span style={{ background: 'rgba(74, 222, 128, 0.1)', color: '#4ade80', padding: '2px 6px', borderRadius: '4px' }}>🏁 {new Date(order.deliveredAt).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</span>}
                                                {order.failedAt && <span style={{ background: 'rgba(248, 113, 113, 0.1)', color: '#f87171', padding: '2px 6px', borderRadius: '4px' }}>❌ {new Date(order.failedAt).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</span>}
                                            </div>

                                            {/* 📍 Zone & Distance Badge */}
                                            {isOnline && normalized.lat && normalized.lng && (
                                                <div style={{ marginTop: '8px' }}>
                                                    {(() => {
                                                        const dist = calculateDistance(RESTAURANT_COORDS.lat, RESTAURANT_COORDS.lng, normalized.lat, normalized.lng);
                                                        const zoneCfg = getZone(dist);
                                                        return (
                                                            <div style={{
                                                                display: 'inline-flex', alignItems: 'center', gap: '6px',
                                                                padding: '4px 10px', borderRadius: '12px', background: `${zoneCfg.color}15`,
                                                                border: `1px solid ${zoneCfg.color}30`, color: zoneCfg.color, fontSize: '0.75rem', fontWeight: 'bold'
                                                            }}>
                                                                <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: zoneCfg.color }}></div>
                                                                نطاق {zoneCfg.id} • {dist} كم
                                                            </div>
                                                        );
                                                    })()}
                                                </div>
                                            )}

                                            {isInGracePeriod && <span style={{ color: 'var(--danger)', fontSize: '0.8rem' }}>Grace: {timeLeft}s</span>}
                                        </div>

                                        {/* 2. Customer Info */}
                                        <div>
                                            {isOnline ? (
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                                    {/* 1. Header (Name + Phones Badge) */}
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px' }}>
                                                        <h4 style={{ margin: '0', fontWeight: '900', fontSize: '1.5rem', color: 'var(--primary)', textShadow: '0 0 15px rgba(79, 70, 229, 0.2)' }}>
                                                            🧍 {normalized.name}
                                                        </h4>
                                                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                                            <a href={`tel:${normalized.phone}`} style={{
                                                                fontSize: '0.85rem', fontWeight: 'bold', background: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6',
                                                                padding: '4px 12px', borderRadius: '20px', textDecoration: 'none', border: '1px solid rgba(59, 130, 246, 0.2)',
                                                                display: 'flex', alignItems: 'center', gap: '4px'
                                                            }}>
                                                                📞 {normalized.phone}
                                                            </a>
                                                            {normalized.phone2 && (
                                                                <a href={`tel:${normalized.phone2}`} style={{
                                                                    fontSize: '0.85rem', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.05)',
                                                                    padding: '4px 12px', borderRadius: '20px', textDecoration: 'none', border: '1px solid rgba(255,255,255,0.1)'
                                                                }}>
                                                                    📞 {normalized.phone2}
                                                                </a>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {/* 2. Address (Max 2 lines, ellipsis) */}
                                                    <p style={{
                                                        margin: '0', fontSize: '1rem', color: 'var(--text-muted)', lineHeight: '1.4',
                                                        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden'
                                                    }} title={normalized.address}>
                                                        📍 {normalized.address}
                                                    </p>

                                                    {/* 3. Actions Row (Badges + Location + Screenshot) */}
                                                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px', marginTop: '4px' }}>
                                                        {/* 💳 Payment Method Badge */}
                                                        {(() => {
                                                            const method = (normalized.paymentMethod || "").toLowerCase();
                                                            let badge = { text: "💳 Online", color: "var(--text-muted)", bg: "rgba(255,255,255,0.05)", border: "rgba(255,255,255,0.1)", glow: "transparent" };

                                                            if (method === 'cash') badge = { text: "💵 كاش", color: "#10b981", bg: "rgba(16, 185, 129, 0.15)", border: "rgba(16, 185, 129, 0.2)", glow: "rgba(16, 185, 129, 0.1)" };
                                                            else if (method === 'vodafone_cash' || method.includes('vodafone')) badge = { text: "📱 فودافون", color: "#ef4444", bg: "rgba(239, 68, 68, 0.15)", border: "rgba(239, 68, 68, 0.2)", glow: "rgba(239, 68, 68, 0.1)" };
                                                            else if (method === 'instapay') badge = { text: "⚡ InstaPay", color: "#3b82f6", bg: "rgba(59, 130, 246, 0.15)", border: "rgba(59, 130, 246, 0.2)", glow: "rgba(59, 130, 246, 0.1)" };

                                                            return (
                                                                <div style={{
                                                                    padding: '6px 16px', borderRadius: '30px', fontSize: '0.85rem', fontWeight: '800',
                                                                    background: badge.bg, color: badge.color, border: `1px solid ${badge.border}`,
                                                                    boxShadow: `0 0 10px ${badge.glow}`
                                                                }}>
                                                                    {badge.text}
                                                                </div>
                                                            );
                                                        })()}

                                                        {/* 🟡 Location Button */}
                                                        {normalized.lat && normalized.lng && (
                                                            <button
                                                                onClick={() => window.open(`https://www.google.com/maps?q=${normalized.lat},${normalized.lng}`, '_blank')}
                                                                className="btn-primary hover-scale"
                                                                style={{
                                                                    padding: '6px 16px', fontSize: '0.85rem', background: '#f59e0b',
                                                                    color: 'white', borderRadius: '30px', border: 'none', fontWeight: 'bold',
                                                                    boxShadow: '0 4px 12px rgba(245, 158, 11, 0.4)', display: 'flex', alignItems: 'center', gap: '6px'
                                                                }}
                                                            >
                                                                🟡 اللوكيشن
                                                            </button>
                                                        )}

                                                        {/* 🖼️ Mini Preview Thumbnail */}
                                                        {normalized.screenshot && (
                                                            <div
                                                                onClick={() => setPreviewImage(normalized.screenshot)}
                                                                className="hover-scale"
                                                                style={{
                                                                    width: '42px', height: '42px', borderRadius: '10px', overflow: 'hidden',
                                                                    cursor: 'pointer', border: '2px solid rgba(255,255,255,0.1)',
                                                                    boxShadow: '0 4px 10px rgba(0,0,0,0.3)'
                                                                }}
                                                            >
                                                                <img src={normalized.screenshot} alt="preview" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            ) : (
                                                <>
                                                    <h4 style={{ margin: '0 0 4px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        {order.customerName || order.customer?.name || "عميل غير معروف"}
                                                        {order.total === 0 && (
                                                            <span style={{ fontSize: '0.6rem', background: 'var(--danger)', color: 'white', padding: '2px 6px', borderRadius: '4px', animation: 'pulse 2s infinite' }}>⚠️ راجع الطلب</span>
                                                        )}
                                                    </h4>
                                                    <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '5px' }}>
                                                        {order.area || order.customer?.address || "غير مسجل"}
                                                    </p>

                                                    {/* 📍 Zone & Distance Badge for Manual Orders */}
                                                    {order.lat && order.lng && (
                                                        <div style={{ marginTop: '8px' }}>
                                                            {(() => {
                                                                const dist = calculateDistance(RESTAURANT_COORDS.lat, RESTAURANT_COORDS.lng, order.lat, order.lng);
                                                                const zoneCfg = getZone(dist);
                                                                return (
                                                                    <div style={{
                                                                        display: 'inline-flex', alignItems: 'center', gap: '6px',
                                                                        padding: '4px 10px', borderRadius: '12px', background: `${zoneCfg.color}15`,
                                                                        border: `1px solid ${zoneCfg.color}30`, color: zoneCfg.color, fontSize: '0.75rem', fontWeight: 'bold'
                                                                    }}>
                                                                        <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: zoneCfg.color }}></div>
                                                                        نطاق {zoneCfg.id} • {dist} كم
                                                                    </div>
                                                                );
                                                            })()}
                                                        </div>
                                                    )}

                                                    <div style={{ marginTop: '10px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '10px' }}>

                                                        {/* 💵 Payment Badge */}
                                                        {(() => {
                                                            const method = (order.payment?.method || order.paymentMethod || "غير محدد").toLowerCase();
                                                            const isCash = method.includes('cash') && !method.includes('vodafone');
                                                            const isVF = method.includes('vodafone') || method.includes('v-cash') || method.includes('فودافون');

                                                            return (
                                                                <div style={{
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: '6px',
                                                                    padding: '4px 10px',
                                                                    borderRadius: '20px',
                                                                    fontSize: '0.8rem',
                                                                    fontWeight: '600',
                                                                    background: isCash ? 'rgba(16, 185, 129, 0.15)' : isVF ? 'rgba(139, 92, 246, 0.15)' : 'rgba(255,255,255,0.05)',
                                                                    color: isCash ? '#10b981' : isVF ? '#a78bfa' : 'var(--text-muted)',
                                                                    border: `1px solid ${isCash ? 'rgba(16, 185, 129, 0.2)' : isVF ? 'rgba(139, 92, 246, 0.2)' : 'rgba(255,255,255,0.1)'}`
                                                                }}>
                                                                    {isCash ? '💵 كاش' : isVF ? '📱 فودافون كاش' : `💳 ${method}`}
                                                                </div>
                                                            );
                                                        })()}

                                                        {/* 🖼️ Mini Preview Thumbnail */}
                                                        {paymentScreenshot && (
                                                            <div
                                                                onClick={() => setPreviewImage(paymentScreenshot)}
                                                                className="hover-scale"
                                                                style={{
                                                                    width: '45px',
                                                                    height: '45px',
                                                                    borderRadius: '8px',
                                                                    overflow: 'hidden',
                                                                    cursor: 'pointer',
                                                                    border: '2px solid var(--border)'
                                                                }}
                                                                title="عرض صورة التحويل"
                                                            >
                                                                <img
                                                                    src={paymentScreenshot}
                                                                    alt="preview"
                                                                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                                                />
                                                            </div>
                                                        )}

                                                        {receiptUploadStatus === 'uploading' && (
                                                            <span style={{ fontSize: '0.75rem', color: 'var(--accent)' }}>⏳ جاري رفع الإيصال...</span>
                                                        )}

                                                        {receiptUploadStatus === 'failed' && (
                                                            <button
                                                                type="button"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    retryReceiptUpload(order.id);
                                                                }}
                                                                style={{
                                                                    padding: '4px 10px',
                                                                    borderRadius: '8px',
                                                                    fontSize: '0.75rem',
                                                                    fontWeight: 'bold',
                                                                    background: 'rgba(239, 68, 68, 0.15)',
                                                                    color: 'var(--danger)',
                                                                    border: '1px solid var(--danger)',
                                                                    cursor: 'pointer'
                                                                }}
                                                            >
                                                                🔄 إعادة رفع الإيصال
                                                            </button>
                                                        )}

                                                        {/* 📍 Location Button (Prominent Map Access) */}
                                                        {order.lat && order.lng && (
                                                            <button
                                                                onClick={() => window.open(`https://www.google.com/maps?q=${order.lat},${order.lng}`, '_blank')}
                                                                className="btn-primary hover-scale"
                                                                style={{
                                                                    padding: '8px 16px',
                                                                    fontSize: '0.8rem',
                                                                    background: 'var(--primary)',
                                                                    color: 'white',
                                                                    borderRadius: '20px',
                                                                    gap: '6px',
                                                                    boxShadow: '0 4px 10px rgba(79, 70, 229, 0.3)'
                                                                }}
                                                                title="فتح الموقع على الخريطة"
                                                            >
                                                                📍 عرض الموقع
                                                            </button>
                                                        )}
                                                    </div>
                                                </>
                                            )}
                                        </div>

                                        {/* 3. Workflow Action Area */}
                                        <div>
                                            {/* Stage 1: Pending -> Confirm (Admin/Casher) */}
                                            {(order.status === 'pending' || order.status === 'pending_timer') && (userRole === 'admin' || userRole === 'casher') && (
                                                <div style={{ display: 'flex', gap: '10px' }}>
                                                    {isInGracePeriod ? (
                                                        <button
                                                            onClick={() => onReedit(order)}
                                                            className="btn-primary"
                                                            style={{ width: '100%', background: 'var(--warning)', color: 'black' }}
                                                        >
                                                            <RotateCcw size={18} /> الرجوع خطوة للتعديل
                                                        </button>
                                                    ) : (
                                                        <button
                                                            onClick={() => confirmOrder(order.id)}
                                                            className="btn-primary"
                                                            style={{ width: '100%' }}
                                                        >
                                                            <Check size={18} /> تأكيد وقبول
                                                        </button>
                                                    )}
                                                    <button onClick={() => handleCancel(order.id)} className="btn-danger-outline"><X size={18} /></button>
                                                </div>
                                            )}

                                            {/* Stage 2: Waiting Driver -> Assign (Admin/Casher) */}
                                            {order.status === 'waiting_driver' && (userRole === 'admin' || userRole === 'casher') && (
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                    {suggestedPilot && (
                                                        <div style={{ fontSize: '0.8rem', color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                            <span style={{ fontWeight: 'bold' }}>⭐ مقترح:</span> {suggestedPilot.name}
                                                        </div>
                                                    )}
                                                    <div style={{ display: 'flex', gap: '8px' }}>
                                                        <select
                                                            className="glass-card"
                                                            style={{ flex: 1, padding: '8px', background: '#1f2937', color: 'white', border: '1px solid var(--border)' }}
                                                            onChange={(e) => setSelectedPilot({ ...selectedPilot, [order.id]: e.target.value })}
                                                            value={selectedPilot[order.id] || suggestedPilot?.id || ''}
                                                        >
                                                            <option value="">اختر طيار...</option>
                                                            {availablePilots.map(p => (
                                                                <option key={p.id} value={p.id} disabled={isPilotOnDelivery(p.state)}>
                                                                    {p.name} {isPilotOnDelivery(p.state) ? '(في توصيل 🚫)' : '(متاح)'} - {p.ordersCount || 0} طلبات
                                                                </option>
                                                            ))}
                                                        </select>
                                                        <button
                                                            onClick={() => handleAssignAndPrint(order.id)}
                                                            disabled={!selectedPilot[order.id] && !suggestedPilot}
                                                            className="btn-primary"
                                                            style={{ background: 'var(--accent)' }}
                                                            title="إسناد وطباعة البون"
                                                        >
                                                            <UserPlus size={18} />
                                                        </button>
                                                    </div>
                                                </div>
                                            )}

                                            {/* Stage 3: Assigned -> Out (one order per trip start) */}
                                            {order.status === 'driver_assigned' && (() => {
                                                const pilotIdForOrder = order.pilotId || order.deliveryId;
                                                const assignedPilot = pilots.find(p => String(p.id) === String(pilotIdForOrder));
                                                const pilotAlreadyOut = isPilotOnDelivery(assignedPilot?.state);
                                                const pendingSiblings = orders.filter(o =>
                                                    String(o.pilotId || o.deliveryId) === String(pilotIdForOrder) &&
                                                    o.status === 'driver_assigned' &&
                                                    o.id !== order.id
                                                ).length;

                                                return (
                                                    <div style={{ textAlign: 'center' }}>
                                                        <div style={{ marginBottom: '8px', fontSize: '0.9rem' }}>
                                                            الطيار: <strong>{assignedPilot?.name}</strong>
                                                        </div>
                                                        {pilotAlreadyOut && (
                                                            <div style={{
                                                                marginBottom: '8px', fontSize: '0.78rem', color: 'var(--warning)',
                                                                background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.25)',
                                                                borderRadius: '8px', padding: '4px 8px', display: 'inline-flex', alignItems: 'center', gap: '4px'
                                                            }}>
                                                                <Bike size={14} /> الطيار خارج المطعم — لم تبدأ رحلة هذا الطلب
                                                                {pendingSiblings > 0 && ` (+${pendingSiblings} طلب آخر بالانتظار)`}
                                                            </div>
                                                        )}
                                                        <button
                                                            onClick={() => startDelivery(order.id)}
                                                            className="btn-primary"
                                                            style={{ width: '100%', background: 'var(--success)' }}
                                                        >
                                                            <Bike size={18} /> ابدأ الرحلة الآن
                                                        </button>
                                                    </div>
                                                );
                                            })()}

                                            {/* Stage 4: Out -> Complete/Fail (Driver View or Admin/Casher Control) */}
                                            {order.status === 'active' && (userRole === 'admin' || userRole === 'casher' || userRole === 'driver') && (
                                                <div style={{ display: 'flex', gap: '10px' }}>
                                                    <button
                                                        onClick={() => completeOrder(order.id)}
                                                        className="btn-primary"
                                                        style={{ flex: 2, background: 'var(--success)' }}
                                                    >
                                                        <Check size={18} /> تم التسليم
                                                    </button>
                                                    <button
                                                        onClick={() => {
                                                            const reason = prompt('سبب فشل التوصيل:');
                                                            if (reason) failDelivery(order.id, reason);
                                                        }}
                                                        className="btn-danger-outline"
                                                        style={{ flex: 1 }}
                                                    >
                                                        <X size={18} /> فشل
                                                    </button>
                                                </div>
                                            )}
                                        </div>

                                        <div style={{ display: 'flex', gap: '8px', flexDirection: 'column', alignItems: 'center' }}>
                                            <button onClick={() => handlePrint(order)} style={{ background: 'none', border: 'none', cursor: 'pointer' }} title="طباعة نسخة"><span style={{ fontSize: '1.2rem' }}>🖨️</span></button>
                                            {!isInGracePeriod && order.status !== 'pending' && (
                                                <button onClick={() => handleCancel(order.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'white' }} title="إلغاء الطلب"><X size={20} /></button>
                                            )}
                                        </div>

                                        {/* 🛒 سلة المشتريات (Cart Expandable Section) */}
                                        {order.items && order.items.length > 0 && (
                                            <div style={{ gridColumn: '1 / -1', marginTop: '12px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '12px' }}>
                                                <button
                                                    onClick={() => setExpandedOrderId(expandedOrderId === order.id ? null : order.id)}
                                                    style={{
                                                        background: 'rgba(79, 70, 229, 0.1)', color: 'var(--primary)', border: '1px solid rgba(79, 70, 229, 0.2)',
                                                        padding: '8px 16px', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '8px',
                                                        width: 'fit-content', cursor: 'pointer', fontWeight: 'bold', transition: 'all 0.2s ease'
                                                    }}
                                                    className="hover-scale"
                                                >
                                                    <ShoppingCart size={18} />
                                                    <span>عرض الطلبات ({order.items?.length || 0})</span>
                                                    {expandedOrderId === order.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                                </button>

                                                <AnimatePresence>
                                                    {expandedOrderId === order.id && (
                                                        <motion.div
                                                            initial={{ opacity: 0, height: 0 }}
                                                            animate={{ opacity: 1, height: 'auto' }}
                                                            exit={{ opacity: 0, height: 0 }}
                                                            style={{ overflow: 'hidden', marginTop: '12px' }}
                                                        >
                                                            <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: '12px', padding: '16px', border: '1px solid var(--border)' }}>
                                                                <h5 style={{ color: 'var(--text-muted)', marginBottom: '12px', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '8px' }}>تفاصيل المنتجات</h5>
                                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                                    {order.items?.map((item, idx) => (
                                                                        <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.02)', padding: '8px 12px', borderRadius: '8px' }}>
                                                                            <div>
                                                                                <span style={{ fontWeight: 'bold', color: 'var(--text-main)' }}>{item.name}</span>
                                                                                {item.category && <span style={{ marginLeft: '8px', fontSize: '0.75rem', background: 'var(--primary)', color: 'white', padding: '2px 6px', borderRadius: '4px' }}>{item.category}</span>}
                                                                            </div>
                                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                                                                <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{item.count}x</span>
                                                                                <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{item.price} ج</span>
                                                                                <span style={{ fontWeight: 'bold', color: 'var(--accent)', minWidth: '50px', textAlign: 'right' }}>{(item.count || 1) * (item.price || 0)} ج</span>
                                                                            </div>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                                <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px dashed rgba(255,255,255,0.1)', display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-end' }}>
                                                                    <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>المجموع (Subtotal): <strong style={{ color: 'var(--text-main)' }}>{order.subtotal || Math.max(0, order.total - (order.deliveryFee || 0))} ج.م</strong></div>
                                                                    <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>التوصيل (Delivery): <strong style={{ color: 'var(--text-main)' }}>{order.deliveryFee || 0} ج.م</strong></div>
                                                                    {order.serviceFee > 0 && <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>الخدمة (Service): <strong style={{ color: 'var(--text-main)' }}>{order.serviceFee} ج.م</strong></div>}
                                                                    <div style={{ color: 'var(--accent)', fontSize: '1.2rem', marginTop: '4px', fontWeight: '900' }}>الإجمالي (Total): {order.total} ج.م</div>
                                                                    {Number(order.paidNow) > 0 && (
                                                                        <div style={{ color: '#10b981', fontSize: '1rem', fontWeight: 'bold' }}>المدفوع (Paid Now): {order.paidNow} ج.م</div>
                                                                    )}
                                                                    {Number(order.remainingAmount) > 0 && (
                                                                        <div style={{ color: '#ef4444', fontSize: '1.1rem', fontWeight: 'bold', background: 'rgba(239, 68, 68, 0.15)', padding: '4px 10px', borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.3)' }}>الباقي (Remaining): {order.remainingAmount} ج.م</div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </motion.div>
                                                    )}
                                                </AnimatePresence>
                                            </div>
                                        )}

                                    </motion.div>
                                );
                            })}
                        </AnimatePresence>
                    </div>

                    {isThermalPrintMode && previewOrder && (
                        <div className="no-print" style={{ position: 'sticky', top: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <div className="glass-card" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                <h3 style={{ fontSize: '1.2rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                                    <span>🖨️ معاينة البون الحراري</span>
                                </h3>

                                <div className="thermal-receipt-simulator">
                                    <div className="header">
                                        <div className="title">مطعم أبو خاطر</div>
                                        <div className="subtitle">إدارة وتوصيل الطلبات</div>
                                        <div className="dashed-line"></div>
                                        <div className="bold" style={{ fontSize: '15px' }}>فاتورة رقم #{previewOrder.originalId || previewOrder.id}</div>
                                    </div>

                                    <div style={{ fontSize: '11px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                        <div><strong>التاريخ:</strong> {new Date(previewOrder.timestamp || Date.now()).toLocaleString('ar-EG')}</div>
                                        <div><strong>العميل:</strong> {previewOrder.customerName || 'عميل'}</div>
                                        <div><strong>الهاتف:</strong> {previewOrder.phone || 'غير مسجل'}</div>
                                        {previewOrder.area && <div><strong>العنوان:</strong> {previewOrder.area}</div>}
                                        <div><strong>الدفع:</strong> {previewOrder.paymentMethod || 'كاش'}</div>
                                        {previewOrder.pilotId && (
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
                                                {previewOrder.items.map((item, idx) => (
                                                    <tr key={idx} style={{ borderBottom: '1px solid #eee' }}>
                                                        <td>{item.name}</td>
                                                        <td style={{ textAlign: 'center' }}>{item.count || item.quantity || 1}</td>
                                                        <td style={{ textAlign: 'left' }}>{((item.count || item.quantity || 1) * (item.price || 0))} ج</td>
                                                    </tr>
                                                ))}
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
                                        {previewOrder.deliveryFee > 0 && (
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
                                        className="btn-primary hover-scale"
                                        style={{ background: 'var(--accent)', color: 'white', fontWeight: 'bold', fontSize: '0.85rem', padding: '10px' }}
                                    >
                                        📄 طباعة العميل
                                    </button>
                                    <button
                                        onClick={() => handlePrint(previewOrder)}
                                        className="btn-primary hover-scale"
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

            {/* 🚚 رحلات الدليفري الحالية */}
            {(userRole === 'admin' || userRole === 'casher' || userRole === 'driver') && (
                <div className="glass-card" style={{ borderTop: '4px solid var(--primary)', padding: '0', marginTop: '24px' }}>
                    <div style={{ padding: '20px', borderBottom: '1px solid var(--border)' }}>
                        <h3 className="flex" style={{ fontSize: '1.2rem', margin: 0, gap: '8px', alignItems: 'center' }}>
                            <MapPin size={22} color="var(--primary)" /> رحلات الدليفري الحالية
                        </h3>
                    </div>

                    <div className="flex flex-wrap" style={{ minHeight: '300px', gap: '0' }}>
                        {/* Pilots List Side */}
                        <div style={{ width: '100%', maxWidth: '280px', borderLeft: '1px solid var(--border)', padding: '20px' }}>
                            <h4 style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '16px' }}>الطيارين في الخارج:</h4>
                            <div className="grid" style={{ gap: '8px' }}>
                                {pilotsWithOrders.length === 0 ? (
                                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>لا يوجد طيارين في الخارج حالياً</p>
                                ) : (
                                    pilotsWithOrders.map(p => (
                                        <button
                                            key={p.id}
                                            onClick={() => setViewPilotId(p.id)}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'space-between',
                                                padding: '12px',
                                                borderRadius: '12px',
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
                                            <span style={{ fontSize: '0.75rem', background: 'rgba(0,0,0,0.2)', padding: '2px 8px', borderRadius: '6px' }}>
                                                {ordersByPilot[p.id]?.length || 0}
                                            </span>
                                        </button>
                                    ))
                                )}
                            </div>
                        </div>

                        {/* Orders Table Side */}
                        <div style={{ flex: 1, minWidth: '300px', padding: '20px', overflowX: 'auto' }}>
                            {viewPilotId && ordersByPilot[viewPilotId] ? (
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.95rem' }}>
                                    <thead>
                                        <tr style={{ textAlign: 'right', color: 'var(--text-muted)', borderBottom: '2px solid var(--border)' }}>
                                            <th style={{ padding: '12px 8px' }}>بون #</th>
                                            <th style={{ padding: '12px 8px' }}>العميل</th>
                                            <th style={{ padding: '12px 8px' }}>المنطقة</th>
                                            <th style={{ padding: '12px 8px' }}>الوقت</th>
                                            <th style={{ padding: '12px 8px', textAlign: 'center' }}>إجراء</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {ordersByPilot[viewPilotId].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)).map(order => {
                                            const elapsed = getElapsedTime(order.startTime || order.timestamp);
                                            const isDelayed = elapsed > 40;

                                            return (
                                                <tr key={order.id} style={{ borderBottom: '1px solid var(--border)', background: isDelayed ? 'rgba(239, 68, 68, 0.05)' : 'transparent' }}>
                                                    <td style={{ padding: '16px 8px' }}>
                                                        <span style={{ fontWeight: '800', color: 'var(--primary)' }}>#{order.originalId || order.id}</span>
                                                        <button onClick={() => onReedit(order)} style={{ background: 'none', border: 'none', padding: '4px', cursor: 'pointer', marginRight: '4px', opacity: 0.6 }}>✏️</button>
                                                    </td>
                                                    <td style={{ padding: '16px 8px' }}>
                                                        <p style={{ fontWeight: 'bold' }}>{order.customerName}</p>
                                                        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{order.total > 0 ? `${order.total} ج.م` : ''}</p>
                                                    </td>
                                                    <td style={{ padding: '16px 8px' }}>{order.area}</td>
                                                    <td style={{ padding: '16px 8px' }}>
                                                        <span style={{ color: isDelayed ? 'var(--danger)' : elapsed > 25 ? 'var(--warning)' : 'var(--accent)', fontWeight: 'bold' }}>
                                                            {elapsed} د
                                                        </span>
                                                    </td>
                                                    <td style={{ padding: '16px 8px' }}>
                                                        <div className="flex" style={{ justifyContent: 'center', gap: '8px' }}>
                                                            <button onClick={() => completeOrder(order.id)} style={{ padding: '6px 12px', background: 'var(--success)', border: 'none', color: 'white', fontSize: '0.85rem', borderRadius: '6px', cursor: 'pointer' }}>تسليم</button>
                                                            <button onClick={() => handleFailDelivery(order.id)} style={{ padding: '6px 8px', background: 'transparent', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: '6px', cursor: 'pointer' }}>❌</button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            ) : (
                                <div style={{ textAlign: 'center', padding: '80px', color: 'var(--text-muted)' }}>
                                    {pilotsWithOrders.length > 0 ? 'الرجاء اختيار طيار لعرض طلباته' : 'لا توجد رحلات نشطة حالياً'}
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
                            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            zIndex: 9999, backdropFilter: 'blur(10px)', padding: '40px'
                        }}
                    >
                        <motion.div
                            initial={{ scale: 0.8 }} animate={{ scale: 1 }} exit={{ scale: 0.8 }}
                            onClick={(e) => e.stopPropagation()}
                            style={{ position: 'relative', maxWidth: '90%', maxHeight: '90%' }}
                        >
                            <img src={previewImage} alt="Full view" style={{ maxWidth: '100%', maxHeight: '80vh', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)' }} />
                            <button onClick={() => setPreviewImage(null)} style={{ position: 'absolute', top: '-15px', right: '-15px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '50%', width: '30px', height: '30px', cursor: 'pointer' }}><X size={18} /></button>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default OrderInbox;
