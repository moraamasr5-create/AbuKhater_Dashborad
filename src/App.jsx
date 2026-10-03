// Developed & Owned by AmrMamdouh - 01038035884
import React, { useState, useEffect } from 'react';
import Sidebar, { NAV_ITEMS, getActionCount } from './components/layout/Sidebar';
import OrderInbox from './components/orders/OrderInbox';
import ReportsView from './components/reports/ReportsView';
import FeedbackView from './components/feedback/FeedbackView';
import SettingsView from './components/settings/SettingsView';
import Login from './components/auth/Login';
import ConnectionBanner from './components/common/ConnectionBanner';
import { StatusBadge, PageHeader, SectionHeader, Disclosure, EmptyState, MoreMenu, ToastHost, toast } from './components/common/ui';
import { useApp } from './context/AppContext';
import { Package, Bike, Clock, Plus, MapPin, AlertTriangle, AlertCircle, Receipt, Globe, Monitor, ChevronLeft, ChevronRight, ChevronDown, UtensilsCrossed, PlusCircle, Menu, Ruler, ShieldAlert, KeyRound, Trash2, Phone, Check, UserPlus, Copy, BarChart3 } from 'lucide-react';
import { supabase } from './services/supabase/supabaseClient';
import { uploadReservationReceipt, useSignedReceiptUrl } from './services/storageService';
import { isPilotOnDelivery } from './utils/pilotState';

export const processImageUpload = async (file, bucketName = 'payment-screenshots', folderPath = 'reservations') => {
  if (file.size > 5 * 1024 * 1024) {
    alert("حجم الصورة كبير جداً (أقصى حجم 5MB).");
    return null;
  }

  if (!navigator.onLine || !supabase) {
    alert("لا يوجد اتصال بالإنترنت لرفع الصورة. يرجى التحقق من اتصالك.");
    return null;
  }

  try {
    const publicUrl = folderPath === 'reservations'
      ? await uploadReservationReceipt(file)
      : null;

    if (publicUrl) {
      console.log("[Image] Uploaded to Supabase Storage");
      return publicUrl;
    }

    alert("حدث خطأ أثناء رفع الصورة. يرجى التحقق من اتصالك والمحاولة مرة أخرى.");
    return null;
  } catch (err) {
    console.error("[Image] Error uploading to Supabase:", err);
    alert("حدث خطأ أثناء رفع الصورة. يرجى التحقق من اتصالك والمحاولة مرة أخرى.");
    return null;
  }
};

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

const AREAS_METADATA = [
  // Zone 1: 0-3km (Base)
  { name: 'المطرية - الرئيسي', lat: 30.126, lng: 31.298, zone: 1, fee: 20 },
  { name: 'المسلة', lat: 30.132, lng: 31.302, zone: 1, fee: 20 },
  { name: 'مسطرد', lat: 30.141, lng: 31.295, zone: 1, fee: 25 },
  { name: 'الشارع الجديد', lat: 30.148, lng: 31.292, zone: 1, fee: 25 },

  // Zone 2: 3-7km
  { name: 'عين شمس', lat: 30.121, lng: 31.332, zone: 2, fee: 30 },
  { name: 'النعام', lat: 30.115, lng: 31.318, zone: 2, fee: 35 },
  { name: 'حلمية الزيتون', lat: 30.111, lng: 31.305, zone: 2, fee: 35 },
  { name: 'الأميرية', lat: 30.105, lng: 31.292, zone: 2, fee: 30 },
  { name: 'السواح', lat: 30.101, lng: 31.288, zone: 2, fee: 35 },

  // Zone 3: 7-10km
  { name: 'الخصوص', lat: 30.165, lng: 31.312, zone: 3, fee: 45 },
  { name: 'المرج', lat: 30.155, lng: 31.345, zone: 3, fee: 50 },
  { name: 'جسر السويس', lat: 30.115, lng: 31.365, zone: 3, fee: 55 },
  { name: 'مصر الجديدة', lat: 30.091, lng: 31.334, zone: 3, fee: 60 },

  // Zone 4: 10-15km
  { name: 'مدينة نصر', lat: 30.061, lng: 31.335, zone: 4, fee: 75 },
  { name: 'القلج', lat: 30.185, lng: 31.368, zone: 4, fee: 70 },
  { name: 'الخانكة', lat: 30.215, lng: 31.378, zone: 4, fee: 80 }
];

const MATAREYA_AREAS = AREAS_METADATA.map(a => a.name).concat(['اخرى (إدخال يدوي)']);

const MANAGERS = ['أ/عبـدالله', 'أ/فتحـي', 'مدير3', 'الفرع الثاني'];

const formatShift = (shiftStr) => {
  if (!shiftStr || shiftStr === 'غير محدد') return 'غير محدد';
  return shiftStr.split('-').map(t => {
    const time = t.trim();
    if (!time) return '';
    let [h, m] = time.split(':');
    if (!h || !m) return time;
    h = parseInt(h, 10);
    const suffix = h >= 12 ? 'م' : 'ص';
    h = h % 12 || 12;
    return `${h}:${m}${suffix}`;
  }).join(' - ');
};

// 🔐 مودال الرقم السري لتبديل حالة شيفت الطيار (بديل لـ prompt)
const PilotPinModal = ({ isOpen, onClose, onConfirm, pilotName, isClosing }) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 9999, backdropFilter: 'blur(8px)', padding: '16px'
    }}>
      <div className="glass-card" style={{
        width: '100%', maxWidth: '380px', padding: '24px',
        background: '#131b2e', border: '1px solid var(--border)',
        boxShadow: '0 20px 50px rgba(0,0,0,0.6)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
          <KeyRound size={22} color="var(--accent)" />
          <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: '800' }}>
            {isClosing ? `إغلاق شيفت ${pilotName}` : `فتح شيفت ${pilotName}`}
          </h3>
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '16px' }}>
          أدخل الرقم السري لتأكيد تغيير حالة الوردية:
        </p>

        <form onSubmit={(e) => {
          e.preventDefault();
          if (pin === '123') {
            onConfirm();
            setPin('');
            setError(false);
          } else {
            setError(true);
          }
        }}>
          <input
            autoFocus
            type="password"
            maxLength={6}
            placeholder="الرقم السري (123)"
            value={pin}
            onChange={(e) => { setPin(e.target.value); setError(false); }}
            style={{
              width: '100%', padding: '12px', textAlign: 'center', fontSize: '1.2rem',
              letterSpacing: '4px', background: 'rgba(0,0,0,0.3)', border: `1px solid ${error ? 'var(--danger)' : 'var(--border)'}`,
              borderRadius: '10px', color: 'white', marginBottom: error ? '6px' : '16px'
            }}
          />
          {error && <p style={{ color: '#ef4444', fontSize: '0.8rem', margin: '0 0 12px 0', textAlign: 'center', fontWeight: 'bold' }}>كلمة المرور غير صحيحة</p>}

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="submit"
              className="btn-primary"
              style={{ flex: 1, background: isClosing ? 'var(--danger)' : 'var(--accent)', color: isClosing ? '#fff' : '#000', fontWeight: '800' }}
            >
              {isClosing ? 'تأكيد الإغلاق' : 'تأكيد الفتح'}
            </button>
            <button
              type="button"
              onClick={() => { setPin(''); setError(false); onClose(); }}
              style={{ flex: 0.6, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', borderRadius: '10px' }}
            >
              إلغاء
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// 🗑️ مودال تأكيد حذف طيار
const DeletePilotModal = ({ isOpen, onClose, onConfirm, pilotName }) => {
  if (!isOpen) return null;
  return (
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#ef4444', marginBottom: '12px' }}>
          <AlertTriangle size={24} />
          <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: '800' }}>حذف الطيار</h3>
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '20px' }}>
          هل أنت متأكد من رغبتك في حذف بيانات الطيار <strong style={{ color: 'white' }}>{pilotName}</strong> من النظام نهائياً؟
        </p>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={onConfirm}
            className="btn-primary"
            style={{ flex: 1, background: 'var(--danger)', color: 'white', fontWeight: '800' }}
          >
            تأكيد الحذف
          </button>
          <button
            onClick={onClose}
            style={{ flex: 0.6, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', borderRadius: '10px' }}
          >
            تراجع
          </button>
        </div>
      </div>
    </div>
  );
};

const PilotManagement = () => {
  const { pilots, orders, togglePilotShift, addNewPilot, deletePilot, getSuggestedPilot, userRole } = useApp();
  const [filterTab, setFilterTab] = useState('all'); // 'all' | 'available' | 'on_delivery' | 'closed'
  const [showAddModal, setShowAddModal] = useState(false);
  const [pinModalData, setPinModalData] = useState(null); // { pilotId, pilotName, isClosing }
  const [deleteModalData, setDeleteModalData] = useState(null); // { pilotId, pilotName }
  const [newPilotName, setNewPilotName] = useState('');
  const [newPilotPhone, setNewPilotPhone] = useState('');
  const [newPilotStartShift, setNewPilotStartShift] = useState('01:00');
  const [newPilotEndShift, setNewPilotEndShift] = useState('11:00');
  const [newPilotIdNumber, setNewPilotIdNumber] = useState('');
  const [newPilotMotor, setNewPilotMotor] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [revealedPilots, setRevealedPilots] = useState({});

  const suggestedPilot = getSuggestedPilot();

  const handleReveal = (pilotId) => {
    if (revealedPilots[pilotId]) {
      setRevealedPilots(prev => ({ ...prev, [pilotId]: false }));
    } else {
      if (userRole === 'admin') {
        setRevealedPilots(prev => ({ ...prev, [pilotId]: true }));
      } else {
        alert('⚠️ عرض البيانات السرية متاح للمدير (Admin) فقط.');
      }
    }
  };

  const handleToggleShiftClick = (pilot) => {
    setPinModalData({
      pilotId: pilot.id,
      pilotName: pilot.name,
      isClosing: pilot.shiftStatus === 'open'
    });
  };

  const onAddPilot = async (e) => {
    e.preventDefault();
    if (!newPilotName || !newPilotPhone) return;

    setIsSubmitting(true);
    const result = await addNewPilot({
      name: newPilotName,
      phone: newPilotPhone,
      start_shift: newPilotStartShift,
      end_shift: newPilotEndShift,
      number_id: newPilotIdNumber,
      number_motor: newPilotMotor
    });
    setIsSubmitting(false);

    if (result && result.success) {
      setShowAddModal(false);
      setNewPilotName('');
      setNewPilotPhone('');
      setNewPilotStartShift('01:00');
      setNewPilotEndShift('11:00');
      setNewPilotIdNumber('');
      setNewPilotMotor('');
    } else {
      alert('❌ ' + (result?.error || 'حدث خطأ أثناء الإضافة'));
    }
  };

  // Counts
  const activePilots = pilots.filter(p => p.shiftStatus === 'open');
  const availablePilots = activePilots.filter(p => p.state === 'available');
  const onDeliveryPilots = activePilots.filter(p => isPilotOnDelivery(p.state));
  const closedPilots = pilots.filter(p => p.shiftStatus !== 'open');

  // Filtered pilots
  const filteredPilots = pilots.filter(p => {
    if (filterTab === 'available') return p.shiftStatus === 'open' && p.state === 'available';
    if (filterTab === 'on_delivery') return p.shiftStatus === 'open' && isPilotOnDelivery(p.state);
    if (filterTab === 'closed') return p.shiftStatus !== 'open';
    return true;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* 🚀 Header & Summary */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: '900', margin: '0 0 4px 0', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span>إدارة أسطول الطيارين</span>
          </h1>
          <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: '0.9rem' }}>
            متابعة حالة الطيارين، جاهزية الدور العادل، وساعات العمل المعتمدة
          </p>
        </div>

        {userRole === 'admin' && (
          <button
            onClick={() => setShowAddModal(true)}
            className="btn-primary"
            style={{ background: 'var(--accent)', color: '#000', fontWeight: '800', minHeight: '44px' }}
          >
            <Plus size={18} />
            <span>إضافة طيار جديد</span>
          </button>
        )}
      </header>

      {/* ⭐ Suggested Next Pilot Banner */}
      {suggestedPilot && (
        <div className="glass-card" style={{
          padding: '14px 20px',
          borderRight: '5px solid var(--accent)',
          background: 'rgba(16, 185, 129, 0.08)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '10px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '1.2rem' }}>⭐</span>
            <div>
              <div style={{ fontSize: '0.95rem', fontWeight: '800', color: '#34d399' }}>
                الطيار التالي في الدور العادل (Fair Queue): <strong>{suggestedPilot.name}</strong>
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                متاح بالمطعم وجاهز لاستلام الأوردر القادم فوراً
              </div>
            </div>
          </div>
          <div style={{ fontSize: '0.8rem', background: 'rgba(16, 185, 129, 0.2)', color: '#34d399', padding: '4px 10px', borderRadius: '8px', fontWeight: 'bold' }}>
            مكتمل اليوم: {suggestedPilot.ordersCount || 0} طلبات
          </div>
        </div>
      )}

      {/* 🧭 Filter Tabs */}
      <div className="glass-card tab-strip" style={{ padding: '8px 12px', display: 'flex', gap: '8px' }}>
        {[
          { id: 'all', label: 'الجميع', count: pilots.length, color: '#6366f1' },
          { id: 'available', label: 'متاح بالمطعم 🟢', count: availablePilots.length, color: '#10b981' },
          { id: 'on_delivery', label: 'في توصيل 🛵', count: onDeliveryPilots.length, color: '#3b82f6' },
          { id: 'closed', label: 'شيفت مغلق ⚪', count: closedPilots.length, color: '#64748b' }
        ].map(tab => {
          const isActive = filterTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setFilterTab(tab.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 16px',
                borderRadius: '10px',
                border: `1px solid ${isActive ? tab.color : 'transparent'}`,
                background: isActive ? `${tab.color}20` : 'transparent',
                color: isActive ? '#fff' : 'var(--text-muted)',
                fontWeight: isActive ? '800' : '600',
                fontSize: '0.85rem',
                minHeight: '40px',
                cursor: 'pointer'
              }}
            >
              <span>{tab.label}</span>
              <span style={{
                padding: '2px 8px',
                borderRadius: '8px',
                fontSize: '0.75rem',
                background: isActive ? tab.color : 'rgba(255,255,255,0.08)',
                color: isActive ? '#fff' : 'var(--text-main)',
                fontWeight: '800'
              }}>
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* 🛵 Pilots Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' }}>
        {filteredPilots.length === 0 ? (
          <div className="glass-card" style={{ gridColumn: '1/-1', padding: '60px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
            <Bike size={48} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
            <p style={{ margin: 0, fontSize: '0.95rem' }}>لا يوجد طيارين مسجلين في هذا القسم</p>
          </div>
        ) : (
          filteredPilots.map(pilot => {
            const isOpen = pilot.shiftStatus === 'open';
            const isOut = isOpen && isPilotOnDelivery(pilot.state);
            const currentLoad = orders.filter(o =>
              String(o.pilotId || o.deliveryId) === String(pilot.id) &&
              (o.status === 'active' || o.status === 'driver_assigned')
            ).length;

            let borderTopColor = '#64748b';
            let statusText = 'الشيفت مغلق ⚪';
            let statusBg = 'rgba(255,255,255,0.05)';
            let statusColor = 'var(--text-muted)';

            if (isOpen) {
              if (isOut) {
                borderTopColor = '#3b82f6';
                statusText = `خارج للتوصيل 🛵 (${currentLoad} طلبات)`;
                statusBg = 'rgba(59, 130, 246, 0.15)';
                statusColor = '#60a5fa';
              } else {
                borderTopColor = '#10b981';
                statusText = 'متاح في المطعم 🟢';
                statusBg = 'rgba(16, 185, 129, 0.15)';
                statusColor = '#34d399';
              }
            }

            return (
              <div
                key={pilot.id}
                className="glass-card hover-scale"
                style={{
                  padding: '18px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                  borderTop: `4px solid ${borderTopColor}`,
                  justifyContent: 'space-between'
                }}
              >
                {/* 1. Header: Name, Direct Phone & Actions */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <h3 style={{ fontSize: '1.15rem', fontWeight: '800', margin: 0, color: 'var(--text-main)' }}>
                      {pilot.name}
                    </h3>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <a
                        href={`tel:${pilot.phone}`}
                        style={{
                          color: '#60a5fa', fontSize: '0.82rem', fontWeight: 'bold', textDecoration: 'none',
                          display: 'inline-flex', alignItems: 'center', gap: '4px',
                          background: 'rgba(59, 130, 246, 0.1)', padding: '4px 8px', borderRadius: '6px'
                        }}
                        title="اتصال مباشر"
                      >
                        <Phone size={13} />
                        <span>{pilot.phone}</span>
                      </a>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(pilot.phone);
                          toast('تم نسخ رقم الهاتف بنجاح 📋');
                        }}
                        style={{
                          background: 'rgba(255,255,255,0.06)', border: 'none', cursor: 'pointer',
                          padding: '4px 8px', borderRadius: '6px', fontSize: '0.75rem', color: 'var(--text-dim)'
                        }}
                        title="نسخ الرقم"
                      >
                        نسخ
                      </button>

                      {userRole === 'admin' && (
                        <button
                          type="button"
                          onClick={() => setDeleteModalData({ pilotId: pilot.id, pilotName: pilot.name })}
                          style={{
                            background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.25)',
                            color: 'var(--danger)', padding: '5px', borderRadius: '6px', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center'
                          }}
                          title="حذف الطيار"
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Level 1: Operational Status Pill & Workload */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginTop: '6px' }}>
                    <div style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '4px 10px',
                      borderRadius: '8px',
                      background: statusBg,
                      color: statusColor,
                      fontSize: '0.8rem',
                      fontWeight: '800',
                      border: `1px solid ${statusColor}40`
                    }}>
                      <span>{statusText}</span>
                    </div>

                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      مكتمل اليوم: <strong style={{ color: 'var(--accent)' }}>{pilot.ordersCount || 0}</strong>
                    </span>
                  </div>
                </div>

                {/* Level 2: Primary Action: Toggle Shift */}
                <button
                  type="button"
                  onClick={() => handleToggleShiftClick(pilot)}
                  className="btn-primary"
                  style={{
                    width: '100%',
                    minHeight: '44px',
                    justifyContent: 'center',
                    background: isOpen ? 'rgba(239, 68, 68, 0.15)' : 'var(--accent)',
                    color: isOpen ? 'var(--danger)' : '#000',
                    border: `1px solid ${isOpen ? 'rgba(239, 68, 68, 0.3)' : 'var(--accent)'}`,
                    fontWeight: '800'
                  }}
                >
                  {isOpen ? 'إغلاق الشيفت' : 'فتح الشيفت 🟢'}
                </button>

                {/* Level 3: Details & Governance via Disclosure */}
                <Disclosure
                  title="البيانات والوردية"
                  meta={<span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Clock size={12} /> {formatShift(pilot.shift)}</span>}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.82rem', marginTop: '4px' }}>
                    <div className="kv-row">
                      <span>الوردية المجدولة:</span>
                      <strong>{formatShift(pilot.shift)}</strong>
                    </div>

                    <div className="kv-row">
                      <span>الطلبات المكتملة اليوم:</span>
                      <strong>{pilot.ordersCount || 0} طلب</strong>
                    </div>

                    <div style={{ borderTop: '1px dashed rgba(255,255,255,0.08)', paddingTop: '8px', marginTop: '2px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>البيانات الرسمية:</span>
                        <button
                          type="button"
                          onClick={() => handleReveal(pilot.id)}
                          style={{
                            background: 'transparent', border: 'none', color: '#818cf8',
                            fontSize: '0.75rem', fontWeight: 'bold', cursor: 'pointer', padding: 0
                          }}
                        >
                          {revealedPilots[pilot.id] ? 'إخفاء 🔒' : 'عرض الرقم القومي والموتوسيكل 🔑'}
                        </button>
                      </div>

                      {revealedPilots[pilot.id] && (
                        <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '4px', color: 'var(--text-main)' }}>
                          <div>رقم اللوحة: <strong>{pilot.numberMotor || 'غير مسجل'}</strong></div>
                          <div>الرقم القومي: <strong>{pilot.numberId || 'غير مسجل'}</strong></div>
                        </div>
                      )}
                    </div>
                  </div>
                </Disclosure>
              </div>
            );
          })
        )}
      </div>

      {/* 🔐 In-App PIN Modal */}
      <PilotPinModal
        isOpen={Boolean(pinModalData)}
        onClose={() => setPinModalData(null)}
        pilotName={pinModalData?.pilotName}
        isClosing={pinModalData?.isClosing}
        onConfirm={() => {
          if (pinModalData) {
            togglePilotShift(pinModalData.pilotId);
            setPinModalData(null);
          }
        }}
      />

      {/* 🗑️ Delete Pilot Modal */}
      <DeletePilotModal
        isOpen={Boolean(deleteModalData)}
        onClose={() => setDeleteModalData(null)}
        pilotName={deleteModalData?.pilotName}
        onConfirm={() => {
          if (deleteModalData) {
            deletePilot(deleteModalData.pilotId);
            setDeleteModalData(null);
          }
        }}
      />

      {/* ➕ Modal for Add Pilot */}
      {showAddModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, backdropFilter: 'blur(8px)', padding: '16px' }}>
          <div className="glass-card" style={{ padding: '24px', width: '100%', maxWidth: '400px', background: '#131b2e' }}>
            <h3 style={{ marginBottom: '16px', color: 'var(--accent)', fontWeight: '800', fontSize: '1.25rem' }}>إضافة طيار جديد</h3>
            <form onSubmit={onAddPilot} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <input
                autoFocus
                placeholder="اسم الطيار (مطلوب)"
                value={newPilotName}
                onChange={e => setNewPilotName(e.target.value)}
                style={{ padding: '12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'rgba(0,0,0,0.3)', color: 'white', minHeight: '44px' }}
                required
              />
              <input
                placeholder="رقم الهاتف (مطلوب)"
                value={newPilotPhone}
                onChange={e => setNewPilotPhone(e.target.value)}
                style={{ padding: '12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'rgba(0,0,0,0.3)', color: 'white', minHeight: '44px' }}
                required
              />
              <input
                placeholder="الرقم القومي (اختياري)"
                type="number"
                value={newPilotIdNumber}
                onChange={e => setNewPilotIdNumber(e.target.value)}
                style={{ padding: '12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'rgba(0,0,0,0.3)', color: 'white', minHeight: '44px' }}
              />
              <input
                placeholder="رقم لوحة الموتوسيكل (اختياري)"
                value={newPilotMotor}
                onChange={e => setNewPilotMotor(e.target.value)}
                style={{ padding: '12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'rgba(0,0,0,0.3)', color: 'white', minHeight: '44px' }}
              />
              <div style={{ display: 'flex', gap: '12px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>بداية الوردية</label>
                  <input
                    type="time"
                    value={newPilotStartShift}
                    onChange={e => setNewPilotStartShift(e.target.value)}
                    style={{ padding: '10px', borderRadius: '8px', border: '1px solid var(--border)', background: 'rgba(0,0,0,0.3)', color: 'white', width: '100%', minHeight: '44px' }}
                    required
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>نهاية الوردية</label>
                  <input
                    type="time"
                    value={newPilotEndShift}
                    onChange={e => setNewPilotEndShift(e.target.value)}
                    style={{ padding: '10px', borderRadius: '8px', border: '1px solid var(--border)', background: 'rgba(0,0,0,0.3)', color: 'white', width: '100%', minHeight: '44px' }}
                    required
                  />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                <button type="submit" disabled={isSubmitting} className="btn-primary" style={{ flex: 1, justifyContent: 'center', background: 'var(--accent)', color: '#000', fontWeight: '800' }}>
                  {isSubmitting ? 'جاري الإضافة...' : 'حفظ الطيار'}
                </button>
                <button type="button" onClick={() => setShowAddModal(false)} disabled={isSubmitting} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', padding: '10px', borderRadius: '8px', cursor: 'pointer', flex: 0.5 }}>إلغاء</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

const EditOrderModal = ({ order, onClose }) => {
  const { updateOrder } = useApp();
  const [formData, setFormData] = useState({ ...order });

  const handleSubmit = (e) => {
    e.preventDefault();
    updateOrder(order.id, formData);
    onClose();
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}>
      <div className="glass-card" style={{ padding: '24px', width: '400px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <h3>تعديل طلب #{order.id}</h3>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>رقم البون (ID)</label>
            <input className="glass-card" style={{ width: '100%', padding: '8px', color: 'white' }} value={formData.id} onChange={e => setFormData({ ...formData, id: e.target.value })} />
          </div>
          <div>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>العميل</label>
            <input className="glass-card" style={{ width: '100%', padding: '8px', color: 'white' }} value={formData.customerName} onChange={e => setFormData({ ...formData, customerName: e.target.value })} />
          </div>
          <div>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>الهاتف</label>
            <input className="glass-card" style={{ width: '100%', padding: '8px', color: 'white' }} value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })} />
          </div>
          <div>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>المنطقة</label>
            <select className="glass-card" style={{ width: '100%', padding: '8px', color: 'white', background: '#1e293b' }} value={formData.area} onChange={e => setFormData({ ...formData, area: e.target.value })}>
              {MATAREYA_AREAS.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>

          <div>
            <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>طريقة الدفع</label>
            <select
              className="glass-card"
              style={{ width: '100%', padding: '12px', marginTop: '4px', background: '#1e293b', color: 'white', border: '1px solid var(--border)', borderRadius: '8px' }}
              value={formData.paymentMethod}
              onChange={e => setFormData({ ...formData, paymentMethod: e.target.value })}
            >
              <option value="Cash">نقدي (Cash)</option>
              <option value="Online"> أنستاباي</option>
              <option value="Wallet">محفظة إلكترونية</option>
            </select>
          </div>

          {(formData.paymentMethod === 'Wallet') && (
            <div style={{ background: 'rgba(255,165,0,0.1)', padding: '12px', borderRadius: '8px', border: '1px dashed var(--warning)' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--warning)', marginBottom: '8px' }}>📸 صورة إيصال المحفظة (إجباري)</label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files[0];
                  if (file) {
                    const reader = new FileReader();
                    reader.onloadend = () => {
                      setFormData({ ...formData, paymentProof: reader.result });
                    };
                    reader.readAsDataURL(file);
                  }
                }}
                style={{ fontSize: '0.8rem', color: 'white' }}
              />
            </div>
          )}

          <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
            <button type="submit" className="btn-primary" style={{ flex: 1, justifyContent: 'center' }}>حفظ التعديلات</button>
            <button type="button" onClick={onClose} style={{ flex: 1, background: 'transparent', border: '1px solid var(--border)', color: 'white', cursor: 'pointer', borderRadius: '8px' }}>إلغاء</button>
          </div>
        </form>
      </div>
    </div>
  );
};

const DashboardView = ({ onNavigate, onOpenModal }) => {
  const { orders, pilots, currentShift, isShiftOpen, getSuggestedPilot, userRole, openShift } = useApp();

  // Helper to calculate elapsed minutes
  const getElapsedMinutes = (timestamp) => {
    if (!timestamp) return 0;
    const diffMs = Date.now() - new Date(timestamp).getTime();
    return Math.max(0, Math.floor(diffMs / 60000));
  };

  // 1. Level A: Needs Attention Now (يحتاج انتباهي الآن)
  const pendingOrders = orders.filter(o => ['pending', 'pending_timer'].includes(o.status));
  const waitingOrders = orders.filter(o => ['waiting_driver', 'preparing'].includes(o.status));
  const activeOrders = orders.filter(o => o.status === 'active');
  const delayedOrders = orders.filter(o =>
    ['pending', 'pending_timer', 'waiting_driver', 'driver_assigned', 'active'].includes(o.status) &&
    getElapsedMinutes(o.startTime || o.timestamp) >= 30
  );

  const hasUrgentIssues = pendingOrders.length > 0 || delayedOrders.length > 0 || waitingOrders.length > 0;

  // 2. Level B: Current Status (الوضع التشغيلي اللحظي)
  const activePilots = pilots.filter(p => p.shiftStatus === 'open');
  const availablePilots = activePilots.filter(p => p.state === 'available');
  const onDeliveryPilots = activePilots.filter(p => isPilotOnDelivery(p.state));
  const suggestedPilot = getSuggestedPilot();

  // Group active orders by pilot
  const ordersByPilot = activeOrders.reduce((acc, o) => {
    const key = String(o.pilotId || o.deliveryId);
    if (!acc[key]) acc[key] = [];
    acc[key].push(o);
    return acc;
  }, {});

  const pilotsWithOrders = pilots.filter(p => ordersByPilot[String(p.id)]);
  const completedCount = orders.filter(o => o.status === 'completed' || o.status === 'delivered').length;
  const cancelledCount = orders.filter(o => o.status === 'cancelled' || o.status === 'failed_delivery').length;

  // صفوف "يحتاج انتباهك" — كل صف: ماذا يحدث + الإجراء التالي
  const attentionRows = [
    pendingOrders.length > 0 && {
      key: 'pending', tone: 'warning', icon: <AlertCircle size={20} />,
      title: `${pendingOrders.length} طلب جديد بانتظار القبول`,
      hint: 'راجع الطلب ثم أرسله للمطبخ',
      action: 'مراجعة الطلبات', actionIcon: <Check size={18} />
    },
    delayedOrders.length > 0 && {
      key: 'delayed', tone: 'danger', icon: <Clock size={20} />,
      title: `${delayedOrders.length} طلب متأخر (أكثر من 30 دقيقة)`,
      hint: `${delayedOrders.map(o => `#${o.originalId || o.id}`).slice(0, 4).join('، ')}${delayedOrders.length > 4 ? ' …' : ''}`,
      action: 'متابعة المتأخر', actionIcon: <Clock size={18} />
    },
    waitingOrders.length > 0 && {
      key: 'waiting', tone: 'info', icon: <UserPlus size={20} />,
      title: `${waitingOrders.length} طلب جاهز بانتظار طيار`,
      hint: suggestedPilot
        ? `المقترح بالدور: ${suggestedPilot.name}`
        : 'لا يوجد طيار متاح — افتح وردية طيار أو انتظر عودة طيار',
      action: 'إسناد طيار', actionIcon: <UserPlus size={18} />
    }
  ].filter(Boolean);

  const toneColor = { warning: '#f59e0b', danger: '#ef4444', info: '#3b82f6' };

  const kpis = [
    { id: 'action', label: 'تحتاج إجراء', value: pendingOrders.length + waitingOrders.length, color: (pendingOrders.length + waitingOrders.length) > 0 ? '#fbbf24' : 'var(--text-main)', icon: <AlertCircle size={15} />, nav: 'inbox' },
    { id: 'active', label: 'في الطريق', value: activeOrders.length, color: '#93c5fd', icon: <MapPin size={15} />, nav: 'inbox' },
    { id: 'pilots', label: 'طيار متاح', value: availablePilots.length, color: availablePilots.length > 0 ? '#34d399' : '#f87171', icon: <Bike size={15} />, nav: 'pilots' },
    { id: 'today', label: 'طلبات اليوم', value: orders.length, color: 'var(--text-main)', icon: <Package size={15} />, nav: null },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* 🟥 الوردية مغلقة: الإجراء الأول الواضح */}
      {!isShiftOpen && (userRole === 'admin' || userRole === 'casher') && (
        <div className="glass-card" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap', borderRight: '4px solid var(--danger)' }}>
          <AlertTriangle size={22} color="#f87171" />
          <div style={{ flex: '1 1 220px' }}>
            <div style={{ fontWeight: 800 }}>الوردية مغلقة</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>افتح الوردية لبدء استقبال الطلبات وإسنادها.</div>
          </div>
          <button onClick={() => openShift()} className="btn-primary" style={{ background: 'var(--accent)', color: '#000', fontWeight: 800 }}>
            <span>فتح وردية جديدة</span>
          </button>
        </div>
      )}

      {/* ============================================================ */}
      {/* 🚨 المستوى الأول: ماذا يحتاج انتباهي الآن؟                     */}
      {/* ============================================================ */}
      <section aria-labelledby="attention-title">
        <SectionHeader
          icon={<AlertCircle size={20} color={hasUrgentIssues ? 'var(--warning)' : 'var(--accent)'} />}
          title={<span id="attention-title">يحتاج انتباهك الآن</span>}
        />

        {hasUrgentIssues ? (
          <div className="glass-card" style={{ padding: '4px 0', overflow: 'hidden' }}>
            {attentionRows.map((row, idx) => (
              <div
                key={row.key}
                className={row.key === 'delayed' ? 'pulse-urgent' : ''}
                style={{
                  display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap',
                  padding: '14px 18px',
                  borderTop: idx > 0 ? '1px solid var(--border)' : 'none',
                  borderRight: `4px solid ${toneColor[row.tone]}`
                }}
              >
                <span style={{ color: toneColor[row.tone], display: 'flex' }}>{row.icon}</span>
                <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: '0.98rem' }}>{row.title}</div>
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{row.hint}</div>
                </div>
                <button
                  onClick={() => onNavigate && onNavigate('inbox')}
                  className="btn-primary"
                  style={{ background: toneColor[row.tone], color: row.tone === 'warning' ? '#000' : '#fff', fontWeight: 800 }}
                >
                  {row.actionIcon}
                  <span>{row.action}</span>
                </button>
              </div>
            ))}
          </div>
        ) : (
          /* Calm Empty State */
          <div className="glass-card" style={{ padding: '18px 20px', display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
            <span style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'var(--accent-light)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Check size={22} />
            </span>
            <div style={{ flex: '1 1 220px' }}>
              <div style={{ fontWeight: 800, color: '#34d399' }}>لا يوجد ما يحتاج إجراء الآن</div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>كل الطلبات مقبولة أو مسندة أو تم تسليمها.</div>
            </div>
            <button onClick={() => onNavigate && onNavigate('inbox')} className="btn-secondary">
              عرض الطلبات
            </button>
          </div>
        )}
      </section>

      {/* ============================================================ */}
      {/* 📊 المستوى الثاني: ماذا يحدث الآن؟ (4 مؤشرات فقط)            */}
      {/* ============================================================ */}
      <section aria-label="الوضع التشغيلي">
        <SectionHeader icon={<Bike size={20} color="var(--primary)" />} title="الوضع الحالي" />
        <div className="kpi-grid">
          {kpis.map(k => {
            const content = (
              <>
                <span className="kpi-label">{k.icon}{k.label}</span>
                <span className="kpi-value" style={{ color: k.color }}>{k.value}</span>
              </>
            );
            return k.nav ? (
              <button key={k.id} type="button" className="kpi-card" onClick={() => onNavigate && onNavigate(k.nav)} aria-label={`${k.label}: ${k.value}`}>
                {content}
              </button>
            ) : (
              <div key={k.id} className="kpi-card">{content}</div>
            );
          })}
        </div>

        {/* 📈 المستوى الثالث: تفاصيل عند الطلب */}
        <Disclosure
          className="glass-card"
          title="إحصائيات إضافية"
          icon={<BarChart3 size={16} color="var(--text-muted)" />}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginTop: '4px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ fontWeight: 800, fontSize: '0.85rem' }}>أسطول التوصيل</div>
              <div className="kv-row"><span>متاح بالمطعم</span><strong>{availablePilots.length}</strong></div>
              <div className="kv-row"><span>في رحلات توصيل</span><strong>{onDeliveryPilots.length}</strong></div>
              <div className="kv-row"><span>غير متصلين (شيفت مغلق)</span><strong>{pilots.length - activePilots.length}</strong></div>
              <div className="kv-row"><span>التالي بالدور</span><strong>{suggestedPilot ? suggestedPilot.name : 'لا يوجد'}</strong></div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ fontWeight: 800, fontSize: '0.85rem' }}>الرحلات بالخارج</div>
              {pilotsWithOrders.length > 0 ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {pilotsWithOrders.map(p => (
                    <StatusBadge key={p.id} tone="info">{p.name}: {ordersByPilot[p.id]?.length || 0} طلب</StatusBadge>
                  ))}
                </div>
              ) : (
                <span style={{ fontSize: '0.85rem', color: 'var(--text-dim)' }}>لا توجد رحلات نشطة حالياً</span>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ fontWeight: 800, fontSize: '0.85rem' }}>طلبات اليوم</div>
              <div className="kv-row"><span>مكتمل</span><strong style={{ color: '#34d399' }}>{completedCount}</strong></div>
              <div className="kv-row"><span>ملغي / تعذر</span><strong style={{ color: '#f87171' }}>{cancelledCount}</strong></div>
              {isShiftOpen && currentShift?.date && (
                <div className="kv-row"><span>تاريخ الوردية</span><strong>{currentShift.date}</strong></div>
              )}
              <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>تحديث لحظي وتلقائي</div>
            </div>
          </div>
        </Disclosure>
      </section>
    </div>
  );
};

const SIMPLE_MENU = {
  'سندوتشات': ['أسبايسي', 'بدون تومية', 'بدون شطة', 'بدون سلطة', 'بدون طحينة', 'بدون أضافات'],
  'مشويات': ['سوي زيادة'],
  'مقبلات': ['بطاطس محمرة', 'كول سلو', 'ثومية', 'طحينة', 'مخلل'],
  'مشروبات': ['بيبسي', 'سفن اب', 'مياه معدنية', 'عصير']
};

// Helper requested to sync pricing, assumes global existence or defaults to base tier logic
const getDeliveryFee = typeof window.getDeliveryFee === 'function' ? window.getDeliveryFee : (routeDistanceKm) => {
  if (routeDistanceKm <= 3) return 20;
  if (routeDistanceKm <= 7) return 30;
  if (routeDistanceKm <= 10) return 45;
  if (routeDistanceKm <= 15) return 70;
  return 80;
};

const ManualOrderForm = ({ onClose, initialData }) => {
  const { addOrder } = useApp();
  const [isCompressing, setIsCompressing] = useState(false);
  const [formData, setFormData] = useState(initialData?.formData || {
    receiptNo: '', customerName: '', phone: '', area: '',
    lat: null, lng: null, zone: null, distance: 0,
    route_distance_km: null, route_duration_minutes: null, calculated_by: 'manual',
    customArea: '', total: 0, deliveryFee: 20, itemsDescription: '',
    paymentMethod: 'Cash', paymentReceiptFile: null, paymentProofPreview: null
  });
  const [selectedItems, setSelectedItems] = useState(initialData?.selectedItems || {});
  const [activeCategory, setActiveCategory] = useState('سندوتشات');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [areaSearch, setAreaSearch] = useState('');
  const [showAreaSuggestions, setShowAreaSuggestions] = useState(false);
  const [onlineSuggestions, setOnlineSuggestions] = useState([]);
  const [isSearchingOnline, setIsSearchingOnline] = useState(false);

  // Helper for online search
  const handleOnlineSearch = async (query) => {
    setAreaSearch(query);
    setShowAreaSuggestions(true);

    if (!navigator.onLine || !query) {
      setOnlineSuggestions([]);
      return;
    }

    setIsSearchingOnline(true);
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&viewbox=31.1,30.0,31.5,30.3&bounded=1`);
      if (res.ok) {
        const data = await res.json();
        setOnlineSuggestions(data);
      } else {
        setOnlineSuggestions([]);
      }
    } catch (e) {
      console.error("Nominatim search failed:", e);
    }
    setIsSearchingOnline(false);
  };

  const selectOnlineAddress = async (place) => {
    const lat = parseFloat(place.lat);
    const lon = parseFloat(place.lon);
    const mainStreet = place.display_name.split(',')[0];
    setAreaSearch(mainStreet);
    setShowAreaSuggestions(false);

    try {
      // OSRM Routing
      const osrmRes = await fetch(`https://router.project-osrm.org/route/v1/driving/${RESTAURANT_COORDS.lng},${RESTAURANT_COORDS.lat};${lon},${lat}?overview=false`);
      if (osrmRes.ok) {
        const osrmData = await osrmRes.json();
        if (osrmData.code === 'Ok') {
          const routeDistanceKm = +(osrmData.routes[0].distance / 1000).toFixed(2);
          const routeDurationMin = Math.ceil(osrmData.routes[0].duration / 60);
          const fee = getDeliveryFee(routeDistanceKm);

          setFormData({
            ...formData,
            area: mainStreet,
            customArea: place.display_name,
            lat: lat,
            lng: lon,
            distance: routeDistanceKm,
            route_distance_km: routeDistanceKm,
            route_duration_minutes: routeDurationMin,
            deliveryFee: fee,
            calculated_by: 'osrm'
          });
          return;
        }
      }
    } catch (e) {
      console.error("OSRM routing failed:", e);
    }

    // Fallback if OSRM fails
    const haversineDist = calculateDistance(RESTAURANT_COORDS.lat, RESTAURANT_COORDS.lng, lat, lon);
    setFormData({
      ...formData,
      area: mainStreet,
      customArea: place.display_name,
      lat: lat,
      lng: lon,
      distance: haversineDist,
      route_distance_km: haversineDist,
      route_duration_minutes: Math.ceil(haversineDist * 3),
      deliveryFee: getDeliveryFee(haversineDist),
      calculated_by: 'haversine_fallback'
    });
  };

  const isOutsideRadius = formData.distance > 15;

  const deliveryFees = Array.from({ length: 17 }, (_, i) => 20 + i * 5);

  const handleAddItem = (item) => setSelectedItems(prev => ({ ...prev, [item]: (prev[item] || 0) + 1 }));
  const handleRemoveItem = (item) => {
    setSelectedItems(prev => {
      const active = { ...prev };
      if (active[item] > 1) active[item] -= 1; else delete active[item];
      return active;
    });
  };

  const printKitchenTicket = () => {
    if (!formData.receiptNo) return alert('أدخل رقم البون للطباعة');
    const printWindow = window.open('', '_blank', 'width=400,height=600');
    if (!printWindow) return;

    const htmlContent = `
      <!DOCTYPE html>
      <html dir="rtl">
      <head>
        <meta charset="utf-8">
        <title>Kitchen Ticket #${formData.receiptNo}</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@600;800;900&display=swap');
          @page {
            size: 80mm auto;
            margin: 0;
          }
          @media print {
            html, body {
              width: 80mm;
              margin: 0;
              padding: 0;
              background: #fff;
              color: #000;
            }
            body, html, .receipt-container {
              height: auto !important;
              min-height: 0 !important;
              max-height: none !important;
              overflow: visible !important;
            }
            .header, .items, .footer {
              page-break-inside: avoid !important;
              break-inside: avoid !important;
            }
          }
          * {
            box-sizing: border-box;
          }
          body {
            font-family: 'Cairo', sans-serif;
            margin: 0;
            padding: 2mm 4mm;
            width: 72mm;
            color: #000;
            background: #fff;
            font-size: 13px;
            line-height: 1.4;
          }
          .header { text-align: center; border-bottom: 2px dashed #000; padding-bottom: 8px; margin-bottom: 8px; }
          .title { font-size: 18px; font-weight: 900; margin: 0; }
          .subtitle { font-size: 12px; font-weight: 800; margin: 2px 0; }
          .items { border-bottom: 2px dashed #000; padding-bottom: 8px; margin-bottom: 8px; text-align: right; }
          .item-row { display: flex; justify-content: space-between; font-weight: bold; font-size: 14px; margin-bottom: 4px; }
          .footer { text-align: center; font-size: 11px; font-weight: bold; margin-top: 10px; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="title">بون المطبخ (DRAFT)</div>
          <div class="subtitle">رقم الطلب: #${formData.receiptNo}</div>
        </div>
        <div style="font-size: 12px; margin-bottom: 8px; text-align: right;">
          <div>اسم العميل: ${formData.customerName || 'عميل خارجي'}</div>
          <div>رقم العميل: ${formData.phone || 'عميل خارجي'}</div>
          <div>العنوان: ${formData.customArea || 'عنوان مجهول '}</div>
          <div>الدفع : ${formData.paymentMethod || ' طريقه الدفع '}</div>
          <div>إجمالي الطلب: ${formData.total || ' إجمالي '}</div>
          <div> خدمة التوصيل: ${formData.deliveryFee || ' إجمالي '}</div>
          <div> العناصر : ${formData.itemsDescription || ' إجمالي '}</div>
          <div>التاريخ: ${new Date().toLocaleDateString('ar-EG')} | الوقت: ${new Date().toLocaleTimeString('ar-EG')}</div>
        </div>
        <div class="items">
          ${Object.entries(selectedItems).map(([n, c]) => `
            <div class="item-row">
              <span>${n}</span>
              <span>x${c}</span>
            </div>
          `).join('')}
          ${formData.itemsDescription ? `<div style="font-size: 12px; font-style: italic; color: #555; margin-top: 4px; border-top: 1px dotted #ccc; padding-top: 4px;">ملاحظات: ${formData.itemsDescription}</div>` : ''}
        </div>
        <div class="footer">أبو خاطر للتوصيل • مسودة مطبخ</div>
        <script>
          window.addEventListener('DOMContentLoaded', () => {
            window.addEventListener('load', () => {
              setTimeout(() => {
                window.print();
                setTimeout(() => {
                  window.close();
                }, 500);
              }, 300);
            });
          });
        </script>
      </body>
      </html>
    `;
    printWindow.document.write(htmlContent);
    printWindow.document.close();
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.receiptNo) return alert('رقم البون مطلوب');
    const itemsList = Object.entries(selectedItems).map(([name, count]) => ({ name, count }));
    addOrder({
      id: formData.receiptNo, type: 'restaurant', customerName: formData.customerName || "عميل مطعم",
      phone: formData.phone, area: formData.area || "المطرية",
      lat: formData.lat, lng: formData.lng,
      latitude: formData.lat, longitude: formData.lng, // added as requested
      total: 0, // Removed per request
      deliveryFee: Number(formData.deliveryFee),
      delivery_fee: Number(formData.deliveryFee), // added as requested
      source: 'manual', // 📞 طلب داخلي (كول سنتر)
      route_distance_km: formData.route_distance_km,
      route_duration_minutes: formData.route_duration_minutes,
      calculated_by: formData.calculated_by,
      itemsDescription: itemsList.map(i => `${i.count}x ${i.name}`).join(', ') + (formData.itemsDescription ? ` (${formData.itemsDescription})` : ''),
      items: itemsList, itemsCount: itemsList.reduce((acc, curr) => acc + curr.count, 0),
      paymentMethod: formData.paymentMethod,
      paymentReceiptFile: formData.paymentReceiptFile,
      status: formData.status || 'pending',
      reservation_date: formData.reservation_date || null,
      reservation_time: formData.reservation_time || null,
      guests_count: formData.guests_count || null,
      location_type: formData.location_type || null,
      notes: formData.notes || null,
    });
    onClose();
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(8px)', overflowY: 'auto', padding: '16px' }}>
      <div className="card" style={{ position: 'relative', width: isMenuOpen ? '1000px' : '500px', maxWidth: '100%', display: 'grid', gridTemplateColumns: isMenuOpen ? '1fr 1.8fr' : '1fr', gap: '24px', padding: '0', overflow: 'hidden' }}>
        <button onClick={() => setIsMenuOpen(!isMenuOpen)} style={{ position: 'absolute', left: '12px', top: '12px', background: 'var(--primary)', color: 'white', width: '36px', height: '36px', borderRadius: '10px', zIndex: 20 }}>
          {isMenuOpen ? <ChevronRight size={20} /> : <Menu size={20} />}
        </button>

        <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <h2 className="flex" style={{ fontSize: '1.2rem' }}><Monitor size={22} color="var(--primary)" /> تفاصيل الأوردر</h2>
          <div className="card" style={{ background: 'rgba(0,0,0,0.2)', padding: '16px', textAlign: 'center' }}>
            <label style={{ color: 'var(--primary)', fontWeight: 'bold', fontSize: '0.9rem', display: 'block', marginBottom: '8px' }}>رقم بون الكول سنتر</label>
            <input
              type="text"
              style={{ background: 'transparent', color: 'var(--primary)', border: '2px solid var(--primary)', borderRadius: '12px', width: '100%', padding: '12px', fontSize: '1.6rem', fontWeight: '900', textAlign: 'center' }}
              value={formData.receiptNo}
              onChange={e => setFormData({ ...formData, receiptNo: e.target.value })}
              required
              autoFocus
              placeholder="000"
            />
          </div>

          {/* 🧠 Smart Area Search (Autocomplete) */}
          <div style={{ position: 'relative' }}>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>📍 ابحث عن المنطقة</label>
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                placeholder="اكتب اسم المنطقة (مثلاً: المطرية)..."
                value={areaSearch}
                onChange={e => handleOnlineSearch(e.target.value)}
                onFocus={() => setShowAreaSuggestions(true)}
                style={{ background: 'var(--bg-dark)', color: 'white', padding: '14px', borderRadius: '12px', width: '100%', border: '1px solid var(--border)' }}
              />
              <MapPin size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--primary)', opacity: 0.5 }} />
              {isSearchingOnline && <div style={{ position: 'absolute', left: '40px', top: '50%', transform: 'translateY(-50%)', fontSize: '0.7rem', color: 'var(--accent)' }}>جاري البحث...</div>}
            </div>

            {showAreaSuggestions && areaSearch && (
              <div className="glass-card" style={{
                position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
                maxHeight: '280px', overflowY: 'auto', marginTop: '8px',
                border: '1px solid var(--border)', background: '#111827',
                boxShadow: '0 10px 25px rgba(0,0,0,0.5)'
              }}>
                {/* Online Nominatim Suggestions */}
                {navigator.onLine && onlineSuggestions.length > 0 && (
                  <div style={{ marginBottom: '10px' }}>
                    <div style={{ background: 'rgba(59, 130, 246, 0.1)', padding: '6px 16px', fontSize: '0.75rem', fontWeight: 'bold', color: '#3b82f6', borderBottom: '1px solid rgba(59, 130, 246, 0.2)' }}>
                      🌐 نتائج البحث المباشر
                    </div>
                    {onlineSuggestions.map(place => (
                      <div
                        key={place.place_id}
                        onClick={() => selectOnlineAddress(place)}
                        className="hover-scale"
                        style={{ padding: '12px 16px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', gap: '4px' }}
                      >
                        <span style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>{place.display_name.split(',')[0]}</span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{place.display_name}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Fallback Local Areas */}
                <div style={{ opacity: navigator.onLine ? 0.7 : 1 }}>
                  {[1, 2, 3, 4].map(zoneNum => {
                    const zoneAreas = AREAS_METADATA.filter(a => a.zone === zoneNum && a.name.includes(areaSearch));
                    if (zoneAreas.length === 0) return null;
                    return (
                      <div key={zoneNum}>
                        <div style={{ background: 'rgba(255,255,255,0.05)', padding: '6px 16px', fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--primary)' }}>
                          النطاق {zoneNum} (Zone {zoneNum}) {navigator.onLine && '- بحث يدوي'}
                        </div>
                        {zoneAreas.map(area => {
                          const dist = calculateDistance(RESTAURANT_COORDS.lat, RESTAURANT_COORDS.lng, area.lat, area.lng);
                          return (
                            <div
                              key={area.name}
                              onClick={() => {
                                setFormData({
                                  ...formData,
                                  area: area.name,
                                  lat: area.lat,
                                  lng: area.lng,
                                  zone: area.zone,
                                  distance: dist,
                                  deliveryFee: area.fee,
                                  calculated_by: 'manual'
                                });
                                setAreaSearch(area.name);
                                setShowAreaSuggestions(false);
                              }}
                              className="hover-scale"
                              style={{ padding: '12px 16px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between' }}
                            >
                              <div>
                                <span style={{ fontWeight: 'bold' }}>{area.name}</span>
                                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: '8px' }}>({dist} كم)</span>
                              </div>
                              <span style={{ fontSize: '0.8rem', color: 'var(--accent)' }}>{area.fee} ج.م</span>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Location Feedback Badges */}
          {formData.area && (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <div style={{ padding: '4px 10px', borderRadius: '8px', background: 'rgba(79, 70, 229, 0.1)', border: '1px solid var(--primary)', color: 'var(--primary)', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Ruler size={14} /> {formData.distance} كم
              </div>

              {formData.calculated_by === 'osrm' ? (
                <div style={{ padding: '4px 10px', borderRadius: '8px', background: 'rgba(59, 130, 246, 0.1)', border: '1px solid #3b82f6', color: '#3b82f6', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Clock size={14} /> وقت الرحلة: ~{formData.route_duration_minutes} دقيقة
                </div>
              ) : (
                <div style={{ padding: '4px 10px', borderRadius: '8px', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid var(--accent)', color: 'var(--accent)', fontSize: '0.75rem' }}>
                  نطاق التوصيل: {formData.zone || 'يدوي'}
                </div>
              )}

              {isOutsideRadius && (
                <div style={{ width: '100%', padding: '8px', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: '8px', marginTop: '8px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <ShieldAlert size={18} /> خارج نطاق التوصيل (أكثر من 15كم)
                </div>
              )}
            </div>
          )}

          <div className="grid" style={{ gap: '12px' }}>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '-4px' }}>💰 خدمة التوصيل (مثبتة حسب النطاق)</label>
            <input
              readOnly
              style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)', padding: '14px', borderRadius: '12px', border: '1px solid var(--border)', cursor: 'not-allowed' }}
              value={`${formData.deliveryFee} ج.م`}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block' }}>💳 طريقة الدفع</label>
            <div className="flex" style={{ gap: '8px' }}>
              {[
                { id: 'Cash', label: 'كاش', color: '#10b981' },
                { id: 'vodafone_cash', label: 'فودافون كاش', color: '#ef4444' },
                { id: 'instapay', label: 'انستا باى', color: '#8b5cf6' }
              ].map(method => (
                <button
                  key={method.id}
                  type="button"
                  onClick={() => setFormData({ ...formData, paymentMethod: method.id })}
                  style={{
                    flex: 1,
                    padding: '12px 8px',
                    borderRadius: '12px',
                    fontSize: '0.85rem',
                    fontWeight: 'bold',
                    border: '2px solid',
                    borderColor: formData.paymentMethod === method.id ? method.color : 'rgba(255,255,255,0.05)',
                    background: formData.paymentMethod === method.id ? `${method.color}15` : 'rgba(255,255,255,0.05)',
                    color: formData.paymentMethod === method.id ? method.color : 'var(--text-muted)',
                    transition: 'all 0.2s ease'
                  }}
                >
                  {method.label}
                </button>
              ))}
            </div>
          </div>

          {(formData.paymentMethod === 'vodafone_cash' || formData.paymentMethod === 'instapay') && (
            <div style={{
              background: 'rgba(255,255,255,0.03)',
              padding: '16px',
              borderRadius: '12px',
              border: '1px dashed var(--border)',
              textAlign: 'center'
            }}>
              <p style={{ fontSize: '0.85rem', marginBottom: '10px', color: 'var(--accent)', fontWeight: 'bold' }}>
                📸 صورة إيصال التحويل (إجباري)
              </p>
              <input
                required
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files[0];
                  if (file) {
                    if (formData.paymentProofPreview) {
                      URL.revokeObjectURL(formData.paymentProofPreview);
                    }
                    setFormData({
                      ...formData,
                      paymentReceiptFile: file,
                      paymentProofPreview: URL.createObjectURL(file)
                    });
                  }
                }}
                disabled={isCompressing}
                style={{ fontSize: '0.8rem', color: 'white', cursor: 'pointer' }}
              />
              {formData.paymentProofPreview && (
                <img
                  src={formData.paymentProofPreview}
                  alt="معاينة الإيصال"
                  style={{ marginTop: '12px', width: '100%', height: '80px', objectFit: 'cover', borderRadius: '8px', border: '2px solid var(--accent)' }}
                />
              )}
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '8px' }}>
                سيتم رفع الصورة تلقائياً بعد حفظ الطلب
              </p>
            </div>
          )}

          <div className="flex" style={{ gap: '12px', marginTop: '20px' }}>
            <button
              onClick={handleSubmit}
              disabled={
                isCompressing ||
                isOutsideRadius ||
                !formData.receiptNo ||
                !formData.area ||
                ((formData.paymentMethod === 'vodafone_cash' || formData.paymentMethod === 'instapay') && !formData.paymentReceiptFile)
              }
              className="btn-primary"
              style={{
                flex: 2, justifyContent: 'center', height: '50px', fontSize: '1.1rem',
                opacity: (isCompressing || isOutsideRadius || !formData.receiptNo || !formData.area || ((formData.paymentMethod === 'vodafone_cash' || formData.paymentMethod === 'instapay') && !formData.paymentReceiptFile)) ? 0.5 : 1,
                cursor: (isCompressing || isOutsideRadius || !formData.receiptNo || !formData.area || ((formData.paymentMethod === 'vodafone_cash' || formData.paymentMethod === 'instapay') && !formData.paymentReceiptFile)) ? 'not-allowed' : 'pointer'
              }}
            >
              {isCompressing ? "جاري المعالجة..." : "حفظ الأوردر"}
            </button>
            <button onClick={onClose} style={{ flex: 1, background: 'rgba(255,255,255,0.05)', color: 'white' }}>إلغاء</button>
          </div>
        </div>

        {isMenuOpen && (
          <div style={{ background: 'rgba(0,0,0,0.2)', padding: '24px', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <header className="flex" style={{ justifyContent: 'space-between' }}>
              <h3 style={{ fontSize: '1rem' }}>الأصناف للمطبخ</h3>
              <button onClick={printKitchenTicket} style={{ background: 'white', color: 'black', padding: '4px 12px', borderRadius: '8px' }}><Receipt size={16} /> طباعة</button>
            </header>
            <div className="flex" style={{ overflowX: 'auto', gap: '8px' }}>
              {Object.keys(SIMPLE_MENU).map(cat => (
                <button key={cat} onClick={() => setActiveCategory(cat)} style={{ padding: '6px 12px', borderRadius: '20px', background: activeCategory === cat ? 'var(--primary)' : 'rgba(255,255,255,0.05)', color: 'white' }}>{cat}</button>
              ))}
            </div>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '10px', maxHeight: '250px', overflowY: 'auto' }}>
              {SIMPLE_MENU[activeCategory].map(item => (
                <button key={item} onClick={() => handleAddItem(item)} style={{ padding: '10px', borderRadius: '10px', border: '1px solid var(--border)', background: selectedItems[item] ? 'rgba(79, 70, 229, 0.2)' : 'transparent', color: 'white' }}>
                  {item} {selectedItems[item] && `x${selectedItems[item]}`}
                </button>
              ))}
            </div>
            <textarea style={{ background: 'rgba(0,0,0,0.2)', color: 'white', padding: '12px', borderRadius: '10px', resize: 'none', minHeight: '60px' }} placeholder="ملاحظات المطبخ..." value={formData.itemsDescription} onChange={e => setFormData({ ...formData, itemsDescription: e.target.value })} />
          </div>
        )}
      </div>
    </div>
  );
};

const ExternalOrderForm = ({ onClose, initialData }) => {
  const { addOrder } = useApp();
  const [formData, setFormData] = useState(initialData?.formData || {
    receiptNo: '',
    platform: 'Talabat',
    customerName: 'عميل أبلكيشن',
    phone: '',
    deliveryFee: 20,
    area: MATAREYA_AREAS[0],
    paymentMethod: 'Cash',
    paymentProof: null
  });
  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.receiptNo) {
      alert('يجب إدخال رقم البون من المطبخ');
      return;
    }

    addOrder({
      id: formData.receiptNo,
      type: 'talabat',
      customerName: `${formData.customerName} (${formData.platform})`,
      phone: formData.phone || 'N/A',
      area: formData.area,
      total: 0, // Usually prepaid or separate
      deliveryFee: Number(formData.deliveryFee),
      source: 'talabat', // 📱 طلب خارجي عبر تابلت (طلبات)
      itemsDescription: `طلب ${formData.platform}`,
      itemsCount: 1,
      paymentMethod: formData.paymentMethod,
      paymentProof: formData.paymentProof
    });
    onClose();
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(8px)', padding: '16px' }}>
      <div className="card" style={{ width: '100%', maxWidth: '480px', border: '1px solid var(--accent)', padding: '32px' }}>
        <h3 className="flex" style={{ fontSize: '1.4rem', color: 'var(--accent)', borderBottom: '1px solid var(--border)', paddingBottom: '16px', marginBottom: '24px' }}>
          <Globe size={24} /> أوردر تطبيقات (Talabat)
        </h3>
        <form onSubmit={handleSubmit} className="grid" style={{ gap: '20px' }}>
          <div className="card" style={{ background: 'rgba(0,0,0,0.2)', padding: '16px', margin: 0 }}>
            <label style={{ display: 'block', marginBottom: '8px', color: 'var(--accent)', fontWeight: 'bold', fontSize: '0.9rem' }}>رقم الاوردر على التابلت</label>
            <input
              type="text"
              style={{ background: 'transparent', color: 'var(--accent)', border: '2px solid var(--accent)', borderRadius: '12px', width: '100%', padding: '12px', fontSize: '1.4rem', fontWeight: '900', textAlign: 'center' }}
              placeholder="#0000000"
              required
              autoFocus
              value={formData.receiptNo}
              onChange={e => setFormData({ ...formData, receiptNo: e.target.value })}
            />
          </div>

          <div className="grid-2" style={{ gap: '12px' }}>
            <div className="grid" style={{ gap: '8px' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>التطبيق</label>
              <select
                style={{ background: 'var(--bg-dark)', color: 'white', padding: '14px', border: '1px solid var(--border)', borderRadius: '12px', width: '100%' }}
                value={formData.platform}
                onChange={e => setFormData({ ...formData, platform: e.target.value })}
              >
                <option value="Talabat">Talabat</option>
                <option value="Noon">Noon Food</option>
                <option value="ElMenus">ElMenus</option>
                <option value="Other">أخرى</option>
              </select>
            </div>
            <div className="grid" style={{ gap: '8px' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>خدمة التوصيل</label>
              <input
                type="number"
                style={{ background: 'var(--bg-dark)', color: 'white', padding: '14px', border: '1px solid var(--border)', borderRadius: '12px', width: '100%' }}
                required
                value={formData.deliveryFee}
                onChange={e => setFormData({ ...formData, deliveryFee: e.target.value })}
              />
            </div>
          </div>

          <div className="flex" style={{ marginTop: '12px' }}>
            <button type="submit" className="btn-primary" style={{ flex: 2, background: 'var(--accent)', color: 'black', justifyContent: 'center' }}>إضافة</button>
            <button type="button" onClick={onClose} style={{ flex: 1, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>إلغاء</button>
          </div>
        </form>
      </div>
    </div>
  );
};

const ReservationModal = ({ onClose }) => {
  const { addReservation } = useApp();
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    locationType: 'restaurant', customerName: '', phone: '',
    date: new Date().toISOString().split('T')[0], time: '14:00',
    guests: 2, deposit: 50, notes: ''
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (step < 2) return setStep(2);
    addReservation(formData);
    onClose();
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, backdropFilter: 'blur(10px)', padding: '16px' }}>
      <div className="card" style={{ width: '100%', maxWidth: '480px', border: '1px solid #8b5cf6', padding: '32px' }}>
        <h3 className="flex" style={{ color: '#8b5cf6', marginBottom: '24px' }}><UtensilsCrossed size={24} /> حجز جديد</h3>
        <form onSubmit={handleSubmit} className="grid" style={{ gap: '20px' }}>
          {step === 1 ? (
            <>
              <div className="grid-2" style={{ gap: '12px' }}>
                {['restaurant', 'cafe'].map(t => (
                  <button key={t} type="button" onClick={() => setFormData({ ...formData, locationType: t })} className="card" style={{ padding: '16px', textAlign: 'center', border: formData.locationType === t ? '2px solid #8b5cf6' : '1px solid var(--border)', background: formData.locationType === t ? 'rgba(139, 92, 246, 0.1)' : 'transparent', color: 'white' }}>
                    {t === 'restaurant' ? 'مطعم' : 'كافيه'}
                  </button>
                ))}
              </div>
              <input required style={{ background: 'var(--bg-dark)', color: 'white', padding: '14px', borderRadius: '12px', border: '1px solid var(--border)' }} placeholder="اسم العميل" value={formData.customerName} onChange={e => setFormData({ ...formData, customerName: e.target.value })} />
              <input required style={{ background: 'var(--bg-dark)', color: 'white', padding: '14px', borderRadius: '12px', border: '1px solid var(--border)' }} placeholder="رقم الهاتف" value={formData.phone} maxLength={11} onChange={e => { if (e.target.value.length <= 11) setFormData({ ...formData, phone: e.target.value }); }} />
            </>
          ) : (
            <>
              <div className="grid-2" style={{ gap: '12px' }}>
                <input type="date" style={{ background: 'var(--bg-dark)', color: 'white', padding: '12px', borderRadius: '12px', border: '1px solid var(--border)' }} value={formData.date} onChange={e => setFormData({ ...formData, date: e.target.value })} />
                <input type="time" style={{ background: 'var(--bg-dark)', color: 'white', padding: '12px', borderRadius: '12px', border: '1px solid var(--border)' }} value={formData.time} onChange={e => setFormData({ ...formData, time: e.target.value })} />
              </div>
              <div className="grid-2" style={{ gap: '12px' }}>
                <input type="number" style={{ background: 'var(--bg-dark)', color: 'white', padding: '12px', borderRadius: '12px', border: '1px solid var(--border)' }} placeholder="عدد الأفراد" value={formData.guests} onChange={e => setFormData({ ...formData, guests: e.target.value })} />
                <input type="number" style={{ background: 'var(--bg-dark)', color: 'white', padding: '12px', borderRadius: '12px', border: '1px solid var(--border)' }} placeholder="العربون" value={formData.deposit} onChange={e => setFormData({ ...formData, deposit: e.target.value })} />
              </div>
            </>
          )}
          <div className="flex" style={{ gap: '12px' }}>
            <button type="submit" className="btn-primary" style={{ flex: 2, background: '#8b5cf6', justifyContent: 'center' }}>{step === 1 ? 'التالي' : 'تأكيد'}</button>
            <button type="button" onClick={onClose} style={{ flex: 1, background: 'transparent', color: 'white', border: '1px solid var(--border)' }}>إلغاء</button>
          </div>
        </form>
      </div>
    </div>
  );
};

const ConfirmPaymentModal = ({ res, onClose }) => {
  const { confirmReservation } = useApp();
  const [isCompressing, setIsCompressing] = useState(false);
  const [refNum, setRefNum] = useState(res.ref_number || '');
  const existingProof = res.payment_proof_url || res.paymentProof;
  const { signedUrl: resolvedExistingProof } = useSignedReceiptUrl(existingProof);
  const [proof, setProof] = useState(existingProof || null);
  const displayProof = (proof && proof.startsWith('data:')) ? proof : (resolvedExistingProof || proof);

  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (file) {
      setIsCompressing(true);
      const processed = await processImageUpload(file, 'payment-screenshots', 'reservations');
      if (processed) {
        setProof(processed);
      }
      setIsCompressing(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    confirmReservation(res.id, refNum, proof);
    onClose();
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000 }}>
      <div className="glass-card" style={{ padding: '24px', width: '380px', border: '1px solid var(--success)' }}>
        <h3 style={{ marginBottom: '16px', color: 'var(--success)' }}>تأكيد استلام العربون</h3>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>رقم التحويل / المرجع</label>
            <input required={!existingProof} className="glass-card" style={{ width: '100%', padding: '12px', color: 'white' }} placeholder="أدخل الرقم هنا..." value={refNum} onChange={e => setRefNum(e.target.value)} />
          </div>

          <div style={{ background: 'rgba(255,255,255,0.02)', padding: '16px', borderRadius: '12px', border: '1px dashed var(--border)', textAlign: 'center' }}>
            <p style={{ fontSize: '0.85rem', marginBottom: '10px' }}>📸 صورة إيصال التحويل</p>
            {!existingProof && (
              <input required type="file" accept="image/*" onChange={handleFile} style={{ fontSize: '0.8rem', color: 'white' }} />
            )}
            {displayProof && <img src={displayProof} alt="preview" style={{ marginTop: '10px', width: '100%', height: '100px', objectFit: 'cover', borderRadius: '8px' }} />}
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button type="submit" disabled={isCompressing || (!proof && !existingProof)} className="btn-primary" style={{ flex: 2, background: 'var(--success)', justifyContent: 'center', opacity: (isCompressing || (!proof && !existingProof)) ? 0.5 : 1 }}>{isCompressing ? "جاري المعالجة..." : "تأكيد نهائي"}</button>
            <button type="button" onClick={onClose} disabled={isCompressing} style={{ flex: 1, background: 'transparent', border: '1px solid var(--border)', color: 'white', cursor: 'pointer', borderRadius: '8px', opacity: isCompressing ? 0.5 : 1 }}>رجوع</button>
          </div>
        </form>
      </div>
    </div>
  );
};

const ReservationCard = ({ res, onConfirm, onDelete, onPreviewProof }) => {
  const existingProof = res.paymentProof || res.payment_proof_url;
  const { signedUrl } = useSignedReceiptUrl(existingProof);
  const displayProof = (existingProof && existingProof.startsWith('data:')) ? existingProof : signedUrl;

  return (
    <div className="glass-card" style={{ borderTop: `4px solid ${res.status === 'confirmed' ? '#10b981' : '#8b5cf6'}` }}>
      <div className="flex" style={{ justifyContent: 'space-between', marginBottom: '12px' }}>
        <span style={{ fontSize: '0.8rem', opacity: 0.6 }}>{res.id}</span>
        <span style={{ padding: '4px 10px', borderRadius: '12px', fontSize: '0.8rem', fontWeight: 'bold', background: res.status === 'confirmed' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(245, 158, 11, 0.2)', color: res.status === 'confirmed' ? '#10b981' : '#f59e0b' }}>
          {res.status === 'confirmed' ? 'مؤكد' : 'معلق'}
        </span>
      </div>
      <h3 style={{ margin: '0 0 4px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
        {res.customerName}
        <span style={{ fontSize: '0.7rem', background: 'var(--primary)', color: 'white', padding: '2px 6px', borderRadius: '4px' }}>
          {res.locationType === 'cafe' ? 'كافيه' : 'مطعم'}
        </span>
      </h3>
      <p style={{ color: 'var(--accent)', fontWeight: 'bold', margin: '0 0 12px 0' }}>{res.phone}</p>

      <div className="grid-2" style={{ background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '12px', marginBottom: '12px', gap: '8px' }}>
        <div><label style={{ fontSize: '0.7rem', opacity: 0.6 }}>التاريخ</label><div style={{ fontSize: '0.9rem', fontWeight: 'bold' }}>{res.date}</div></div>
        <div><label style={{ fontSize: '0.7rem', opacity: 0.6 }}>الوقت</label><div style={{ fontSize: '0.9rem', fontWeight: 'bold' }}>{res.time}</div></div>
        <div><label style={{ fontSize: '0.7rem', opacity: 0.6 }}>الأفراد</label><div style={{ fontSize: '0.9rem', fontWeight: 'bold' }}>{res.guests}</div></div>
      </div>

      {res.notes && (
        <div style={{ background: 'rgba(255,255,255,0.02)', padding: '10px', borderRadius: '8px', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '12px' }}>
          <strong>ملاحظات:</strong> {res.notes}
        </div>
      )}

      {existingProof && (
        <div style={{ marginBottom: '12px', border: '1px dashed var(--border)', padding: '8px', borderRadius: '8px', textAlign: 'center', background: 'rgba(255,255,255,0.02)' }}>
          {displayProof ? (
            <img
              src={displayProof}
              alt="إثبات الدفع"
              style={{ width: '100%', height: '90px', objectFit: 'cover', borderRadius: '6px', cursor: 'pointer', border: '1px solid rgba(255,255,255,0.1)' }}
              onClick={() => onPreviewProof(displayProof)}
            />
          ) : (
            <div style={{ height: '90px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
              ⏳ جاري تجهيز رابط الإيصال الآمن...
            </div>
          )}
          <div
            style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '6px', cursor: displayProof ? 'pointer' : 'default' }}
            onClick={() => displayProof && onPreviewProof(displayProof)}
          >
            🔍 انقر لتكبير صورة التحويل
          </div>
        </div>
      )}

      <div className="flex" style={{ gap: '10px', marginTop: '16px' }}>
        {res.status === 'pending' && (
          <button
            onClick={() => onConfirm(res)}
            className="btn-primary"
            style={{ flex: 1, minHeight: '44px', background: 'var(--success)', justifyContent: 'center' }}
          >
            تأكيد
          </button>
        )}
        <button
          onClick={() => { if (window.confirm('هل أنت متأكد من حذف الحجز؟')) onDelete(res.id); }}
          style={{
            flex: res.status === 'pending' ? 1 : 'none',
            width: res.status === 'pending' ? 'auto' : '100%',
            minHeight: '44px',
            background: 'rgba(239, 68, 68, 0.1)',
            color: 'var(--danger)',
            border: '1px solid var(--danger)',
            padding: '10px',
            borderRadius: '12px',
            fontWeight: 'bold',
            cursor: 'pointer'
          }}
        >
          حذف
        </button>
      </div>
    </div>
  );
};

const ReservationView = () => {
  const { reservations, deleteReservation } = useApp();
  const [showModal, setShowModal] = useState(false);
  const [confirmingRes, setConfirmingRes] = useState(null);
  const [previewProofUrl, setPreviewProofUrl] = useState(null);

  return (
    <div className="grid" style={{ gap: '24px' }}>
      {showModal && <ReservationModal onClose={() => setShowModal(false)} />}
      {confirmingRes && <ConfirmPaymentModal res={confirmingRes} onClose={() => setConfirmingRes(null)} />}

      {previewProofUrl && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 4000,
            backdropFilter: 'blur(8px)',
            padding: '20px'
          }}
          onClick={() => setPreviewProofUrl(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ position: 'relative', maxWidth: '90%', maxHeight: '90%' }}
          >
            <img
              src={previewProofUrl}
              alt="إيصال الحجز"
              style={{
                maxWidth: '100%',
                maxHeight: '85vh',
                borderRadius: '12px',
                border: '1px solid rgba(255,255,255,0.1)',
                objectFit: 'contain'
              }}
            />
            <button
              onClick={() => setPreviewProofUrl(null)}
              style={{
                position: 'absolute',
                top: '-15px',
                right: '-15px',
                background: '#ef4444',
                color: 'white',
                border: 'none',
                borderRadius: '50%',
                width: '36px',
                height: '36px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 'bold',
                fontSize: '1.1rem',
                boxShadow: '0 2px 10px rgba(0,0,0,0.5)'
              }}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      <PageHeader
        title="الحجوزات"
        subtitle="إدارة طاولات المطعم وتأكيد العربون"
        actions={
          <button
            onClick={() => setShowModal(true)}
            className="btn-primary"
            style={{ minHeight: '44px', padding: '10px 18px', background: '#8b5cf6', display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            <PlusCircle size={18} />
            <span>حجز جديد</span>
          </button>
        }
      />

      {reservations.length === 0 ? (
        <EmptyState
          icon={UtensilsCrossed}
          title="لا توجد أي حجوزات مسجلة"
          description="يمكنك إنشاء حجز جديد أو متابعة طلبات الحجز القادمة من موقع المطعم."
          action={
            <button
              onClick={() => setShowModal(true)}
              className="btn-primary"
              style={{ minHeight: '44px', padding: '10px 18px', background: '#8b5cf6' }}
            >
              <PlusCircle size={18} /> حجز طاولة جديد
            </button>
          }
        />
      ) : (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px' }}>
          {reservations.map(res => (
            <ReservationCard
              key={res.id}
              res={res}
              onConfirm={setConfirmingRes}
              onDelete={deleteReservation}
              onPreviewProof={setPreviewProofUrl}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const ExtraTripForm = ({ onClose, initialData }) => {
  const { addOrder } = useApp();
  const [formData, setFormData] = useState(initialData?.formData || {
    requester: MANAGERS[0],
    notes: '',
    value: 10
  });

  const tripValues = Array.from({ length: (50 - 10) / 5 + 1 }, (_, i) => 10 + i * 5);

  const handleSubmit = (e) => {
    e.preventDefault();
    addOrder({
      id: `Trip-${Date.now().toString().slice(-4)}`,
      type: 'trip',
      customerName: formData.requester,
      phone: 'داخلي',
      area: 'مشوار خاص',
      total: 0,
      deliveryFee: Number(formData.value),
      source: 'external', // 🏍️ مشوار خارجي (توصيل فقط)
      itemsDescription: formData.notes,
      itemsCount: 1
    });
    onClose();
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(12px)' }}>
      <div className="glass-card" style={{ padding: '32px', width: '480px', display: 'flex', flexDirection: 'column', gap: '20px', border: '1px solid var(--warning)' }}>
        <h3 style={{ fontSize: '1.4rem', borderBottom: '1px solid var(--border)', paddingBottom: '12px', color: 'var(--warning)', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Bike size={24} /> رحلة إضافية (Non-Kitchen)
        </h3>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>صاحب الطلب / الجهة</label>
            <select
              className="glass-card"
              style={{ background: '#1e293b', color: 'white', padding: '12px', border: '1px solid var(--border)', borderRadius: '8px' }}
              value={formData.requester}
              onChange={e => setFormData({ ...formData, requester: e.target.value })}
            >
              {MANAGERS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>قيمة المشوار (للأجور)</label>
            <select
              className="glass-card"
              style={{ background: '#1e293b', color: 'white', padding: '12px', border: '1px solid var(--border)', borderRadius: '8px' }}
              value={formData.value}
              onChange={e => setFormData({ ...formData, value: e.target.value })}
            >
              {tripValues.map(v => <option key={v} value={v}>{v} ج.م</option>)}
            </select>
          </div>

          <textarea
            className="glass-card"
            style={{ background: 'rgba(255,255,255,0.05)', color: 'white', padding: '12px', border: '1px solid var(--border)', borderRadius: '8px', minHeight: '80px', resize: 'none' }}
            placeholder="ملاحظات توضيحية للمشوار (اختياري)"
            value={formData.notes}
            onChange={e => setFormData({ ...formData, notes: e.target.value })}
          />

          <div style={{ display: 'flex', gap: '12px', marginTop: '12px' }}>
            <button type="submit" className="btn-primary" style={{ flex: 1, justifyContent: 'center', height: '48px', background: 'var(--warning)', color: 'black' }}>تسجيل المشوار</button>
            <button type="button" onClick={onClose} style={{ flex: 0.5, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer', borderRadius: '8px' }}>إلغاء</button>
          </div>
        </form>
      </div>
    </div>
  );
};

const SecurityModal = ({ onClose }) => {
  const { shiftConfig, updateShiftConfig } = useApp();
  const [targetUser, setTargetUser] = useState('admin');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // 🕐 إعدادات أوقات تشغيل الورديات (المصدر: قاعدة البيانات)
  const [openTime, setOpenTime] = useState(shiftConfig?.openTime || '06:00');
  const [closeTime, setCloseTime] = useState(shiftConfig?.closeTime || '04:00');
  const [shiftSaving, setShiftSaving] = useState(false);
  const [shiftMsg, setShiftMsg] = useState('');

  useEffect(() => {
    setOpenTime(shiftConfig?.openTime || '06:00');
    setCloseTime(shiftConfig?.closeTime || '04:00');
  }, [shiftConfig?.openTime, shiftConfig?.closeTime]);

  const handleSaveShiftTimes = async (e) => {
    e.preventDefault();
    setShiftMsg('');
    setShiftSaving(true);
    const result = await updateShiftConfig({ openTime, closeTime });
    setShiftSaving(false);
    if (result?.success) {
      setShiftMsg('✅ تم حفظ أوقات التشغيل وتطبيقها فوراً على الجميع.');
    } else {
      setShiftMsg('❌ ' + (result?.error || 'تعذّر حفظ الأوقات'));
    }
  };

  const handleSave = (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    // Disabled saving plaintext passwords to localStorage for security
    setError('⚠️ تم إيقاف تغيير كلمات المرور محلياً لدواعي أمنية.');
    setTimeout(() => {
      onClose();
    }, 2000);
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.8)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100000,
        backdropFilter: 'blur(12px)'
      }}
    >
      <div
        className="glass-card"
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '330px',
          padding: '16px',
          position: 'relative',
          border: '1px solid var(--border)'
        }}
      >
        <h3 className="flex" style={{ fontSize: '1.15rem', margin: '0 0 12px 0', borderBottom: '1px solid var(--border)', paddingBottom: '10px', color: 'white' }}>
          <KeyRound size={18} color="var(--accent)" /> إعدادات الأمان
        </h3>

        {/* 🕐 حوكمة أوقات تشغيل الورديات (تُحفظ في قاعدة البيانات) */}
        <form onSubmit={handleSaveShiftTimes} style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '14px', background: 'rgba(59,130,246,0.06)', border: '1px solid var(--border)', borderRadius: '10px', padding: '12px' }}>
          <div className="flex" style={{ alignItems: 'center', gap: '8px', fontSize: '0.9rem', fontWeight: 'bold', color: 'var(--accent)' }}>
            <Clock size={16} /> أوقات تشغيل الورديات (بتوقيت القاهرة)
          </div>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: 0 }}>
            تُطبَّق فوراً على جميع المستخدمين. اليوم التشغيلي قد يمتد بعد منتصف الليل (مثال: 06:00 ← 04:00).
          </p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>بداية التشغيل (فتح)</label>
              <input
                type="time"
                value={openTime}
                onChange={e => setOpenTime(e.target.value)}
                className="glass-card"
                style={{ background: 'rgba(255,255,255,0.05)', color: 'white', padding: '8px', border: '1px solid var(--border)', borderRadius: '8px', textAlign: 'center' }}
                required
              />
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>نهاية التشغيل (إغلاق)</label>
              <input
                type="time"
                value={closeTime}
                onChange={e => setCloseTime(e.target.value)}
                className="glass-card"
                style={{ background: 'rgba(255,255,255,0.05)', color: 'white', padding: '8px', border: '1px solid var(--border)', borderRadius: '8px', textAlign: 'center' }}
                required
              />
            </div>
          </div>
          {shiftMsg && <div style={{ fontSize: '0.78rem', fontWeight: 'bold', textAlign: 'center', color: shiftMsg.startsWith('✅') ? '#10b981' : '#ef4444' }}>{shiftMsg}</div>}
          <button type="submit" disabled={shiftSaving} className="btn-primary" style={{ height: '36px', justifyContent: 'center', fontSize: '0.82rem', background: 'var(--accent)', opacity: shiftSaving ? 0.6 : 1 }}>
            {shiftSaving ? 'جاري الحفظ...' : 'حفظ أوقات التشغيل'}
          </button>
        </form>

        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* User selector */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>المستخدم:</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className="btn-primary"
                style={{ flex: 1, height: '38px', background: targetUser === 'admin' ? 'var(--primary)' : 'rgba(255,255,255,0.05)', color: 'white', border: targetUser === 'admin' ? 'none' : '1px solid var(--border)', justifyContent: 'center', fontSize: '0.8rem' }}
                onClick={() => { setTargetUser('admin'); setError(''); setSuccess(''); }}
              >
                المشرف (Admin)
              </button>
              <button
                type="button"
                className="btn-primary"
                style={{ flex: 1, height: '38px', background: targetUser === 'casher' ? 'var(--accent)' : 'rgba(255,255,255,0.05)', color: 'white', border: targetUser === 'casher' ? 'none' : '1px solid var(--border)', justifyContent: 'center', fontSize: '0.8rem' }}
                onClick={() => { setTargetUser('casher'); setError(''); setSuccess(''); }}
              >
                الكاشير (Casher)
              </button>
            </div>
          </div>

          {/* New PIN */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>كلمة المرور الجديدة:</label>
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              className="glass-card"
              style={{ background: 'rgba(255,255,255,0.05)', color: 'white', padding: '10px', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '1rem', letterSpacing: '2px', textAlign: 'center' }}
              value={newPin}
              onChange={e => setNewPin(e.target.value.replace(/\D/g, ''))}
              placeholder="••••"
              required
            />
          </div>

          {/* Confirm PIN */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>تأكيد كلمة المرور:</label>
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              className="glass-card"
              style={{ background: 'rgba(255,255,255,0.05)', color: 'white', padding: '10px', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '1rem', letterSpacing: '2px', textAlign: 'center' }}
              value={confirmPin}
              onChange={e => setConfirmPin(e.target.value.replace(/\D/g, ''))}
              placeholder="••••"
              required
            />
          </div>

          {error && <div style={{ color: '#ef4444', fontSize: '0.8rem', fontWeight: 'bold', textAlign: 'center' }}>{error}</div>}
          {success && <div style={{ color: '#10b981', fontSize: '0.8rem', fontWeight: 'bold', textAlign: 'center' }}>{success}</div>}

          <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
            <button type="submit" className="btn-primary" style={{ flex: 1, height: '38px', justifyContent: 'center', fontSize: '0.85rem' }}>حفظ التعديل</button>
            <button type="button" onClick={onClose} style={{ flex: 0.5, height: '38px', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer', borderRadius: '8px', fontSize: '0.85rem' }}>إلغاء</button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ➕ زر "طلب جديد" موحد بقائمة منسدلة (نفس النوافذ الثلاث السابقة)
const CREATE_OPTIONS = [
  { id: 'manual', label: 'أوردر المطبخ', hint: 'طلب من منيو المطعم', color: '#22c55e' },
  { id: 'external', label: 'أوردر خارجي / تطبيقات', hint: 'طلبات، نون، وغيرها', color: '#f97316' },
  { id: 'trip', label: 'مشوار خاص', hint: 'توصيل بدون منيو', color: '#ef4444' },
];

const CreateOrderMenu = ({ onSelect, disabled }) => {
  const [open, setOpen] = useState(false);
  const ref = React.useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  return (
    <div className="create-menu" ref={ref}>
      <button
        type="button"
        className="btn-primary"
        style={{
          background: 'var(--accent)',
          color: '#000',
          fontWeight: 800,
          opacity: disabled ? 0.6 : 1
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          if (disabled) {
            toast('يرجى فتح الوردية أولاً لإنشاء طلبات', 'warning');
            return;
          }
          setOpen(o => !o);
        }}
      >
        <Plus size={18} />
        <span className="create-label">طلب جديد</span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <div className="create-menu-list" role="menu">
          {CREATE_OPTIONS.map(opt => (
            <button
              key={opt.id}
              type="button"
              role="menuitem"
              className="more-menu-item"
              style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '2px', minHeight: '52px' }}
              onClick={() => { setOpen(false); onSelect(opt.id); }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 800 }}>
                <span aria-hidden="true" style={{ width: '10px', height: '10px', borderRadius: '50%', background: opt.color }} />
                {opt.label}
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', paddingRight: '18px' }}>{opt.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [activeModal, setActiveModal] = useState('none');
  const [reeditData, setReeditData] = useState(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const { isShiftOpen, deleteOrder, userRole, setUserRole, isAuthLoading, orders, currentShift } = useApp();

  // 🟢 حماية لضمان الصلاحيات للأدوار المختلفة
  useEffect(() => {
    if (userRole === 'driver' && activeTab !== 'inbox') {
      setActiveTab('inbox');
    } else if (userRole === 'casher' && activeTab === 'reports') {
      setActiveTab('dashboard');
    }
  }, [userRole, activeTab]);

  const toggleSidebar = () => {
    setIsSidebarOpen(prev => !prev);
  };

  const closeSidebar = () => {
    setIsSidebarOpen(false);
  };

  // Prevent scroll when sidebar is open (Mobile)
  useEffect(() => {
    document.body.style.overflow = isSidebarOpen ? 'hidden' : 'auto';
  }, [isSidebarOpen]);

  const handleReedit = (order) => {
    // Pack data for the forms
    let initial = {};
    if (order.type === 'restaurant') {
      initial = {
        formData: {
          receiptNo: order.originalId || order.id,
          customerName: order.customerName,
          phone: order.phone,
          area: order.area,
          total: order.total,
          deliveryFee: order.deliveryFee,
          itemsDescription: order.itemsDescription,
          paymentMethod: order.paymentMethod,
          paymentProof: order.paymentProof
        },
        selectedItems: order.items?.reduce((acc, curr) => ({ ...acc, [curr.name]: curr.count }), {}) || {}
      };
      setReeditData(initial);
      setActiveModal('manual');
    } else if (order.type === 'talabat' || order.type === 'external') {
      initial = {
        formData: {
          receiptNo: order.originalId || order.id,
          platform: order.customerName.includes('Talabat') ? 'Talabat' : order.customerName.includes('Noon') ? 'Noon' : 'Other',
          customerName: 'عميل أبلكيشن',
          phone: order.phone,
          deliveryFee: order.deliveryFee,
          area: order.area,
          paymentMethod: order.paymentMethod,
          paymentProof: order.paymentProof
        }
      };
      setReeditData(initial);
      setActiveModal('external');
    } else if (order.type === 'trip') {
      initial = {
        formData: {
          requester: order.customerName,
          notes: order.itemsDescription,
          value: order.deliveryFee
        }
      };
      setReeditData(initial);
      setActiveModal('trip');
    }

    deleteOrder(order.id);
  };

  const handleCloseModal = () => {
    setActiveModal('none');
    setReeditData(null);
  };

  useEffect(() => {
    const handleEsc = (event) => {
      if (event.key === 'Escape') {
        handleCloseModal();
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => {
      window.removeEventListener('keydown', handleEsc);
    };
  }, []);

  if (isAuthLoading) {
    return (
      <div style={{ minHeight: '100vh', background: '#090d16', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '16px', color: 'white', fontFamily: 'Cairo, sans-serif' }}>
        <div style={{ width: '48px', height: '48px', border: '3px solid rgba(16, 185, 129, 0.2)', borderTopColor: '#10b981', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
        <p style={{ fontSize: '0.9rem', color: '#94a3b8' }}>جاري التحقق من هوية وصلاحيات الموظف...</p>
        <style dangerouslySetInnerHTML={{ __html: `@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }` }} />
      </div>
    );
  }

  if (!userRole) {
    return <Login onLoginSuccess={(role) => setActiveTab(role === 'admin' ? 'dashboard' : 'inbox')} />;
  }

  const visibleNav = NAV_ITEMS.filter(item => item.roles.includes(userRole));
  const currentNav = visibleNav.find(item => item.id === activeTab);
  const bottomNavItems = visibleNav.slice(0, 3);
  const actionCount = getActionCount(orders);

  return (
    <div className="layout" dir="rtl">
      {/* Overlay: click outside closes menu */}
      {isSidebarOpen && (
        <div className="sidebar-overlay" onClick={closeSidebar}></div>
      )}

      {/* 🗃 Floating Toggle Button for Mobile / Tablet Drawer */}
      <button
        type="button"
        className="floating-sidebar-toggle"
        onClick={(e) => {
          e.stopPropagation();
          toggleSidebar();
        }}
        aria-label="القائمة الجانبية"
        aria-expanded={isSidebarOpen}
        title="القائمة الجانبية 🗃"
      >
        <span style={{ fontSize: '1.35rem', lineHeight: 1 }}>🗃</span>
      </button>

      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isSidebarOpen={isSidebarOpen}
        closeSidebar={closeSidebar}
        onOpenSecurity={() => setActiveModal('security')}
      />
      <main className="main-content">
        {/* 🧭 Top bar: أين أنا + حالة الوردية + إنشاء طلب */}
        <div className="topbar no-print">
          <h1 className="topbar-title">{currentNav?.label || ''}</h1>

          {userRole !== 'driver' && (
            <span
              className="shift-chip"
              style={{
                background: isShiftOpen ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                color: isShiftOpen ? '#34d399' : '#f87171'
              }}
              title={isShiftOpen && currentShift?.date ? `الوردية: ${currentShift.date}` : undefined}
            >
              <span className="dot" aria-hidden="true" />
              <span>{isShiftOpen ? '✅' : '❎'}</span>
            </span>
          )}

          {/* 🔴 إنشاء طلب - مسموح للكاشير والأدمن */}
          {(userRole === 'casher' || userRole === 'admin') && (
            <CreateOrderMenu
              disabled={!isShiftOpen}
              onSelect={(modal) => setActiveModal(modal)}
            />
          )}
        </div>

        <div className="app-container">
          <ConnectionBanner />

          {activeModal === 'manual' && <ManualOrderForm onClose={handleCloseModal} initialData={reeditData} />}
          {activeModal === 'external' && <ExternalOrderForm onClose={handleCloseModal} initialData={reeditData} />}
          {activeModal === 'trip' && <ExtraTripForm onClose={handleCloseModal} initialData={reeditData} />}
          {activeModal === 'security' && <SecurityModal onClose={handleCloseModal} />}

          <div style={{ position: 'relative' }}>
            {/* 🔐 تأمين الصفحات - الأدمن والكاشير */}
            {activeTab === 'dashboard' && (userRole === 'admin' || userRole === 'casher') && (
              <DashboardView
                onNavigate={(tab) => setActiveTab(tab)}
                onOpenModal={(modal) => setActiveModal(modal)}
              />
            )}
            {activeTab === 'inbox' && <OrderInbox onReedit={handleReedit} />}
            {activeTab === 'pilots' && (userRole === 'admin' || userRole === 'casher') && <PilotManagement />}
            {activeTab === 'reservations' && (userRole === 'admin' || userRole === 'casher') && <ReservationView />}
            {activeTab === 'feedback' && userRole === 'admin' && <FeedbackView />}
            {activeTab === 'reports' && userRole === 'admin' && <ReportsView />}
            {activeTab === 'settings' && userRole === 'admin' && <SettingsView />}
          </div>

          {/* 🛡️ Modern minimal Ownership Footer */}
          <footer style={{
            marginTop: '40px',
            paddingTop: '16px',
            borderTop: '1px solid rgba(255, 255, 255, 0.05)',
            textAlign: 'center',
            fontSize: '0.72rem',
            color: 'var(--text-dim)',
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
            alignItems: 'center'
          }}>
            <div>جميع الحقوق محفوظة © {new Date().getFullYear()} نظام توصيل أبو خاطر</div>
            <div style={{ opacity: 0.8, direction: 'ltr', display: 'flex', alignItems: 'center', gap: '4px' }}>
              Developed &amp; Owned by <strong style={{ color: 'var(--accent)' }}>AmrMamdouh</strong> (01038035884)
            </div>
          </footer>
        </div>
      </main>

      {/* 📱 Bottom navigation (phones only) — أهم الوجهات بلمسة واحدة */}
      <nav className="bottom-nav no-print" aria-label="التنقل السريع" style={{ '--bn-cols': bottomNavItems.length + 1 }}>
        {bottomNavItems.map(item => (
          <button
            key={item.id}
            type="button"
            className={activeTab === item.id ? 'is-active' : ''}
            aria-current={activeTab === item.id ? 'page' : undefined}
            onClick={() => { setActiveTab(item.id); closeSidebar(); }}
          >
            <item.icon size={22} />
            <span>{item.short}</span>
            {item.id === 'inbox' && actionCount > 0 && <span className="nav-count">{actionCount}</span>}
          </button>
        ))}
        <button type="button" onClick={toggleSidebar} aria-label="كل الأقسام" className={isSidebarOpen ? 'is-active' : ''}>
          <Menu size={22} />
          <span>المزيد</span>
        </button>
      </nav>

      <ToastHost />
    </div>
  );
}

export default App;
