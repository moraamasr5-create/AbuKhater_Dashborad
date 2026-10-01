import React, { useState, useEffect } from 'react';
import { Home, Inbox, Users, BarChart3, Settings, Play, Square, PlusCircle, UtensilsCrossed, KeyRound, LogOut, MessageSquare, Wifi, WifiOff } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { safeGetItem } from '../../utils/safeStorage';


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

    const pendingCount = orders.filter(o => ['pending', 'pending_timer', 'waiting_driver'].includes(o.status)).length;

    // 🟢 تصفية القائمة بناءً على صلاحيات المستخدم
    const allMenuItems = [
        { id: 'dashboard', label: 'الرئيسية', icon: Home, roles: ['admin', 'casher'] },
        { id: 'inbox', label: 'صندوق الوارد', icon: Inbox, roles: ['admin', 'casher', 'driver'] },
        { id: 'pilots', label: 'إدارة الطيارين', icon: Users, roles: ['admin', 'casher'] },
        { id: 'reservations', label: 'حجز مطعم / كافيه', icon: UtensilsCrossed, roles: ['casher'], special: true },
        { id: 'feedback', label: 'الشكاوى والمقترحات', icon: MessageSquare, roles: ['admin'] },
        { id: 'reports', label: 'التقارير والأرباح', icon: BarChart3, roles: ['admin'] },
        { id: 'settings', label: 'الإعدادات والأسعار', icon: Settings, roles: ['admin'] },
    ];

    const menuItems = allMenuItems.filter(item => item.roles.includes(userRole));

    return (
        <div className={`sidebar ${isSidebarOpen ? 'open' : ''}`}>
            {/* Header Brand */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', marginBottom: '24px', textAlign: 'center' }}>
                <div style={{
                    width: '74px', height: '74px', borderRadius: '50%', overflow: 'hidden',
                    border: `2px solid ${userRole === 'admin' ? '#6366f1' : '#10b981'}`,
                    background: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: '0 4px 14px rgba(0,0,0,0.3)'
                }}>
                    <img src="/logo.png" alt="Abu Khater" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                </div>
                <h2 style={{ fontSize: '1.15rem', fontWeight: '900', margin: 0, color: 'var(--text-main)' }}>نظام توصيل أبو خاطر</h2>

                {/* Staff Role Pill */}
                <div
                    style={{
                        background: userRole === 'admin' ? 'rgba(99, 102, 241, 0.12)' : userRole === 'driver' ? 'rgba(245, 158, 11, 0.12)' : 'rgba(16, 185, 129, 0.12)',
                        color: userRole === 'admin' ? '#818cf8' : userRole === 'driver' ? '#fbbf24' : '#34d399',
                        border: `1px solid ${userRole === 'admin' ? '#6366f1' : userRole === 'driver' ? '#f59e0b' : '#10b981'}40`,
                        padding: '4px 14px',
                        borderRadius: '20px',
                        fontSize: '0.78rem',
                        fontWeight: '800',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '2px'
                    }}
                >
                    <span>
                        {userRole === 'admin' ? '👑 مشرف النظام (Admin)' : userRole === 'driver' ? '🛵 كابتن التوصيل (Driver)' : '👤 الكاشير (Casher)'}
                    </span>
                    {currentStaff?.display_name && (
                        <span style={{ fontSize: '0.7rem', opacity: 0.85, fontWeight: 'normal' }}>
                            {currentStaff.display_name}
                        </span>
                    )}
                </div>
            </div>

            {/* Navigation Menu */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 }}>
                {menuItems.map(item => {
                    const isActive = activeTab === item.id;
                    return (
                        <button
                            key={item.id}
                            onClick={() => {
                                setActiveTab(item.id);
                                closeSidebar();
                            }}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '12px',
                                padding: '12px 14px',
                                borderRadius: '10px',
                                border: isActive ? '1px solid rgba(255,255,255,0.15)' : '1px solid transparent',
                                background: isActive ? 'var(--primary)' : 'transparent',
                                color: isActive ? '#fff' : 'var(--text-muted)',
                                cursor: 'pointer',
                                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                                textAlign: 'right',
                                fontWeight: isActive ? '800' : '600',
                                fontSize: '0.9rem',
                                minHeight: '44px',
                                boxShadow: isActive ? '0 4px 14px rgba(99, 102, 241, 0.35)' : 'none'
                            }}
                        >
                            <item.icon size={19} />
                            <span style={{ flex: 1 }}>{item.label}</span>
                            {item.id === 'inbox' && pendingCount > 0 && (
                                <div style={{
                                    background: '#ef4444',
                                    color: 'white',
                                    fontSize: '0.72rem',
                                    fontWeight: '900',
                                    padding: '2px 8px',
                                    borderRadius: '10px',
                                    boxShadow: '0 2px 6px rgba(239, 68, 68, 0.4)'
                                }}>
                                    {pendingCount}
                                </div>
                            )}
                            {item.special && <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#8b5cf6' }}></div>}
                        </button>
                    );
                })}
            </div>

            {/* 🌐 Network Status Indicator */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '8px 12px', borderRadius: '10px',
                background: isOnline ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
                border: `1px solid ${isOnline ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)'}`,
                fontSize: '0.78rem', fontWeight: '700',
                color: isOnline ? '#34d399' : '#f87171',
                margin: '12px 0 8px 0'
            }}>
                {isOnline ? <Wifi size={14} /> : <WifiOff size={14} />}
                <span>{isOnline ? 'متصل بالإنترنت' : 'وضع بدون إنترنت'}</span>
                <div style={{
                    marginRight: 'auto', width: '7px', height: '7px', borderRadius: '50%',
                    background: isOnline ? '#10b981' : '#ef4444',
                    boxShadow: isOnline ? '0 0 6px #10b981' : '0 0 6px #ef4444'
                }} />
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
                        >
                            <KeyRound size={17} color="var(--accent)" />
                        </button>
                    )}
                </div>
            </div>

            {/* In-App Close Shift Confirmation Modal */}
            {showCloseShiftConfirm && (
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
            )}
        </div>
    );
};

export default Sidebar;
