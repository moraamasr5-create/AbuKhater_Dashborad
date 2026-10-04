import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Home, Inbox, Users, BarChart3, Settings, Play, Square, UtensilsCrossed, LogOut, MessageSquare, Wifi, WifiOff } from 'lucide-react';
import { useApp } from '../../context/AppContext';

// 🟢 مصدر واحد لعناصر التنقل (يستخدمه الشريط الجانبي والشريط السفلي والعنوان العلوي)
// group: يحدد قسم العنصر في القائمة حسب النموذج الذهني للمستخدم
export const NAV_ITEMS = [
    { id: 'dashboard', label: 'الرئيسية', short: 'الرئيسية', icon: Home, roles: ['admin', 'casher'], group: null },
    { id: 'inbox', label: 'صندوق الطلبات', short: 'الطلبات', icon: Inbox, roles: ['admin', 'casher', 'driver'], group: 'التشغيل' },
    { id: 'pilots', label: 'الطيارين والورديات', short: 'الطيارين', icon: Users, roles: ['admin', 'casher'], group: 'التشغيل' },
    { id: 'reservations', label: 'حجوزات المطعم', short: 'الحجوزات', icon: UtensilsCrossed, roles: ['admin', 'casher'], group: 'التشغيل' },
    { id: 'feedback', label: 'الشكاوى والمقترحات', short: 'الشكاوى', icon: MessageSquare, roles: ['admin'], group: 'الإدارة' },
    { id: 'reports', label: 'التقارير والأرباح', short: 'التقارير', icon: BarChart3, roles: ['admin'], group: 'التقارير' },
    { id: 'settings', label: 'الإعدادات والأسعار', short: 'الإعدادات', icon: Settings, roles: ['admin'], group: 'النظام' },
];

// عدد الطلبات التي تحتاج إجراء (مواءمة مع الحالات القياسية المعتمدة)
export const getActionCount = (orders) =>
    orders.filter(o => ['pending', 'pending_timer', 'preparing', 'waiting_driver', 'ready'].includes(o.status)).length;

const Sidebar = ({ activeTab, setActiveTab, isSidebarOpen, closeSidebar }) => {
    const { isShiftOpen, openShift, closeShift, orders, userRole, logoutStaff, currentStaff } = useApp();
    const [showCloseShiftConfirm, setShowCloseShiftConfirm] = useState(false);

    // مؤشر الاتصال: يتابع حالة الشبكة بدون أي مكتبة خارجية
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    useEffect(() => {
        const handleOnline = () => setIsOnline(true);
        const handleOffline = () => setIsOnline(false);
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    const pendingCount = getActionCount(orders);

    // 🟢 تصفية القائمة بناءً على صلاحيات المستخدم
    const menuItems = NAV_ITEMS.filter(item => item.roles.includes(userRole));

    const roleLabel = userRole === 'admin' ? 'مشرف النظام' : userRole === 'driver' ? 'كابتن التوصيل' : 'الكاشير';

    return (
        <nav className={`sidebar ${isSidebarOpen ? 'open' : ''}`} aria-label="القائمة الرئيسية">
            {/* Header Brand — مضغوط مع زر إغلاق للموبايل */}
            <div className="sidebar-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', marginBottom: '14px', padding: '0 4px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
                    <div style={{
                        width: '42px', height: '42px', borderRadius: '50%', overflow: 'hidden', flexShrink: 0,
                        background: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}>
                        <img src="/logo.png" alt="Abu Khater" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: '0.95rem', fontWeight: '900', color: 'var(--text-main)' }}>نظام أبو خاطر</div>
                        <div style={{ fontSize: '0.78rem', fontWeight: '700', color: 'var(--accent)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {roleLabel}{currentStaff?.display_name ? ` • ${currentStaff.display_name}` : (userRole === 'admin' ? ' • Admin 1' : '')}
                        </div>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={closeSidebar}
                    className="sidebar-close-btn"
                    aria-label="إغلاق القائمة"
                    title="إغلاق القائمة"
                >
                    ✕
                </button>
            </div>

            {/* Navigation Menu — مقسمة لمجموعات */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1 }}>
                {menuItems.map((item, index) => {
                    const isActive = activeTab === item.id;
                    const prevItem = index > 0 ? menuItems[index - 1] : null;
                    const showGroup = item.group && item.group !== prevItem?.group;
                    return (
                        <React.Fragment key={item.id}>
                            {showGroup && <div className="nav-group-label">{item.group}</div>}
                            <button
                                type="button"
                                aria-current={isActive ? 'page' : undefined}
                                className={`nav-item ${isActive ? 'is-active' : ''}`}
                                onClick={() => {
                                    setActiveTab(item.id);
                                    closeSidebar();
                                }}
                            >
                                <item.icon size={19} />
                                <span style={{ flex: 1 }}>{item.label}</span>
                                {item.id === 'inbox' && pendingCount > 0 && (
                                    <span className="nav-count" aria-label={`${pendingCount} طلب يحتاج إجراء`}>{pendingCount}</span>
                                )}
                            </button>
                        </React.Fragment>
                    );
                })}
            </div>

            {/* 🌐 Network Status Indicator */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '6px 12px', fontSize: '0.78rem', fontWeight: '800',
                color: isOnline ? '#34d399' : '#f87171',
                background: isOnline ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)',
                border: `1px solid ${isOnline ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)'}`,
                borderRadius: '10px',
                margin: '12px 0 6px 0',
                boxShadow: 'var(--highlight-top), var(--elevation-1)'
            }}>
                {isOnline ? <Wifi size={14} /> : <WifiOff size={14} />}
                <span>{isOnline ? 'متصل بالإنترنت' : 'وضع بدون إنترنت'}</span>
            </div>

            {/* Shift & Bottom Actions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid var(--border)', paddingTop: '14px' }}>
                {/* ⚙️ Shift Control */}
                {(userRole === 'admin' || userRole === 'casher') && (
                    <div>
                        {!isShiftOpen ? (
                            <button
                                onClick={() => {
                                    openShift();
                                    closeSidebar();
                                }}
                                className="btn-success"
                                style={{
                                    width: '100%',
                                    justifyContent: 'center',
                                    minHeight: '44px'
                                }}
                            >
                                <Play size={18} />
                                <span>فتح وردية جديدة</span>
                            </button>
                        ) : (
                            <button
                                onClick={() => setShowCloseShiftConfirm(true)}
                                className="btn-danger-outline"
                                style={{
                                    width: '100%',
                                    justifyContent: 'center',
                                    minHeight: '44px'
                                }}
                            >
                                <Square size={16} />
                                <span>إغلاق الوردية</span>
                            </button>
                        )}
                    </div>
                )}

                {/* Logout */}
                <div style={{ display: 'flex', width: '100%' }}>
                    <button
                        type="button"
                        onClick={async () => {
                            closeSidebar();
                            await logoutStaff();
                        }}
                        className="btn-secondary"
                        style={{
                            width: '100%',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            gap: '6px', minHeight: '44px', fontSize: '0.88rem'
                        }}
                    >
                        <LogOut size={16} />
                        <span>خروج</span>
                    </button>
                </div>
            </div>

            {/* In-App Close Shift Confirmation Modal */}
            {showCloseShiftConfirm && createPortal((
                <div style={{
                    position: 'fixed', inset: 0, background: 'rgba(4, 7, 14, 0.8)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    zIndex: 9999, backdropFilter: 'blur(10px)', padding: '16px'
                }}>
                    <div className="glass-card" style={{
                        width: '100%', maxWidth: '380px', padding: '24px',
                        background: 'linear-gradient(180deg, #162035 0%, #111827 100%)',
                        border: '1px solid rgba(239, 68, 68, 0.45)',
                        boxShadow: 'var(--highlight-top-strong), var(--elevation-5)',
                        borderRadius: '20px'
                    }}>
                        <h3 style={{ color: '#f87171', margin: '0 0 10px 0', fontSize: '1.25rem', fontWeight: '900' }}>
                            إغلاق الوردية الحالية
                        </h3>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '22px', lineHeight: '1.5' }}>
                            هل أنت متأكد من رغبتك في إغلاق الوردية الحالية واعتماد التقارير المالية؟
                        </p>
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <button
                                onClick={async () => {
                                    setShowCloseShiftConfirm(false);
                                    await closeShift(false);
                                    closeSidebar();
                                }}
                                className="btn-primary"
                                style={{
                                    flex: 1,
                                    background: 'linear-gradient(180deg, #ef4444 0%, #dc2626 100%)',
                                    color: '#fff',
                                    fontWeight: '800',
                                    boxShadow: 'var(--bevel-btn), 0 4px 14px var(--danger-glow)'
                                }}
                            >
                                تأكيد الإغلاق
                            </button>
                            <button
                                onClick={() => setShowCloseShiftConfirm(false)}
                                className="btn-secondary"
                                style={{ flex: 0.6 }}
                            >
                                تراجع
                            </button>
                        </div>
                    </div>
                </div>
            ), document.body)}
        </nav>
    );
};

export default Sidebar;
