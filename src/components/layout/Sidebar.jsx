import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Home, Inbox, Users, BarChart3, Settings, Play, Square, UtensilsCrossed, KeyRound, LogOut, MessageSquare, Wifi, WifiOff } from 'lucide-react';
import { useApp } from '../../context/AppContext';

// 🟢 مصدر واحد لعناصر التنقل (يستخدمه الشريط الجانبي والشريط السفلي والعنوان العلوي)
// group: يحدد قسم العنصر في القائمة حسب النموذج الذهني للمستخدم
export const NAV_ITEMS = [
    { id: 'dashboard', label: 'الرئيسية', short: 'الرئيسية', icon: Home, roles: ['admin', 'casher'], group: null },
    { id: 'inbox', label: 'الطلبات', short: 'الطلبات', icon: Inbox, roles: ['admin', 'casher', 'driver'], group: 'التشغيل' },
    { id: 'pilots', label: 'الطيارين والورديات', short: 'الطيارين', icon: Users, roles: ['admin', 'casher'], group: 'التشغيل' },
    { id: 'reservations', label: 'حجز مطعم / كافيه', short: 'الحجوزات', icon: UtensilsCrossed, roles: ['casher'], group: 'الإدارة' },
    { id: 'feedback', label: 'الشكاوى والمقترحات', short: 'الشكاوى', icon: MessageSquare, roles: ['admin'], group: 'الإدارة' },
    { id: 'reports', label: 'التقارير والأرباح', short: 'التقارير', icon: BarChart3, roles: ['admin'], group: 'التقارير' },
    { id: 'settings', label: 'الإعدادات والأسعار', short: 'الإعدادات', icon: Settings, roles: ['admin'], group: 'النظام' },
];

// عدد الطلبات التي تحتاج إجراء (نفس المنطق السابق لشارة صندوق الوارد)
export const getActionCount = (orders) =>
    orders.filter(o => ['pending', 'pending_timer', 'waiting_driver'].includes(o.status)).length;

const Sidebar = ({ activeTab, setActiveTab, isSidebarOpen, closeSidebar, onOpenSecurity }) => {
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
    let lastGroup = null;

    const roleLabel = userRole === 'admin' ? 'مشرف النظام' : userRole === 'driver' ? 'كابتن التوصيل' : 'الكاشير';

    return (
        <nav className={`sidebar ${isSidebarOpen ? 'open' : ''}`} aria-label="القائمة الرئيسية">
            {/* Header Brand — مضغوط */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px', padding: '0 4px' }}>
                <div style={{
                    width: '44px', height: '44px', borderRadius: '50%', overflow: 'hidden', flexShrink: 0,
                    background: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                    <img src="/logo.png" alt="Abu Khater" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                </div>
                <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '0.95rem', fontWeight: '900', color: 'var(--text-main)' }}>توصيل أبو خاطر</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {roleLabel}{currentStaff?.display_name ? ` • ${currentStaff.display_name}` : ''}
                    </div>
                </div>
            </div>

            {/* Navigation Menu — مقسمة لمجموعات */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1 }}>
                {menuItems.map(item => {
                    const isActive = activeTab === item.id;
                    const showGroup = item.group && item.group !== lastGroup;
                    lastGroup = item.group;
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

            {/* 🌐 Network Status Indicator — مضغوط */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '6px 12px', fontSize: '0.78rem', fontWeight: '700',
                color: isOnline ? '#34d399' : '#f87171',
                margin: '12px 0 4px 0'
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
                                className="btn-primary"
                                style={{ width: '100%', background: 'var(--accent)', color: '#000', fontWeight: '800', minHeight: '44px' }}
                            >
                                <Play size={18} />
                                <span>فتح وردية جديدة</span>
                            </button>
                        ) : (
                            <button
                                onClick={() => setShowCloseShiftConfirm(true)}
                                className="btn-primary"
                                style={{ width: '100%', background: 'rgba(239, 68, 68, 0.15)', color: 'var(--danger)', border: '1px solid var(--danger)', fontWeight: '800', minHeight: '44px' }}
                            >
                                <Square size={16} />
                                <span>إغلاق الوردية</span>
                            </button>
                        )}
                    </div>
                )}

                {/* Logout + Security */}
                <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
                    <button
                        type="button"
                        onClick={async () => {
                            closeSidebar();
                            await logoutStaff();
                        }}
                        className="btn-primary"
                        style={{
                            flex: 1, background: 'rgba(255, 255, 255, 0.04)',
                            border: '1px solid var(--border)', color: 'var(--text-muted)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            gap: '6px', minHeight: '44px', fontSize: '0.85rem'
                        }}
                    >
                        <LogOut size={16} />
                        <span>خروج</span>
                    </button>

                    {userRole === 'admin' && (
                        <button
                            onClick={() => {
                                onOpenSecurity();
                                closeSidebar();
                            }}
                            className="btn-primary"
                            style={{
                                width: '44px',
                                minHeight: '44px',
                                background: 'rgba(255, 255, 255, 0.04)',
                                border: '1px solid var(--border)',
                                padding: 0,
                                flexShrink: 0
                            }}
                            title="إعدادات الأمان"
                            aria-label="إعدادات الأمان"
                        >
                            <KeyRound size={17} color="var(--accent)" />
                        </button>
                    )}
                </div>
            </div>

            {/* In-App Close Shift Confirmation Modal */}
            {showCloseShiftConfirm && createPortal((
                <div style={{
                    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    zIndex: 9999, backdropFilter: 'blur(8px)', padding: '16px'
                }}>
                    <div className="glass-card" style={{
                        width: '100%', maxWidth: '380px', padding: '24px',
                        background: '#131b2e', border: '1px solid rgba(239, 68, 68, 0.4)',
                        boxShadow: '0 20px 50px rgba(0,0,0,0.6)'
                    }}>
                        <h3 style={{ color: '#ef4444', margin: '0 0 10px 0', fontSize: '1.2rem', fontWeight: '800' }}>
                            إغلاق الوردية الحالية
                        </h3>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '20px' }}>
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
                                style={{ flex: 1, background: 'var(--danger)', color: '#fff', fontWeight: '800' }}
                            >
                                تأكيد الإغلاق
                            </button>
                            <button
                                onClick={() => setShowCloseShiftConfirm(false)}
                                style={{ flex: 0.6, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', borderRadius: '10px' }}
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
