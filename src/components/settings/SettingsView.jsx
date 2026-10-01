import React, { useState, useEffect } from 'react';
import { 
  Settings, Save, RefreshCw, Power, DollarSign, MapPin, 
  CreditCard, Clock, AlertCircle, CheckCircle2, Shield, Plus, Trash2,
  Truck, Calendar, Percent, UtensilsCrossed, Search, Check, X, Filter
} from 'lucide-react';
import { supabaseService } from '../../services/supabaseService';

const DEFAULT_AREAS = [
  { name: 'المطرية الرئيسي', lat: 30.126, lng: 31.298, zone: 1, fee: 20 },
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
  const [activeSubTab, setActiveSubTab] = useState('general'); // 'general' | 'menu_items'
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState(null);

  // Menu items states
  const [menuItems, setMenuItems] = useState([]);
  const [loadingMenu, setLoadingMenu] = useState(false);
  const [menuSearch, setMenuSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [updatingItemId, setUpdatingItemId] = useState(null);

  // Form states - General & Shift
  const [isOpen, setIsOpen] = useState(true);
  const [requireActiveShift, setRequireActiveShift] = useState(true);
  const [shiftOpenTime, setShiftOpenTime] = useState('06:00');
  const [shiftCloseTime, setShiftCloseTime] = useState('04:00');

  // Form states - Delivery Pricing
  const [deliveryEnabled, setDeliveryEnabled] = useState(true);
  const [baseDeliveryFee, setBaseDeliveryFee] = useState(25);
  const [baseDistanceKm, setBaseDistanceKm] = useState(0.5);
  const [deliveryPerKmRate, setDeliveryPerKmRate] = useState(12.5);
  const [maxDeliveryDistance, setMaxDeliveryDistance] = useState(10);
  const [deliveryRoundingStep, setDeliveryRoundingStep] = useState(5);
  const [minOrderAmount, setMinOrderAmount] = useState(0);

  // Form states - Payment & Service Fee
  const [serviceFeeEnabled, setServiceFeeEnabled] = useState(true);
  const [serviceFeeChunk, setServiceFeeChunk] = useState(500);
  const [serviceFeePerChunk, setServiceFeePerChunk] = useState(10);
  const [instapayIpa, setInstapayIpa] = useState('abu_khatar@instapay');
  const [walletNumber, setWalletNumber] = useState('01144423700');
  const [accountName, setAccountName] = useState('مطعم أبو خاطر');

  // Form states - Reservations
  const [depositAmount, setDepositAmount] = useState(100);
  const [reservationFee, setReservationFee] = useState(5);

  // Form states - Fixed Zones
  const [areas, setAreas] = useState(DEFAULT_AREAS);
  const [newAreaName, setNewAreaName] = useState('');
  const [newAreaFee, setNewAreaFee] = useState(30);
  const [newAreaZone, setNewAreaZone] = useState(1);

  // Load settings from Supabase
  const loadSettings = async () => {
    try {
      setLoading(true);
      const settings = await supabaseService.fetchRestaurantSettings();
      if (settings) {
        if (settings.is_restaurant_open !== undefined) {
          setIsOpen(settings.is_restaurant_open === 'true' || settings.is_restaurant_open === true);
        }
        if (settings.require_active_shift_for_orders !== undefined) {
          setRequireActiveShift(settings.require_active_shift_for_orders === 'true' || settings.require_active_shift_for_orders === true);
        }
        if (settings.delivery_enabled !== undefined) {
          setDeliveryEnabled(settings.delivery_enabled === 'true' || settings.delivery_enabled === true);
        }
        if (settings.payment_service_fee_enabled !== undefined) {
          setServiceFeeEnabled(settings.payment_service_fee_enabled === 'true' || settings.payment_service_fee_enabled === true);
        }

        if (settings.shift_open_time) setShiftOpenTime(settings.shift_open_time);
        if (settings.shift_close_time) setShiftCloseTime(settings.shift_close_time);
        if (settings.delivery_base_fee) setBaseDeliveryFee(Number(settings.delivery_base_fee));
        else if (settings.min_delivery_fee) setBaseDeliveryFee(Number(settings.min_delivery_fee));

        if (settings.delivery_base_distance_km) setBaseDistanceKm(Number(settings.delivery_base_distance_km));
        if (settings.delivery_per_km_rate) setDeliveryPerKmRate(Number(settings.delivery_per_km_rate));
        if (settings.max_delivery_distance_km) setMaxDeliveryDistance(Number(settings.max_delivery_distance_km));
        if (settings.delivery_rounding_step) setDeliveryRoundingStep(Number(settings.delivery_rounding_step));
        if (settings.min_order_amount) setMinOrderAmount(Number(settings.min_order_amount));

        if (settings.payment_service_fee_chunk) setServiceFeeChunk(Number(settings.payment_service_fee_chunk));
        if (settings.payment_service_fee_per_chunk) setServiceFeePerChunk(Number(settings.payment_service_fee_per_chunk));

        if (settings.reservation_deposit_amount) setDepositAmount(Number(settings.reservation_deposit_amount));
        if (settings.reservation_service_fee) setReservationFee(Number(settings.reservation_service_fee));

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
      loadSettings();
    });
    return () => {
      if (subscription && subscription.unsubscribe) subscription.unsubscribe();
    };
  }, []);

  const showFeedback = (type, message) => {
    setStatusMsg({ type, message });
    setTimeout(() => setStatusMsg(null), 4500);
  };

  const handleSaveAll = async (e) => {
    if (e) e.preventDefault();
    try {
      setSaving(true);
      const updates = [
        { key: 'is_restaurant_open', value: isOpen ? 'true' : 'false' },
        { key: 'require_active_shift_for_orders', value: requireActiveShift ? 'true' : 'false' },
        { key: 'delivery_enabled', value: deliveryEnabled ? 'true' : 'false' },
        { key: 'shift_open_time', value: shiftOpenTime },
        { key: 'shift_close_time', value: shiftCloseTime },
        { key: 'delivery_base_fee', value: String(baseDeliveryFee) },
        { key: 'min_delivery_fee', value: String(baseDeliveryFee) },
        { key: 'delivery_base_distance_km', value: String(baseDistanceKm) },
        { key: 'delivery_per_km_rate', value: String(deliveryPerKmRate) },
        { key: 'max_delivery_distance_km', value: String(maxDeliveryDistance) },
        { key: 'delivery_rounding_step', value: String(deliveryRoundingStep) },
        { key: 'min_order_amount', value: String(minOrderAmount) },
        { key: 'payment_service_fee_enabled', value: serviceFeeEnabled ? 'true' : 'false' },
        { key: 'payment_service_fee_chunk', value: String(serviceFeeChunk) },
        { key: 'payment_service_fee_per_chunk', value: String(serviceFeePerChunk) },
        { key: 'reservation_deposit_amount', value: String(depositAmount) },
        { key: 'reservation_service_fee', value: String(reservationFee) },
        { key: 'payment_instapay_ipa', value: instapayIpa },
        { key: 'payment_wallet_number', value: walletNumber },
        { key: 'payment_account_name', value: accountName },
        { key: 'fixed_delivery_zones', value: JSON.stringify(areas) }
      ];

      for (const item of updates) {
        await supabaseService.updateRestaurantSetting(item.key, item.value);
      }

      showFeedback('success', 'تم حفظ جميع الإعدادات وتحديث محرك إنشاء الطلبات (create_order) بنجاح!');
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

  const loadMenuItems = async () => {
    try {
      setLoadingMenu(true);
      const items = await supabaseService.fetchMenuItemsAdmin();
      setMenuItems(items || []);
    } catch (err) {
      console.error('Failed to load menu items:', err);
      showFeedback('error', 'حدث خطأ أثناء تحميل أصناف المنيو');
    } finally {
      setLoadingMenu(false);
    }
  };

  useEffect(() => {
    if (activeSubTab === 'menu_items') {
      loadMenuItems();
    }
  }, [activeSubTab]);

  const handleToggleItemAvailability = async (item) => {
    try {
      setUpdatingItemId(item.id);
      const isCurrentlyAvailable = (item.status === 'available');
      const newStatus = isCurrentlyAvailable ? 'out_of_stock' : 'available';
      // Optimistic update
      setMenuItems(prev => prev.map(it => it.id === item.id ? { ...it, status: newStatus, isAvailable: (newStatus === 'available') } : it));
      await supabaseService.toggleMenuItemAvailability(item.id, !isCurrentlyAvailable);
      showFeedback('success', `تم تغيير حالة الصنف "${item.name}" إلى ${!isCurrentlyAvailable ? 'متاح' : 'نفذت الكمية'} بنجاح`);
    } catch (err) {
      console.error('Failed to toggle item availability:', err);
      showFeedback('error', `فشل تحديث حالة الصنف: ${err.message}`);
      loadMenuItems(); // rollback
    } finally {
      setUpdatingItemId(null);
    }
  };

  const handleUpdateItemStatus = async (itemId, newStatus) => {
    try {
      setUpdatingItemId(itemId);
      setMenuItems(prev => prev.map(it => it.id === itemId ? { ...it, status: newStatus, isAvailable: (newStatus === 'available') } : it));
      await supabaseService.updateMenuItemStatus(itemId, newStatus);
      showFeedback('success', 'تم تحديث حالة الصنف بنجاح');
    } catch (err) {
      console.error('Failed to update status:', err);
      showFeedback('error', `فشل تحديث الحالة: ${err.message}`);
      loadMenuItems();
    } finally {
      setUpdatingItemId(null);
    }
  };

  // Filtered menu items
  const filteredMenuItems = menuItems.filter(item => {
    const matchesSearch = !menuSearch || (item.name && item.name.toLowerCase().includes(menuSearch.toLowerCase())) || (item.description && item.description.toLowerCase().includes(menuSearch.toLowerCase()));
    const matchesCategory = selectedCategory === 'all' || item.categoryId === selectedCategory || item.categorySlug === selectedCategory || item.categoryName === selectedCategory;
    const matchesStatus = statusFilter === 'all' || (statusFilter === 'available' && item.status === 'available') || (statusFilter === 'out_of_stock' && item.status === 'out_of_stock') || (statusFilter === 'paused' && item.status === 'paused') || (statusFilter === 'hidden' && item.status === 'hidden');
    return matchesSearch && matchesCategory && matchesStatus;
  });

  const categoriesList = Array.from(
    new Map(menuItems.filter(i => i.categoryId).map(i => [i.categoryId, { id: i.categoryId, name: i.categoryName || 'عام', slug: i.categorySlug }])).values()
  );

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
            <span>إعدادات النظام والأسعار والمنيو</span>
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '4px' }}>
            تتحكم هذه الصفحة مباشرة في محرك إنشاء الطلبات (create_order) وإتاحة أصناف المنيو وقواعد التوصيل.
          </p>
        </div>

        {activeSubTab === 'general' ? (
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
        ) : (
          <button
            onClick={loadMenuItems}
            disabled={loadingMenu}
            className="btn-primary"
            style={{
              background: 'rgba(255, 255, 255, 0.1)',
              color: 'white',
              padding: '10px 18px',
              fontSize: '0.9rem',
              fontWeight: 'bold',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              borderRadius: '10px',
              border: '1px solid var(--border)'
            }}
          >
            <RefreshCw className={loadingMenu ? 'animate-spin' : ''} size={18} />
            <span>تحديث المنيو</span>
          </button>
        )}
      </div>

      {/* Sub Tab Navigation */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', borderBottom: '1px solid var(--border)', paddingBottom: '12px', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => setActiveSubTab('general')}
          style={{
            background: activeSubTab === 'general' ? 'var(--primary)' : 'rgba(255, 255, 255, 0.05)',
            color: activeSubTab === 'general' ? '#000' : 'white',
            fontWeight: 'bold',
            padding: '10px 20px',
            borderRadius: '10px',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            transition: 'all 0.2s'
          }}
        >
          <Settings size={18} />
          <span>إعدادات النظام والأسعار والتوصيل</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveSubTab('menu_items');
            loadMenuItems();
          }}
          style={{
            background: activeSubTab === 'menu_items' ? 'var(--primary)' : 'rgba(255, 255, 255, 0.05)',
            color: activeSubTab === 'menu_items' ? '#000' : 'white',
            fontWeight: 'bold',
            padding: '10px 20px',
            borderRadius: '10px',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            transition: 'all 0.2s'
          }}
        >
          <UtensilsCrossed size={18} />
          <span>إدارة إتاحة أصناف المنيو</span>
          {menuItems.length > 0 && (
            <span style={{
              background: activeSubTab === 'menu_items' ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.1)',
              padding: '2px 8px',
              borderRadius: '12px',
              fontSize: '0.75rem'
            }}>
              {menuItems.filter(i => i.status === 'available').length}/{menuItems.length}
            </span>
          )}
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

      {/* Tab 1: General Settings & Delivery */}
      {activeSubTab === 'general' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
        
        {/* Card 1: حالة المطعم ومواعيد الوردية */}
        <div className="card" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: '16px', padding: '20px' }}>
          <h2 style={{ fontSize: '1.15rem', fontWeight: 'bold', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px', color: 'white' }}>
            <Power size={20} color="var(--primary)" />
            <span>حالة المطعم ومواعيد الوردية</span>
          </h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', background: 'rgba(255, 255, 255, 0.03)', borderRadius: '12px', border: '1px solid var(--border)' }}>
              <div>
                <div style={{ fontWeight: 'bold', color: 'white' }}>استقبال الطلبات (أونلاين)</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>يمنع إنشاء أي طلبات جديدة إذا تم الإغلاق</div>
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

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', background: 'rgba(255, 255, 255, 0.03)', borderRadius: '12px', border: '1px solid var(--border)' }}>
              <div>
                <div style={{ fontWeight: 'bold', color: 'white' }}>إلزامية الوردية المفتوحة</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>يرفض الطلبات أوتوماتيكياً إذا لم تكن هناك وردية مفتوحة</div>
              </div>
              <button
                type="button"
                onClick={() => setRequireActiveShift(!requireActiveShift)}
                style={{
                  padding: '8px 16px',
                  borderRadius: '10px',
                  border: 'none',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  background: requireActiveShift ? '#3b82f6' : '#64748b',
                  color: 'white',
                  transition: 'all 0.2s'
                }}
              >
                {requireActiveShift ? 'مُفعّل' : 'معطّل'}
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
            <Truck size={20} color="var(--accent)" />
            <span>تسعير التوصيل والمسافات (GPS)</span>
          </h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: 'rgba(255, 255, 255, 0.03)', borderRadius: '12px', border: '1px solid var(--border)' }}>
              <div>
                <div style={{ fontWeight: 'bold', color: 'white' }}>تفعيل خدمة التوصيل (Delivery)</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>إذا تم التعطيل، يقبل النظام فقط طلبات الاستلام والصالة</div>
              </div>
              <button
                type="button"
                onClick={() => setDeliveryEnabled(!deliveryEnabled)}
                style={{
                  padding: '6px 14px',
                  borderRadius: '10px',
                  border: 'none',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  background: deliveryEnabled ? '#10b981' : '#ef4444',
                  color: 'white',
                  transition: 'all 0.2s'
                }}
              >
                {deliveryEnabled ? 'مفعّل' : 'معطّل'}
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
                  السعر الأساسي للتوصيل (ج.م):
                </label>
                <input
                  type="number"
                  min="0"
                  value={baseDeliveryFee}
                  onChange={(e) => setBaseDeliveryFee(e.target.value)}
                  style={{ width: '100%', padding: '10px', borderRadius: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: 'white' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
                  المسافة الأساسية المشمولة (كم):
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={baseDistanceKm}
                  onChange={(e) => setBaseDistanceKm(e.target.value)}
                  style={{ width: '100%', padding: '10px', borderRadius: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: 'white' }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
                  سعر كل كم إضافي (ج.م/كم):
                </label>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  value={deliveryPerKmRate}
                  onChange={(e) => setDeliveryPerKmRate(e.target.value)}
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
                  خطوة تقريب السعر (مضاعفات):
                </label>
                <select
                  value={deliveryRoundingStep}
                  onChange={(e) => setDeliveryRoundingStep(Number(e.target.value))}
                  style={{ width: '100%', padding: '10px', borderRadius: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: 'white' }}
                >
                  <option value={5}>أقرب 5 جنيهات (5, 10, 15...)</option>
                  <option value={1}>رقم صحيح بدون كسور (1 ج)</option>
                  <option value={0}>بدون تقريب</option>
                </select>
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

        {/* Card 3: بيانات الدفع ورسوم الخدمة الإلكترونية */}
        <div className="card" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: '16px', padding: '20px' }}>
          <h2 style={{ fontSize: '1.15rem', fontWeight: 'bold', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px', color: 'white' }}>
            <CreditCard size={20} color="#a855f7" />
            <span>الحسابات ورسوم الخدمة الإلكترونية</span>
          </h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: 'rgba(255, 255, 255, 0.03)', borderRadius: '12px', border: '1px solid var(--border)' }}>
              <div>
                <div style={{ fontWeight: 'bold', color: 'white' }}>رسوم الخدمة الإلكترونية</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>تطبق على إنستاباي والمحافظ الرقمية فقط</div>
              </div>
              <button
                type="button"
                onClick={() => setServiceFeeEnabled(!serviceFeeEnabled)}
                style={{
                  padding: '6px 14px',
                  borderRadius: '10px',
                  border: 'none',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  background: serviceFeeEnabled ? '#a855f7' : '#64748b',
                  color: 'white',
                  transition: 'all 0.2s'
                }}
              >
                {serviceFeeEnabled ? 'مفعّل' : 'معطّل'}
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
                  قيمة الشريحة (ج.م):
                </label>
                <input
                  type="number"
                  min="50"
                  value={serviceFeeChunk}
                  onChange={(e) => setServiceFeeChunk(e.target.value)}
                  style={{ width: '100%', padding: '10px', borderRadius: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: 'white' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
                  رسوم الشريحة (ج.م):
                </label>
                <input
                  type="number"
                  min="0"
                  value={serviceFeePerChunk}
                  onChange={(e) => setServiceFeePerChunk(e.target.value)}
                  style={{ width: '100%', padding: '10px', borderRadius: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: 'white' }}
                />
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
                عنوان انستاباي (InstaPay IPA):
              </label>
              <input
                type="text"
                dir="ltr"
                value={instapayIpa}
                onChange={(e) => setInstapayIpa(e.target.value)}
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
                style={{ width: '100%', padding: '10px', borderRadius: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: 'white' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
                اسم صاحب الحساب التجاري:
              </label>
              <input
                type="text"
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                style={{ width: '100%', padding: '10px', borderRadius: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: 'white' }}
              />
            </div>
          </div>
        </div>

        {/* Card 4: إعدادات عربون الحجوزات */}
        <div className="card" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: '16px', padding: '20px' }}>
          <h2 style={{ fontSize: '1.15rem', fontWeight: 'bold', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px', color: 'white' }}>
            <Calendar size={20} color="#38bdf8" />
            <span>عربون الحجوزات وإدارتها</span>
          </h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
                  مبلغ العربون الأساسي (ج.م):
                </label>
                <input
                  type="number"
                  min="0"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  style={{ width: '100%', padding: '10px', borderRadius: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: 'white' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
                  مصاريف خدمة الحجز (ج.م):
                </label>
                <input
                  type="number"
                  min="0"
                  value={reservationFee}
                  onChange={(e) => setReservationFee(e.target.value)}
                  style={{ width: '100%', padding: '10px', borderRadius: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: 'white' }}
                />
              </div>
            </div>

            <div style={{ padding: '12px', background: 'rgba(56, 189, 248, 0.1)', borderRadius: '12px', border: '1px solid rgba(56, 189, 248, 0.2)' }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 'bold', color: '#38bdf8' }}>
                الإجمالي المطلوب من العميل لتأكيد الحجز: {(Number(depositAmount) || 0) + (Number(reservationFee) || 0)} ج.م
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                يتم تحديث المبلغ في تطبيق المنيو فوراً ويطلب من العميل رفع إيصال التحويل.
              </div>
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
    </>
  )}

  {/* Tab 2: Menu Items & Availability Management */}
  {activeSubTab === 'menu_items' && (
    <div>
      {/* Controls Bar: Search, Category, Status */}
      <div className="card" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: '16px', padding: '20px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
          
          {/* Search */}
          <div style={{ position: 'relative', flex: '1 1 240px' }}>
            <Search size={18} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="ابحث عن صنف بالاسم أو الوصف..."
              value={menuSearch}
              onChange={(e) => setMenuSearch(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 38px 10px 14px',
                borderRadius: '10px',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid var(--border)',
                color: 'white',
                fontSize: '0.9rem'
              }}
            />
          </div>

          {/* Category Filter */}
          <div style={{ flex: '0 1 200px' }}>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: '10px',
                background: '#1e293b',
                border: '1px solid var(--border)',
                color: 'white',
                fontSize: '0.9rem'
              }}
            >
              <option value="all">جميع التصنيفات ({categoriesList.length})</option>
              {categoriesList.map(cat => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
          </div>

          {/* Status Filter */}
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {[
              { id: 'all', label: 'الكل' },
              { id: 'available', label: '🟢 متاح' },
              { id: 'out_of_stock', label: '🔴 نفذت الكمية' },
              { id: 'paused', label: '⏸️ موقوف' }
            ].map(st => (
              <button
                key={st.id}
                type="button"
                onClick={() => setStatusFilter(st.id)}
                style={{
                  background: statusFilter === st.id ? 'var(--primary)' : 'rgba(255,255,255,0.05)',
                  color: statusFilter === st.id ? '#000' : 'white',
                  border: '1px solid var(--border)',
                  padding: '8px 14px',
                  borderRadius: '8px',
                  fontSize: '0.85rem',
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}
              >
                {st.label}
              </button>
            ))}
          </div>
        </div>

        {/* Summary counters */}
        <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', gap: '16px', flexWrap: 'wrap', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          <span>إجمالي المعروض: <strong style={{ color: 'white' }}>{filteredMenuItems.length}</strong></span>
          <span>المتاح: <strong style={{ color: '#34d399' }}>{menuItems.filter(i => i.status === 'available').length}</strong></span>
          <span>نفذت الكمية: <strong style={{ color: '#f87171' }}>{menuItems.filter(i => i.status === 'out_of_stock').length}</strong></span>
          <span>موقوف / مخفي: <strong style={{ color: '#fbbf24' }}>{menuItems.filter(i => i.status === 'paused' || i.status === 'hidden').length}</strong></span>
        </div>
      </div>

      {/* Menu Items Grid */}
      {loadingMenu ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '300px', gap: '12px' }}>
          <RefreshCw className="animate-spin" size={32} color="var(--primary)" />
          <p style={{ color: 'var(--text-muted)' }}>جاري جلب أصناف المنيو من الخادم...</p>
        </div>
      ) : filteredMenuItems.length === 0 ? (
        <div className="card" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: '16px', padding: '40px', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '1.1rem' }}>لا توجد أصناف تطابق معايير البحث.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
          {filteredMenuItems.map(item => {
            const isAvailable = item.status === 'available';
            const isUpdating = updatingItemId === item.id;

            return (
              <div
                key={item.id}
                className="card"
                style={{
                  background: 'var(--card-bg)',
                  border: `1px solid ${isAvailable ? 'rgba(52, 211, 153, 0.2)' : 'rgba(239, 68, 68, 0.2)'}`,
                  borderRadius: '14px',
                  padding: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  opacity: isAvailable ? 1 : 0.75,
                  transition: 'all 0.2s'
                }}
              >
                <div>
                  {/* Top Row: Category badge & Price */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{
                      background: 'rgba(255, 255, 255, 0.08)',
                      color: '#94a3b8',
                      padding: '3px 8px',
                      borderRadius: '6px',
                      fontSize: '0.75rem',
                      fontWeight: 'bold'
                    }}>
                      {item.categoryName || 'عام'}
                    </span>
                    
                    <span style={{ fontSize: '1.1rem', fontWeight: '800', color: 'var(--primary)' }}>
                      {item.price} <small style={{ fontSize: '0.75rem' }}>ج.م</small>
                    </span>
                  </div>

                  {/* Item Name */}
                  <h3 style={{ fontSize: '1.05rem', fontWeight: 'bold', color: 'white', marginBottom: '6px' }}>
                    {item.name}
                  </h3>

                  {/* Description */}
                  {item.description && (
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '12px', lineHeight: '1.4', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {item.description}
                    </p>
                  )}
                </div>

                {/* Bottom Controls */}
                <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid rgba(255, 255, 255, 0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                  {/* Detailed status select */}
                  <select
                    value={item.status}
                    onChange={(e) => handleUpdateItemStatus(item.id, e.target.value)}
                    disabled={isUpdating}
                    style={{
                      flex: '1',
                      padding: '6px 8px',
                      borderRadius: '8px',
                      background: '#1e293b',
                      border: '1px solid var(--border)',
                      color: isAvailable ? '#34d399' : '#f87171',
                      fontSize: '0.8rem',
                      fontWeight: 'bold'
                    }}
                  >
                    <option value="available">🟢 متاح للطلب</option>
                    <option value="out_of_stock">🔴 نفذت الكمية</option>
                    <option value="paused">⏸️ موقوف مؤقتًا</option>
                    <option value="hidden">👁️ مخفي</option>
                  </select>

                  {/* Quick Toggle Button */}
                  <button
                    type="button"
                    onClick={() => handleToggleItemAvailability(item)}
                    disabled={isUpdating}
                    style={{
                      background: isAvailable ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                      color: isAvailable ? '#f87171' : '#34d399',
                      border: `1px solid ${isAvailable ? '#ef4444' : '#10b981'}`,
                      padding: '6px 12px',
                      borderRadius: '8px',
                      fontSize: '0.8rem',
                      fontWeight: 'bold',
                      cursor: isUpdating ? 'wait' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                    title={isAvailable ? 'تعطيل الصنف (نفذت الكمية)' : 'إتاحة الصنف للطلب'}
                  >
                    {isUpdating ? (
                      <RefreshCw className="animate-spin" size={14} />
                    ) : isAvailable ? (
                      <>
                        <X size={14} />
                        <span>تعطيل</span>
                      </>
                    ) : (
                      <>
                        <Check size={14} />
                        <span>إتاحة</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  )}
    </div>
  );
};

export default SettingsView;
