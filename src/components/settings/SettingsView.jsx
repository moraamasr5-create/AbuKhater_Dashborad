import React, { useState, useEffect } from 'react';
import { 
  Settings, Save, RefreshCw, Power, DollarSign, MapPin, 
  CreditCard, Clock, AlertCircle, CheckCircle2, Shield, Plus, Trash2,
  Truck, Calendar, Percent, UtensilsCrossed, Search, Check, X, Filter,
  ChevronDown, ChevronUp, ChevronLeft, Info, Sliders, Lock
} from 'lucide-react';
import { supabaseService } from '../../services/supabaseService';
import { MenuManagementView } from './MenuManagementView';

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

  // Areas Accordion & Filter
  const [isAreasOpen, setIsAreasOpen] = useState(false);
  const [areaSearch, setAreaSearch] = useState('');

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

      showFeedback('success', 'تم حفظ وتطبيق جميع الإعدادات وقواعد التسعير بنجاح');
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

  // Filtered areas for compact list
  const filteredAreas = areas.filter(a => 
    !areaSearch || a.name.toLowerCase().includes(areaSearch.toLowerCase()) || String(a.zone).includes(areaSearch)
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
    <div style={{ paddingBottom: '60px', maxWidth: '1280px', margin: '0 auto' }}>
      
      {/* Top Bar: Title & Quick Actions */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        marginBottom: '20px', 
        flexWrap: 'wrap', 
        gap: '16px',
        padding: '16px 20px',
        background: 'var(--card-bg)',
        border: '1px solid var(--border)',
        borderRadius: '16px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ 
            width: '46px', 
            height: '46px', 
            borderRadius: '12px', 
            background: 'rgba(234, 179, 8, 0.15)', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            color: 'var(--primary)'
          }}>
            <Settings size={26} />
          </div>
          <div>
            <h1 style={{ fontSize: '1.4rem', fontWeight: '800', color: 'white', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>إعدادات النظام والأسعار</span>
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '2px 0 0 0' }}>
              تحكم مركزي مباشر في محرك الطلبات وقواعد التسعير والدفع والتوصيل
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {activeSubTab === 'general' ? (
            <button
              onClick={handleSaveAll}
              disabled={saving}
              className="btn-primary"
              style={{
                background: 'var(--accent)',
                color: 'white',
                minHeight: '44px',
                padding: '10px 22px',
                fontSize: '0.95rem',
                fontWeight: 'bold',
                boxShadow: '0 4px 14px rgba(16, 185, 129, 0.3)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                borderRadius: '12px',
                cursor: saving ? 'wait' : 'pointer'
              }}
            >
              {saving ? <RefreshCw className="animate-spin" size={18} /> : <Save size={18} />}
              <span>{saving ? 'جاري الحفظ...' : 'حفظ التعديلات'}</span>
            </button>
          ) : (
            <button
              onClick={loadMenuItems}
              disabled={loadingMenu}
              className="btn-primary"
              style={{
                background: 'rgba(255, 255, 255, 0.08)',
                color: 'white',
                minHeight: '44px',
                padding: '10px 18px',
                fontSize: '0.9rem',
                fontWeight: 'bold',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                borderRadius: '12px',
                border: '1px solid var(--border)',
                cursor: loadingMenu ? 'wait' : 'pointer'
              }}
            >
              <RefreshCw className={loadingMenu ? 'animate-spin' : ''} size={18} />
              <span>تحديث الأصناف</span>
            </button>
          )}
        </div>
      </div>

      {/* 5-Second Overview Status Strip */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
        gap: '12px', 
        marginBottom: '20px' 
      }}>
        {/* Status 1: Restaurant State */}
        <div style={{ 
          background: isOpen ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)', 
          border: `1px solid ${isOpen ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
          borderRadius: '12px',
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Power size={18} color={isOpen ? '#10b981' : '#ef4444'} />
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>حالة المطعم:</span>
          </div>
          <span style={{ fontWeight: 'bold', color: isOpen ? '#34d399' : '#f87171', fontSize: '0.9rem' }}>
            {isOpen ? '🟢 مفتوح للطلبات' : '🔴 مغلق مؤقتاً'}
          </span>
        </div>

        {/* Status 2: Delivery State */}
        <div style={{ 
          background: deliveryEnabled ? 'rgba(56, 189, 248, 0.1)' : 'rgba(100, 116, 139, 0.1)', 
          border: `1px solid ${deliveryEnabled ? 'rgba(56, 189, 248, 0.3)' : 'rgba(100, 116, 139, 0.3)'}`,
          borderRadius: '12px',
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Truck size={18} color={deliveryEnabled ? '#38bdf8' : '#94a3b8'} />
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>خدمة التوصيل:</span>
          </div>
          <span style={{ fontWeight: 'bold', color: deliveryEnabled ? '#38bdf8' : '#94a3b8', fontSize: '0.9rem' }}>
            {deliveryEnabled ? 'مفعلة' : 'معطلة'}
          </span>
        </div>

        {/* Status 3: Base Delivery Fee */}
        <div style={{ 
          background: 'rgba(255, 255, 255, 0.03)', 
          border: '1px solid var(--border)',
          borderRadius: '12px',
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <DollarSign size={18} color="var(--primary)" />
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>التوصيل الأساسي:</span>
          </div>
          <span style={{ fontWeight: 'bold', color: 'white', fontSize: '0.9rem' }}>
            {baseDeliveryFee} ج.م <small style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>({baseDistanceKm} كم)</small>
          </span>
        </div>

        {/* Status 4: Delivery Zones Count */}
        <div style={{ 
          background: 'rgba(255, 255, 255, 0.03)', 
          border: '1px solid var(--border)',
          borderRadius: '12px',
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <MapPin size={18} color="#a855f7" />
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>مناطق التوصيل:</span>
          </div>
          <span style={{ fontWeight: 'bold', color: '#c084fc', fontSize: '0.9rem' }}>
            {areas.length} منطقة مسجلة
          </span>
        </div>
      </div>

      {/* Sub Tab Navigation */}
      <div style={{ 
        display: 'flex', 
        gap: '8px', 
        marginBottom: '20px', 
        background: 'rgba(0, 0, 0, 0.2)',
        padding: '6px',
        borderRadius: '14px',
        border: '1px solid var(--border)'
      }}>
        <button
          type="button"
          onClick={() => setActiveSubTab('general')}
          style={{
            flex: '1',
            minHeight: '44px',
            background: activeSubTab === 'general' ? 'var(--primary)' : 'transparent',
            color: activeSubTab === 'general' ? '#000' : 'white',
            fontWeight: 'bold',
            padding: '10px 16px',
            borderRadius: '10px',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            transition: 'all 0.2s',
            fontSize: '0.95rem'
          }}
        >
          <Sliders size={18} />
          <span>إعدادات النظام والأسعار والتوصيل</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveSubTab('menu_items');
            loadMenuItems();
          }}
          style={{
            flex: '1',
            minHeight: '44px',
            background: activeSubTab === 'menu_items' ? 'var(--primary)' : 'transparent',
            color: activeSubTab === 'menu_items' ? '#000' : 'white',
            fontWeight: 'bold',
            padding: '10px 16px',
            borderRadius: '10px',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            transition: 'all 0.2s',
            fontSize: '0.95rem'
          }}
        >
          <UtensilsCrossed size={18} />
          <span>إدارة إتاحة أصناف المنيو</span>
          {menuItems.length > 0 && (
            <span style={{
              background: activeSubTab === 'menu_items' ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.1)',
              padding: '2px 8px',
              borderRadius: '10px',
              fontSize: '0.75rem',
              fontWeight: '800'
            }}>
              {menuItems.filter(i => i.status === 'available').length}/{menuItems.length}
            </span>
          )}
        </button>
      </div>

      {/* Feedback Alert Message */}
      {statusMsg && (
        <div style={{
          padding: '14px 18px',
          borderRadius: '12px',
          marginBottom: '20px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          fontWeight: 'bold',
          background: statusMsg.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
          border: `1px solid ${statusMsg.type === 'success' ? '#10b981' : '#ef4444'}`,
          color: statusMsg.type === 'success' ? '#34d399' : '#f87171'
        }}>
          {statusMsg.type === 'success' ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
          <span style={{ fontSize: '0.95rem' }}>{statusMsg.message}</span>
        </div>
      )}

      {/* Tab 1: General Settings & Delivery */}
      {activeSubTab === 'general' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          {/* Section 1: 🏪 تشغيل المطعم والورديات (Primary Operations) */}
          <div className="card" style={{ 
            background: 'var(--card-bg)', 
            border: '1px solid var(--border)', 
            borderRadius: '16px', 
            padding: '20px' 
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'rgba(16, 185, 129, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#10b981' }}>
                  <Power size={20} />
                </div>
                <div>
                  <h2 style={{ fontSize: '1.15rem', fontWeight: 'bold', color: 'white', margin: 0 }}>
                    🏪 تشغيل المطعم والورديات
                  </h2>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>حالة استقبال الطلبات والتحكم في الورديات اليومية</span>
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px' }}>
              {/* Toggle 1: Open / Close */}
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center', 
                padding: '14px 16px', 
                background: 'rgba(255, 255, 255, 0.02)', 
                borderRadius: '12px', 
                border: '1px solid var(--border)' 
              }}>
                <div>
                  <div style={{ fontWeight: 'bold', color: 'white', fontSize: '0.95rem' }}>استقبال الطلبات (أونلاين)</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '2px' }}>إغلاق الاستقبال يمنع إنشاء طلبات جديدة فوراً</div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsOpen(!isOpen)}
                  style={{
                    minHeight: '44px',
                    minWidth: '130px',
                    padding: '8px 16px',
                    borderRadius: '10px',
                    border: 'none',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    background: isOpen ? '#10b981' : '#ef4444',
                    color: 'white',
                    transition: 'all 0.2s',
                    fontSize: '0.9rem',
                    boxShadow: isOpen ? '0 2px 8px rgba(16, 185, 129, 0.3)' : '0 2px 8px rgba(239, 68, 68, 0.3)'
                  }}
                >
                  {isOpen ? '🟢 مفتوح للطلبات' : '🔴 مغلق حالياً'}
                </button>
              </div>

              {/* Toggle 2: Require Active Shift */}
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center', 
                padding: '14px 16px', 
                background: 'rgba(255, 255, 255, 0.02)', 
                borderRadius: '12px', 
                border: '1px solid var(--border)' 
              }}>
                <div>
                  <div style={{ fontWeight: 'bold', color: 'white', fontSize: '0.95rem' }}>إلزامية وجود وردية مفتوحة</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '2px' }}>رفض الطلبات تلقائياً إذا لم تكن هناك وردية نشطة</div>
                </div>
                <button
                  type="button"
                  onClick={() => setRequireActiveShift(!requireActiveShift)}
                  style={{
                    minHeight: '44px',
                    minWidth: '100px',
                    padding: '8px 16px',
                    borderRadius: '10px',
                    border: 'none',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    background: requireActiveShift ? '#3b82f6' : '#64748b',
                    color: 'white',
                    transition: 'all 0.2s',
                    fontSize: '0.9rem'
                  }}
                >
                  {requireActiveShift ? 'مُفعّل' : 'معطّل'}
                </button>
              </div>

              {/* Shift Times */}
              <div style={{ 
                gridColumn: '1 / -1',
                display: 'grid', 
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', 
                gap: '12px',
                padding: '14px 16px',
                background: 'rgba(255, 255, 255, 0.02)',
                borderRadius: '12px',
                border: '1px solid var(--border)'
              }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 'bold' }}>
                    وقت بدء الوردية (يومياً):
                  </label>
                  <input
                    type="time"
                    value={shiftOpenTime}
                    onChange={(e) => setShiftOpenTime(e.target.value)}
                    style={{ 
                      width: '100%', 
                      minHeight: '44px',
                      padding: '8px 12px', 
                      borderRadius: '10px', 
                      background: 'rgba(255,255,255,0.05)', 
                      border: '1px solid var(--border)', 
                      color: 'white',
                      fontSize: '0.95rem'
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 'bold' }}>
                    وقت إغلاق الوردية (يومياً):
                  </label>
                  <input
                    type="time"
                    value={shiftCloseTime}
                    onChange={(e) => setShiftCloseTime(e.target.value)}
                    style={{ 
                      width: '100%', 
                      minHeight: '44px',
                      padding: '8px 12px', 
                      borderRadius: '10px', 
                      background: 'rgba(255,255,255,0.05)', 
                      border: '1px solid var(--border)', 
                      color: 'white',
                      fontSize: '0.95rem'
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: 💰 الأسعار والرسوم وقواعد التوصيل (Pricing & Delivery Engine) */}
          <div className="card" style={{ 
            background: 'var(--card-bg)', 
            border: '1px solid var(--border)', 
            borderRadius: '16px', 
            padding: '20px' 
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'rgba(234, 179, 8, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)' }}>
                  <Truck size={20} />
                </div>
                <div>
                  <h2 style={{ fontSize: '1.15rem', fontWeight: 'bold', color: 'white', margin: 0 }}>
                    💰 الأسعار وقواعد التوصيل (GPS & Distance)
                  </h2>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>حساب أسعار التوصيل التلقائية حسب المسافة وإحداثيات GPS</span>
                </div>
              </div>

              {/* Delivery Toggle Button */}
              <button
                type="button"
                onClick={() => setDeliveryEnabled(!deliveryEnabled)}
                style={{
                  minHeight: '40px',
                  padding: '6px 16px',
                  borderRadius: '10px',
                  border: 'none',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  background: deliveryEnabled ? '#10b981' : '#ef4444',
                  color: 'white',
                  transition: 'all 0.2s',
                  fontSize: '0.85rem'
                }}
              >
                {deliveryEnabled ? 'خدمة التوصيل: مفعلة' : 'خدمة التوصيل: معطلة'}
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
              {/* Base Fee */}
              <div style={{ padding: '12px', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid var(--border)' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 'bold' }}>
                  السعر الأساسي للتوصيل (ج.م):
                </label>
                <input
                  type="number"
                  min="0"
                  value={baseDeliveryFee}
                  onChange={(e) => setBaseDeliveryFee(e.target.value)}
                  style={{ width: '100%', minHeight: '44px', padding: '8px 12px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: '#34d399', fontWeight: 'bold', fontSize: '1.05rem' }}
                />
              </div>

              {/* Base Distance */}
              <div style={{ padding: '12px', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid var(--border)' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 'bold' }}>
                  المسافة المشمولة بالسعر الأساسي (كم):
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={baseDistanceKm}
                  onChange={(e) => setBaseDistanceKm(e.target.value)}
                  style={{ width: '100%', minHeight: '44px', padding: '8px 12px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: 'white', fontSize: '1rem' }}
                />
              </div>

              {/* Rate per KM */}
              <div style={{ padding: '12px', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid var(--border)' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 'bold' }}>
                  سعر كل كم إضافي (ج.م/كم):
                </label>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  value={deliveryPerKmRate}
                  onChange={(e) => setDeliveryPerKmRate(e.target.value)}
                  style={{ width: '100%', minHeight: '44px', padding: '8px 12px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: 'white', fontSize: '1rem' }}
                />
              </div>

              {/* Max Distance */}
              <div style={{ padding: '12px', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid var(--border)' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 'bold' }}>
                  أقصى نطاق توصيل مسموح (كم):
                </label>
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={maxDeliveryDistance}
                  onChange={(e) => setMaxDeliveryDistance(e.target.value)}
                  style={{ width: '100%', minHeight: '44px', padding: '8px 12px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: 'white', fontSize: '1rem' }}
                />
              </div>

              {/* Rounding Step */}
              <div style={{ padding: '12px', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid var(--border)' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 'bold' }}>
                  تقريب سعر التوصيل (مضاعفات):
                </label>
                <select
                  value={deliveryRoundingStep}
                  onChange={(e) => setDeliveryRoundingStep(Number(e.target.value))}
                  style={{ width: '100%', minHeight: '44px', padding: '8px 12px', borderRadius: '8px', background: '#1e293b', border: '1px solid var(--border)', color: 'white', fontSize: '0.9rem' }}
                >
                  <option value={5}>أقرب 5 جنيهات (5, 10, 15...)</option>
                  <option value={1}>رقم صحيح بدون كسور (1 ج)</option>
                  <option value={0}>بدون تقريب</option>
                </select>
              </div>

              {/* Minimum Order */}
              <div style={{ padding: '12px', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid var(--border)' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 'bold' }}>
                  الحد الأدنى لقيمة الطلب (ج.م):
                </label>
                <input
                  type="number"
                  min="0"
                  value={minOrderAmount}
                  onChange={(e) => setMinOrderAmount(e.target.value)}
                  style={{ width: '100%', minHeight: '44px', padding: '8px 12px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: 'white', fontSize: '1rem' }}
                />
              </div>
            </div>

            {/* Formula Helper Info Strip */}
            <div style={{ 
              marginTop: '16px', 
              padding: '10px 14px', 
              background: 'rgba(234, 179, 8, 0.08)', 
              borderRadius: '10px', 
              border: '1px solid rgba(234, 179, 8, 0.2)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '0.82rem',
              color: 'var(--text-muted)'
            }}>
              <Info size={16} color="var(--primary)" />
              <span>
                معادلة الحساب: <strong style={{ color: 'white' }}>{baseDeliveryFee} ج.م</strong> لأول <strong style={{ color: 'white' }}>{baseDistanceKm} كم</strong>، ثم <strong style={{ color: 'white' }}>{deliveryPerKmRate} ج.م/كم</strong> إضافي، بحد أقصى <strong style={{ color: 'white' }}>{maxDeliveryDistance} كم</strong>.
              </span>
            </div>
          </div>

          {/* Section 3: 💳 الدفع الإلكتروني والحسابات المالية (Payment & Accounts) */}
          <div className="card" style={{ 
            background: 'var(--card-bg)', 
            border: '1px solid var(--border)', 
            borderRadius: '16px', 
            padding: '20px' 
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'rgba(168, 85, 247, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#a855f7' }}>
                  <CreditCard size={20} />
                </div>
                <div>
                  <h2 style={{ fontSize: '1.15rem', fontWeight: 'bold', color: 'white', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span>💳 بيانات الدفع ورسوم الخدمة الإلكترونية</span>
                    <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: '6px', background: 'rgba(239, 68, 68, 0.15)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.3)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Lock size={10} /> بيانات حساسة
                    </span>
                  </h2>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>حسابات التحويل المالي (InstaPay ومحافظ فودافون) ورسوم الخدمة</span>
                </div>
              </div>

              {/* Service Fee Toggle */}
              <button
                type="button"
                onClick={() => setServiceFeeEnabled(!serviceFeeEnabled)}
                style={{
                  minHeight: '40px',
                  padding: '6px 14px',
                  borderRadius: '10px',
                  border: 'none',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  background: serviceFeeEnabled ? '#a855f7' : '#64748b',
                  color: 'white',
                  transition: 'all 0.2s',
                  fontSize: '0.85rem'
                }}
              >
                {serviceFeeEnabled ? 'رسوم الخدمة: مفعلة' : 'رسوم الخدمة: معطلة'}
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
              {/* InstaPay IPA */}
              <div style={{ padding: '12px', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid var(--border)' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 'bold' }}>
                  عنوان إنستاباي (InstaPay IPA):
                </label>
                <input
                  type="text"
                  dir="ltr"
                  value={instapayIpa}
                  onChange={(e) => setInstapayIpa(e.target.value)}
                  style={{ width: '100%', minHeight: '44px', padding: '8px 12px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: '#38bdf8', fontWeight: 'bold', fontSize: '0.95rem' }}
                />
              </div>

              {/* Wallet Number */}
              <div style={{ padding: '12px', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid var(--border)' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 'bold' }}>
                  رقم المحفظة الإلكترونية (فودافون كاش / أورنج):
                </label>
                <input
                  type="text"
                  dir="ltr"
                  value={walletNumber}
                  onChange={(e) => setWalletNumber(e.target.value)}
                  style={{ width: '100%', minHeight: '44px', padding: '8px 12px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: '#34d399', fontWeight: 'bold', fontSize: '0.95rem' }}
                />
              </div>

              {/* Account Name */}
              <div style={{ padding: '12px', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid var(--border)' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 'bold' }}>
                  اسم صاحب الحساب التجاري (للتأكيد):
                </label>
                <input
                  type="text"
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                  style={{ width: '100%', minHeight: '44px', padding: '8px 12px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: 'white', fontSize: '0.95rem' }}
                />
              </div>

              {/* Service Fee Chunk */}
              <div style={{ padding: '12px', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid var(--border)' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 'bold' }}>
                  قيمة شريحة التحويل (ج.م):
                </label>
                <input
                  type="number"
                  min="50"
                  value={serviceFeeChunk}
                  onChange={(e) => setServiceFeeChunk(e.target.value)}
                  style={{ width: '100%', minHeight: '44px', padding: '8px 12px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: 'white', fontSize: '0.95rem' }}
                />
              </div>

              {/* Fee Per Chunk */}
              <div style={{ padding: '12px', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid var(--border)' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 'bold' }}>
                  رسوم الشريحة (ج.م لكل {serviceFeeChunk} ج):
                </label>
                <input
                  type="number"
                  min="0"
                  value={serviceFeePerChunk}
                  onChange={(e) => setServiceFeePerChunk(e.target.value)}
                  style={{ width: '100%', minHeight: '44px', padding: '8px 12px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: 'white', fontSize: '0.95rem' }}
                />
              </div>

              {/* Reservation Deposit */}
              <div style={{ padding: '12px', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid var(--border)' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 'bold' }}>
                  عربون الحجز الأساسي (ج.م):
                </label>
                <input
                  type="number"
                  min="0"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  style={{ width: '100%', minHeight: '44px', padding: '8px 12px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: '#38bdf8', fontWeight: 'bold', fontSize: '0.95rem' }}
                />
              </div>
            </div>
          </div>

          {/* Section 4: 🚚 مناطق التوصيل الـ16 (Compact Accordion & Drawer UX) */}
          <div className="card" style={{ 
            background: 'var(--card-bg)', 
            border: '1px solid var(--border)', 
            borderRadius: '16px', 
            padding: '20px',
            overflow: 'hidden'
          }}>
            {/* Header / Click to Expand */}
            <div 
              onClick={() => setIsAreasOpen(!isAreasOpen)}
              style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center', 
                cursor: 'pointer',
                userSelect: 'none',
                padding: '4px 0'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: 'rgba(168, 85, 247, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#c084fc' }}>
                  <MapPin size={22} />
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <h2 style={{ fontSize: '1.15rem', fontWeight: 'bold', color: 'white', margin: 0 }}>
                      🚚 مناطق التوصيل ورسومها المحددة مسبقاً
                    </h2>
                    <span style={{ 
                      background: 'rgba(192, 132, 252, 0.15)', 
                      color: '#c084fc', 
                      fontSize: '0.78rem', 
                      padding: '2px 8px', 
                      borderRadius: '8px',
                      fontWeight: 'bold'
                    }}>
                      {areas.length} منطقة
                    </span>
                  </div>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: '2px 0 0 0' }}>
                    تظهر في قائمة الاختيار السريع للعنوان في تطبيق المنيو
                  </p>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minHeight: '44px', padding: '0 8px' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--primary)', fontWeight: 'bold' }}>
                  {isAreasOpen ? 'إخفاء التفاصيل' : 'عرض وإدارة المناطق ›'}
                </span>
                <div style={{ 
                  width: '32px', 
                  height: '32px', 
                  borderRadius: '8px', 
                  background: 'rgba(255, 255, 255, 0.05)', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  color: 'white' 
                }}>
                  {isAreasOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </div>
              </div>
            </div>

            {/* Collapsed Preview Strip (when closed) */}
            {!isAreasOpen && (
              <div style={{ 
                marginTop: '14px', 
                padding: '12px 16px', 
                background: 'rgba(255, 255, 255, 0.02)', 
                borderRadius: '12px', 
                border: '1px solid rgba(255, 255, 255, 0.05)',
                display: 'flex', 
                gap: '8px', 
                flexWrap: 'wrap',
                alignItems: 'center'
              }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>أبرز المناطق:</span>
                {areas.slice(0, 6).map((a, i) => (
                  <span key={i} style={{ 
                    background: 'rgba(255, 255, 255, 0.06)', 
                    color: 'white', 
                    fontSize: '0.78rem', 
                    padding: '3px 8px', 
                    borderRadius: '6px' 
                  }}>
                    {a.name} ({a.fee} ج)
                  </span>
                ))}
                {areas.length > 6 && (
                  <span style={{ fontSize: '0.78rem', color: 'var(--primary)' }}>
                    +{areas.length - 6} مناطق أخرى
                  </span>
                )}
              </div>
            )}

            {/* Expanded Detailed Area Management */}
            {isAreasOpen && (
              <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
                {/* Search & Add New Area Toolbar */}
                <div style={{ 
                  display: 'flex', 
                  gap: '10px', 
                  flexWrap: 'wrap', 
                  alignItems: 'center', 
                  justifyContent: 'space-between', 
                  marginBottom: '16px' 
                }}>
                  {/* Search Filter */}
                  <div style={{ position: 'relative', flex: '1 1 200px' }}>
                    <Search size={16} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                    <input
                      type="text"
                      placeholder="بحث في المناطق أو النطاق..."
                      value={areaSearch}
                      onChange={(e) => setAreaSearch(e.target.value)}
                      style={{
                        width: '100%',
                        minHeight: '40px',
                        padding: '8px 34px 8px 12px',
                        borderRadius: '8px',
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid var(--border)',
                        color: 'white',
                        fontSize: '0.85rem'
                      }}
                    />
                  </div>

                  {/* Add New Area Input Row */}
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                      type="text"
                      placeholder="اسم المنطقة الجديدة"
                      value={newAreaName}
                      onChange={(e) => setNewAreaName(e.target.value)}
                      style={{ minHeight: '40px', padding: '6px 12px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: 'white', fontSize: '0.85rem', width: '150px' }}
                    />
                    <input
                      type="number"
                      placeholder="السعر (ج)"
                      value={newAreaFee}
                      onChange={(e) => setNewAreaFee(e.target.value)}
                      style={{ minHeight: '40px', padding: '6px 12px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: 'white', fontSize: '0.85rem', width: '90px' }}
                    />
                    <button
                      type="button"
                      onClick={handleAddArea}
                      className="btn-primary"
                      style={{ 
                        background: 'var(--primary)', 
                        minHeight: '40px', 
                        padding: '6px 14px', 
                        borderRadius: '8px', 
                        fontSize: '0.85rem', 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '6px' 
                      }}
                    >
                      <Plus size={16} />
                      <span>إضافة منطقة</span>
                    </button>
                  </div>
                </div>

                {/* Compact Table / List */}
                <div style={{ overflowX: 'auto', maxHeight: '420px', overflowY: 'auto', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: '0.85rem' }}>
                    <thead style={{ position: 'sticky', top: 0, background: '#1e293b', zIndex: 1 }}>
                      <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                        <th style={{ padding: '10px 14px' }}>المنطقة</th>
                        <th style={{ padding: '10px 14px' }}>النطاق (Zone)</th>
                        <th style={{ padding: '10px 14px' }}>سعر التوصيل</th>
                        <th style={{ padding: '10px 14px', textAlign: 'center' }}>إجراءات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAreas.map((area, index) => {
                        const originalIndex = areas.findIndex(a => a.name === area.name);
                        return (
                          <tr key={index} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', background: index % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                            <td style={{ padding: '8px 14px', fontWeight: 'bold', color: 'white' }}>{area.name}</td>
                            <td style={{ padding: '8px 14px', color: 'var(--text-muted)' }}>
                              <span style={{ background: 'rgba(255,255,255,0.06)', padding: '2px 6px', borderRadius: '4px', fontSize: '0.75rem' }}>
                                نطاق {area.zone || 1}
                              </span>
                            </td>
                            <td style={{ padding: '8px 14px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <input
                                  type="number"
                                  min="0"
                                  value={area.fee}
                                  onChange={(e) => handleUpdateAreaFee(originalIndex !== -1 ? originalIndex : index, e.target.value)}
                                  style={{
                                    width: '85px',
                                    padding: '5px 8px',
                                    borderRadius: '6px',
                                    background: 'rgba(255,255,255,0.05)',
                                    border: '1px solid var(--border)',
                                    color: '#34d399',
                                    fontWeight: 'bold',
                                    fontSize: '0.9rem'
                                  }}
                                />
                                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>ج.م</span>
                              </div>
                            </td>
                            <td style={{ padding: '8px 14px', textAlign: 'center' }}>
                              <button
                                type="button"
                                onClick={() => handleDeleteArea(originalIndex !== -1 ? originalIndex : index)}
                                style={{
                                  background: 'rgba(239, 68, 68, 0.1)',
                                  border: '1px solid rgba(239, 68, 68, 0.2)',
                                  color: '#f87171',
                                  padding: '5px 8px',
                                  borderRadius: '6px',
                                  cursor: 'pointer'
                                }}
                                title="حذف المنطقة"
                              >
                                <Trash2 size={14} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

        </div>
      )}

      {/* Tab 2: Menu Items & Categories Full Management */}
      {activeSubTab === 'menu_items' && (
        <MenuManagementView />
      )}
    </div>
  );
};

export default SettingsView;
