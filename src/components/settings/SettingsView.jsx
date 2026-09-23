import React, { useState, useEffect } from 'react';
import { 
  Settings, Save, RefreshCw, Power, DollarSign, MapPin, 
  CreditCard, Clock, AlertCircle, CheckCircle2, Shield, Plus, Trash2
} from 'lucide-react';
import { supabaseService } from '../../services/supabaseService';

const DEFAULT_AREAS = [
  { name: 'المطرية - الرئيسي', lat: 30.126, lng: 31.298, zone: 1, fee: 20 },
  { name: 'المسلة', lat: 30.132, lng: 31.302, zone: 1, fee: 20 },
  { name: 'مسطرد', lat: 30.141, lng: 31.295, zone: 1, fee: 25 },
  { name: 'الشارع الجديد', lat: 30.148, lng: 31.292, zone: 1, fee: 25 },
  { name: 'عين شمس', lat: 30.121, lng: 31.332, zone: 2, fee: 30 },
  { name: 'النعام', lat: 30.115, lng: 31.318, zone: 2, fee: 35 },
  { name: 'حلمية الزيتون', lat: 30.111, lng: 31.305, zone: 2, fee: 35 },
  { name: 'الأميرية', lat: 30.105, lng: 31.292, zone: 2, fee: 30 },
  { name: 'السواح', lat: 30.101, lng: 31.288, zone: 2, fee: 35 },
  { name: 'الخصوص', lat: 30.165, lng: 31.312, zone: 3, fee: 45 },
  { name: 'المرج', lat: 30.155, lng: 31.345, zone: 3, fee: 50 },
  { name: 'جسر السويس', lat: 30.115, lng: 31.365, zone: 3, fee: 55 },
  { name: 'مصر الجديدة', lat: 30.091, lng: 31.334, zone: 3, fee: 60 },
  { name: 'مدينة نصر', lat: 30.061, lng: 31.335, zone: 4, fee: 75 },
  { name: 'القلج', lat: 30.185, lng: 31.368, zone: 4, fee: 70 },
  { name: 'الخانكة', lat: 30.215, lng: 31.378, zone: 4, fee: 80 }
];

const SettingsView = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState(null);

  // Form states
  const [isOpen, setIsOpen] = useState(true);
  const [shiftOpenTime, setShiftOpenTime] = useState('08:00');
  const [shiftCloseTime, setShiftCloseTime] = useState('04:00');
  const [minDeliveryFee, setMinDeliveryFee] = useState(20);
  const [deliveryPerKmRate, setDeliveryPerKmRate] = useState(1.25);
  const [maxDeliveryDistance, setMaxDeliveryDistance] = useState(15);
  const [minOrderAmount, setMinOrderAmount] = useState(0);
  const [instapayIpa, setInstapayIpa] = useState('abu_khatar@instapay');
  const [walletNumber, setWalletNumber] = useState('01144423700');
  const [accountName, setAccountName] = useState('مطعم أبو خاطر');
  const [areas, setAreas] = useState(DEFAULT_AREAS);

  // New Area Modal / inline inputs
  const [newAreaName, setNewAreaName] = useState('');
  const [newAreaFee, setNewAreaFee] = useState(30);
  const [newAreaZone, setNewAreaZone] = useState(1);

  // Load settings
  const loadSettings = async () => {
    try {
      setLoading(true);
      const settings = await supabaseService.fetchRestaurantSettings();
      if (settings) {
        if (settings.is_restaurant_open !== undefined) {
          setIsOpen(settings.is_restaurant_open === 'true' || settings.is_restaurant_open === true);
        }
        if (settings.shift_open_time) setShiftOpenTime(settings.shift_open_time);
        if (settings.shift_close_time) setShiftCloseTime(settings.shift_close_time);
        if (settings.min_delivery_fee) setMinDeliveryFee(Number(settings.min_delivery_fee));
        if (settings.delivery_per_km_rate) setDeliveryPerKmRate(Number(settings.delivery_per_km_rate));
        if (settings.max_delivery_distance_km) setMaxDeliveryDistance(Number(settings.max_delivery_distance_km));
        if (settings.min_order_amount) setMinOrderAmount(Number(settings.min_order_amount));
        if (settings.payment_instapay_ipa) setInstapayIpa(settings.payment_instapay_ipa);
        if (settings.payment_wallet_number) setWalletNumber(settings.payment_wallet_number);
        if (settings.payment_account_name) setAccountName(settings.payment_account_name);
        if (settings.fixed_delivery_zones) {
          try {
            const parsed = typeof settings.fixed_delivery_zones === 'string'
              ? JSON.parse(settings.fixed_delivery_zones)
              : settings.fixed_delivery_zones;
            if (Array.isArray(parsed) && parsed.length > 0) {
              setAreas(parsed);
            }
          } catch (e) {
            console.warn('Failed to parse fixed_delivery_zones:', e);
          }
        }
      }
    } catch (err) {
      console.error('Failed to load settings:', err);
      showFeedback('error', 'حدث خطأ أثناء تحميل الإعدادات من الخادم');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
    const subscription = supabaseService.subscribeToRestaurantSettings(() => {
      // Background refresh if external change occurs
      loadSettings();
    });
    return () => {
      if (subscription && subscription.unsubscribe) subscription.unsubscribe();
    };
  }, []);

  const showFeedback = (type, message) => {
    setStatusMsg({ type, message });
    setTimeout(() => setStatusMsg(null), 4000);
  };

  const handleSaveAll = async (e) => {
    if (e) e.preventDefault();
    try {
      setSaving(true);
      const updates = [
        { key: 'is_restaurant_open', value: isOpen ? 'true' : 'false' },
        { key: 'shift_open_time', value: shiftOpenTime },
        { key: 'shift_close_time', value: shiftCloseTime },
        { key: 'min_delivery_fee', value: String(minDeliveryFee) },
        { key: 'delivery_per_km_rate', value: String(deliveryPerKmRate) },
        { key: 'max_delivery_distance_km', value: String(maxDeliveryDistance) },
        { key: 'min_order_amount', value: String(minOrderAmount) },
        { key: 'payment_instapay_ipa', value: instapayIpa },
        { key: 'payment_wallet_number', value: walletNumber },
        { key: 'payment_account_name', value: accountName },
        { key: 'fixed_delivery_zones', value: JSON.stringify(areas) }
      ];

      for (const item of updates) {
        await supabaseService.updateRestaurantSetting(item.key, item.value);
      }

      showFeedback('success', 'تم حفظ جميع الإعدادات ومزامنتها بنجاح مع تطبيق المنيو!');
    } catch (err) {
      console.error('Failed to save settings:', err);
      showFeedback('error', 'حدث خطأ أثناء حفظ الإعدادات');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateAreaFee = (index, newFee) => {
    const updated = [...areas];
    updated[index].fee = Number(newFee);
    setAreas(updated);
  };

  const handleDeleteArea = (index) => {
    const updated = areas.filter((_, i) => i !== index);
    setAreas(updated);
  };

  const handleAddArea = () => {
    if (!newAreaName.trim()) return;
    setAreas(prev => [
      ...prev,
      {
        name: newAreaName.trim(),
        zone: Number(newAreaZone) || 1,
        fee: Number(newAreaFee) || 20
      }
    ]);
    setNewAreaName('');
    setNewAreaFee(30);
    setNewAreaZone(1);
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '400px', gap: '16px' }}>
        <RefreshCw className="animate-spin" size={36} color="var(--primary)" />
        <p style={{ color: 'var(--text-muted)', fontWeight: 'bold' }}>جاري تحميل إعدادات المطعم والأسعار...</p>
      </div>
    );
  }

  return (
    <div style={{ paddingBottom: '60px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 style={{ fontSize: '1.6rem', fontWeight: '800', color: 'white', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Settings size={28} color="var(--primary)" />
            <span>إعدادات النظام والأسعار والتوصيل</span>
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '4px' }}>
            تتحكم هذه الصفحة مباشرة في منيو العميل وأسعار التوصيل وحسابات الدفع الإلكتروني.
          </p>
        </div>

        <button
          onClick={handleSaveAll}
          disabled={saving}
          className="btn-primary"
          style={{
            background: 'var(--accent)',
            color: 'white',
            padding: '12px 24px',
            fontSize: '1rem',
            fontWeight: 'bold',
            boxShadow: '0 4px 15px rgba(16, 185, 129, 0.3)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            borderRadius: '12px'
          }}
        >
          {saving ? <RefreshCw className="animate-spin" size={20} /> : <Save size={20} />}
          <span>{saving ? 'جاري الحفظ...' : 'حفظ التعديلات الآن'}</span>
        </button>
      </div>

      {/* Status Feedback Banner */}
      {statusMsg && (
        <div style={{
          padding: '14px 20px',
          borderRadius: '12px',
          marginBottom: '24px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          fontWeight: 'bold',
          background: statusMsg.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
          border: `1px solid ${statusMsg.type === 'success' ? '#10b981' : '#ef4444'}`,
          color: statusMsg.type === 'success' ? '#34d399' : '#f87171'
        }}>
          {statusMsg.type === 'success' ? <CheckCircle2 size={22} /> : <AlertCircle size={22} />}
          <span>{statusMsg.message}</span>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
        
        {/* Card 1: حالة المطعم ومواعيد العمل */}
        <div className="card" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: '16px', padding: '20px' }}>
          <h2 style={{ fontSize: '1.15rem', fontWeight: 'bold', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px', color: 'white' }}>
            <Power size={20} color="var(--primary)" />
            <span>حالة المطعم ومواعيد العمل</span>
          </h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', background: 'rgba(255, 255, 255, 0.03)', borderRadius: '12px', border: '1px solid var(--border)' }}>
              <div>
                <div style={{ fontWeight: 'bold', color: 'white' }}>استقبال الطلبات (أونلاين)</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>إذا تم الإغلاق، سيظهر تنبيه للعميل في المنيو</div>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                style={{
                  padding: '8px 16px',
                  borderRadius: '10px',
                  border: 'none',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  background: isOpen ? '#10b981' : '#ef4444',
                  color: 'white',
                  transition: 'all 0.2s'
                }}
              >
                {isOpen ? 'مفتوح للطلبات' : 'مغلق حالياً'}
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
                  وقت بدء الوردية:
                </label>
                <input
                  type="time"
                  value={shiftOpenTime}
                  onChange={(e) => setShiftOpenTime(e.target.value)}
                  style={{ width: '100%', padding: '10px', borderRadius: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: 'white' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
                  وقت انتهاء الوردية:
                </label>
                <input
                  type="time"
                  value={shiftCloseTime}
                  onChange={(e) => setShiftCloseTime(e.target.value)}
                  style={{ width: '100%', padding: '10px', borderRadius: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: 'white' }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Card 2: قواعد تسعير التوصيل والمسافات */}
        <div className="card" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: '16px', padding: '20px' }}>
          <h2 style={{ fontSize: '1.15rem', fontWeight: 'bold', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px', color: 'white' }}>
            <DollarSign size={20} color="var(--accent)" />
            <span>تسعير التوصيل والمسافات</span>
          </h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
                  الحد الأدنى للتوصيل (ج.م):
                </label>
                <input
                  type="number"
                  min="0"
                  value={minDeliveryFee}
                  onChange={(e) => setMinDeliveryFee(e.target.value)}
                  style={{ width: '100%', padding: '10px', borderRadius: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: 'white' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
                  أقصى مسافة توصيل (كم):
                </label>
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={maxDeliveryDistance}
                  onChange={(e) => setMaxDeliveryDistance(e.target.value)}
                  style={{ width: '100%', padding: '10px', borderRadius: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: 'white' }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
                  سعر كل كم إضافي (ج.م):
                </label>
                <input
                  type="number"
                  step="0.25"
                  min="0"
                  value={deliveryPerKmRate}
                  onChange={(e) => setDeliveryPerKmRate(e.target.value)}
                  style={{ width: '100%', padding: '10px', borderRadius: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: 'white' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
                  الحد الأدنى للطلب (ج.م):
                </label>
                <input
                  type="number"
                  min="0"
                  value={minOrderAmount}
                  onChange={(e) => setMinOrderAmount(e.target.value)}
                  style={{ width: '100%', padding: '10px', borderRadius: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: 'white' }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Card 3: بيانات التحويل والدفع الإلكتروني */}
        <div className="card" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: '16px', padding: '20px' }}>
          <h2 style={{ fontSize: '1.15rem', fontWeight: 'bold', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px', color: 'white' }}>
            <CreditCard size={20} color="#a855f7" />
            <span>بيانات التحويل والدفع الإلكتروني</span>
          </h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
                عنوان انستاباي (InstaPay IPA):
              </label>
              <input
                type="text"
                dir="ltr"
                value={instapayIpa}
                onChange={(e) => setInstapayIpa(e.target.value)}
                placeholder="example@instapay"
                style={{ width: '100%', padding: '10px', borderRadius: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: 'white' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
                رقم المحفظة الإلكترونية (فودافون كاش / أورنج):
              </label>
              <input
                type="text"
                dir="ltr"
                value={walletNumber}
                onChange={(e) => setWalletNumber(e.target.value)}
                placeholder="01144423700"
                style={{ width: '100%', padding: '10px', borderRadius: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: 'white' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
                اسم صاحب الحساب المعروض للعميل:
              </label>
              <input
                type="text"
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                placeholder="مطعم أبو خاطر"
                style={{ width: '100%', padding: '10px', borderRadius: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: 'white' }}
              />
            </div>
          </div>
        </div>

      </div>

      {/* Section: مناطق التوصيل ورسومها المحددة مسبقاً */}
      <div className="card" style={{ marginTop: '24px', background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: '16px', padding: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px', color: 'white' }}>
              <MapPin size={22} color="var(--primary)" />
              <span>مناطق التوصيل ورسومها المباشرة ({areas.length} منطقة)</span>
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '4px' }}>
              هذه المناطق تظهر للعميل في قائمة الاختيار السريع عند تحديد عنوان التوصيل.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="اسم المنطقة الجديدة"
              value={newAreaName}
              onChange={(e) => setNewAreaName(e.target.value)}
              style={{ padding: '8px 12px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: 'white', fontSize: '0.85rem', width: '140px' }}
            />
            <input
              type="number"
              placeholder="السعر (ج)"
              value={newAreaFee}
              onChange={(e) => setNewAreaFee(e.target.value)}
              style={{ padding: '8px 12px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: 'white', fontSize: '0.85rem', width: '90px' }}
            />
            <button
              type="button"
              onClick={handleAddArea}
              className="btn-primary"
              style={{ background: 'var(--primary)', padding: '8px 14px', borderRadius: '8px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <Plus size={16} />
              <span>إضافة منطقة</span>
            </button>
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                <th style={{ padding: '12px' }}>المنطقة</th>
                <th style={{ padding: '12px' }}>النطاق (Zone)</th>
                <th style={{ padding: '12px' }}>سعر التوصيل (ج.م)</th>
                <th style={{ padding: '12px', textAlign: 'center' }}>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {areas.map((area, index) => (
                <tr key={index} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 'bold', color: 'white' }}>{area.name}</td>
                  <td style={{ padding: '10px 12px', color: 'var(--text-muted)' }}>
                    نطاق {area.zone || 1}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <input
                        type="number"
                        min="0"
                        value={area.fee}
                        onChange={(e) => handleUpdateAreaFee(index, e.target.value)}
                        style={{
                          width: '90px',
                          padding: '6px 10px',
                          borderRadius: '8px',
                          background: 'rgba(255,255,255,0.05)',
                          border: '1px solid var(--border)',
                          color: '#34d399',
                          fontWeight: 'bold'
                        }}
                      />
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>ج.م</span>
                    </div>
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                    <button
                      type="button"
                      onClick={() => handleDeleteArea(index)}
                      style={{
                        background: 'rgba(239, 68, 68, 0.1)',
                        border: '1px solid rgba(239, 68, 68, 0.2)',
                        color: '#f87171',
                        padding: '6px 10px',
                        borderRadius: '8px',
                        cursor: 'pointer'
                      }}
                      title="حذف المنطقة"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default SettingsView;
