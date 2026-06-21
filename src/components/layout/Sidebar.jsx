import React, { useState, useEffect } from 'react';
import { Home, Inbox, Users, BarChart3, Settings, Play, Square, PlusCircle, UtensilsCrossed, KeyRound, LogOut, MessageSquare, Wifi, WifiOff } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { safeGetItem } from '../../utils/safeStorage';


const Sidebar = ({ activeTab, setActiveTab, isSidebarOpen, closeSidebar, onOpenSecurity }) => {
    const { isShiftOpen, openShift, closeShift, orders, userRole, setUserRole, isThermalPrintMode, setIsThermalPrintMode } = useApp();

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
    // الأدمن بيشوف كل حاجة، الكاشير بيشوف كل حاجة ما عدا التقارير والشكاوى
    const allMenuItems = [
        { id: 'dashboard', label: 'الرئيسية', icon: Home, roles: ['admin', 'casher'] },
        {
            id: 'inbox', label: 'صندوق الوارد', icon: Inbox, roles: ['admin', 'casher', 'driver']
        },
        { id: 'pilots', label: 'الطيارين', icon: Users, roles: ['admin', 'casher'] },
        { id: 'reservations', label: 'حجز مطعم / كافيه', icon: UtensilsCrossed, roles: ['casher'], special: true },
        { id: 'feedback', label: 'الشكاوى والمقترحات', icon: MessageSquare, roles: ['admin'] },
        { id: 'reports', label: 'التقارير', icon: BarChart3, roles: ['admin'] },
    ];

    const menuItems = allMenuItems.filter(item => item.roles.includes(userRole));

    return (
        <div className={`sidebar ${isSidebarOpen ? 'open' : ''}`}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', marginBottom: '30px', textAlign: 'center' }}>
                <div style={{ width: '80px', height: '80px', borderRadius: '50%', overflow: 'hidden', border: `2px solid ${userRole === 'admin' ? 'var(--accent)' : '#10b981'}`, background: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <img src="/logo.png" alt="Abu Khater" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                </div>
                <h2 style={{ fontSize: '1.2rem', fontWeight: '800' }}>إدارة طيارين أبو خاطر</h2>

                {/* 🛡️ شارة المستخدم الحالي النشط */}
                <div
                    style={{ background: userRole === 'admin' ? 'rgba(59, 130, 246, 0.1)' : 'rgba(16, 185, 129, 0.1)', color: userRole === 'admin' ? '#60a5fa' : '#34d399', border: '1px solid currentColor', padding: '6px 16px', borderRadius: '20px', fontSize: '0.8rem', fontWeight: 'bold' }}
                >
                    {userRole === 'admin' ? '👑 مشرف النظام (Admin)' : '👤 الكاشير (Casher)'}
                </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {menuItems.map(item => (
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
                            padding: '12px 16px',
                            borderRadius: '12px',
                            border: 'none',
                            background: activeTab === item.id
                                ? (item.special ? '#8b5cf6' : 'var(--primary)')
                                : 'transparent',
                            color: activeTab === item.id ? 'white' : 'var(--text-muted)',
                            cursor: 'pointer',
                            transition: '0.2s',
                            textAlign: 'right',
                        }}
                    >
                        <item.icon size={20} />
                        <span style={{ fontWeight: '600' }}>{item.label}</span>
                        {item.id === 'inbox' && pendingCount > 0 && (
                            <div style={{
                                background: 'var(--danger)',
                                color: 'white',
                                fontSize: '0.7rem',
                                fontWeight: 'bold',
                                padding: '2px 8px',
                                borderRadius: '10px',
                                marginRight: 'auto',
                                boxShadow: '0 2px 5px rgba(239, 68, 68, 0.3)'
                            }}>
                                {pendingCount}
                            </div>
                        )}
                        {item.special && <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#fff', marginRight: item.id === 'inbox' ? '8px' : 'auto' }}></div>}
                    </button>
                ))}
            </div>

            {/* 🌐 مؤشر حالة الاتصال بالإنترنت */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '8px 12px', borderRadius: '10px',
                background: isOnline ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
                border: `1px solid ${isOnline ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)'}`,
                fontSize: '0.8rem', fontWeight: '600',
                color: isOnline ? '#34d399' : '#f87171',
                transition: 'all 0.4s'
            }}>
                {isOnline ? <Wifi size={14} /> : <WifiOff size={14} />}
                <span>{isOnline ? 'متصل بالإنترنت' : 'وضع بدون إنترنت'}</span>
                <div style={{
                    marginRight: 'auto', width: '7px', height: '7px', borderRadius: '50%',
                    background: isOnline ? '#10b981' : '#ef4444',
                    boxShadow: isOnline ? '0 0 6px #10b981' : '0 0 6px #ef4444',
                    animation: 'pulse 2s infinite'
                }} />
            </div>

            <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid var(--border)', paddingTop: '20px' }}>
                {/* ⚙️ إدارة الشيفت للمدير والكاشير */}
                {(userRole === 'admin' || userRole === 'casher') && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {!isShiftOpen ? (
                            <button
                                onClick={() => {
                                    const correctPwd = safeGetItem(`b_delivery_password_${userRole}`) || '8080';
                                    const pwd = prompt('أدخل كلمة المرور لفتح الوردية:');
                                    if (pwd === correctPwd) {
                                        openShift();
                                        closeSidebar();
                                    }
                                    else alert('كلمة مرور خاطئة');
                                }}
                                className="btn-primary"
                                style={{ width: '100%', background: 'var(--accent)' }}
                            >
                                <Play size={18} />
                                <span>فتح وردية جديدة</span>
                            </button>
                        ) : (
                            <button
                                onClick={async () => {
                                    try {
                                        if (!isShiftOpen) return;

                                        // 🔐 كلمة المرور
                                        const correctPwd = safeGetItem(`b_delivery_password_${userRole}`) || '8080';
                                        const pwd = prompt('أدخل كلمة المرور لإغلاق الوردية:');

                                        if (pwd === correctPwd) {
                                            await closeShift(false);
                                            closeSidebar();
                                        } else if (pwd !== null) {
                                            alert('كلمة مرور خاطئة');
                                        }

                                    } catch (error) {
                                        console.error('Close shift error:', error);
                                        alert('حدث خطأ أثناء إغلاق الوردية');
                                    }
                                }}
                                className="btn-primary"
                                style={{ width: '55%', background: 'var(--danger)' }}
                            >
                                <Square size={18} />
                                <span>إغلاق الوردية</span>
                            </button>
                        )}
                    </div>
                )}

                {/* 🖨️ زر تبديل وضع الطباعة الحرارية */}
                {/* <button
                    onClick={() => setIsThermalPrintMode(!isThermalPrintMode)}
                    className="btn-primary"
                    style={{
                        width: '100%',
                        background: isThermalPrintMode ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                        border: isThermalPrintMode ? '1px solid var(--accent)' : '1px solid var(--border)',
                        color: isThermalPrintMode ? 'white' : 'var(--text-muted)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        padding: '10px',
                        marginBottom: '8px'
                    }}
                >
                    <span style={{ filter: isThermalPrintMode ? 'none' : 'grayscale(100%)' }}>🖨️</span>
                    <span>{isThermalPrintMode ? 'وضع الطباعة: حراري 80مم' : 'وضع الطباعة: الشاشة العادي'}</span>
                </button> */}

                {/* 🚪 صف الأزرار السفلية (تسجيل الخروج + مفتاح الأمان الصغير للأدمن) */}
                <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
                    <button
                        onClick={() => {
                            if (confirm('هل أنت متأكد من تسجيل الخروج؟')) {
                                sessionStorage.removeItem('b_delivery_session_user');
                                setUserRole('');
                            }
                        }}
                        className="btn-primary"
                        style={{ flex: 1, background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', color: '#f87171', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '10px' }}
                    >
                        <LogOut size={18} />
                        <span>تبديل المستخدم</span>
                    </button>

                    {userRole === 'admin' && (
                        <button
                            onClick={() => {
                                onOpenSecurity();
                                closeSidebar();
                            }}
                            className="btn-primary"
                            style={{
                                width: '42px',
                                height: '42px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                background: 'rgba(255, 255, 255, 0.05)',
                                border: '1px solid var(--border)',
                                padding: 0,
                                flexShrink: 0
                            }}
                            title="إعدادات الأمان"
                        >
                            <KeyRound size={18} color="var(--accent)" />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default Sidebar;
