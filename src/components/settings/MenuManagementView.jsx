import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  UtensilsCrossed, Plus, Search, Filter, Check, X, 
  ChevronDown, ChevronUp, ArrowUp, ArrowDown, Edit3, Trash2, 
  Upload, Image as ImageIcon, Star, AlertCircle, CheckCircle2, 
  RefreshCw, Layers, Eye, EyeOff, DollarSign, Tag, MoveVertical,
  ExternalLink, Sparkles, ShieldAlert, Lock
} from 'lucide-react';
import { supabaseService } from '../../services/supabaseService';
import { useApp } from '../../context/AppContext';

/**
 * Converts Google Drive / CDN / Storage URLs to displayable image URLs
 */
export const getDisplayImageUrl = (url) => {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  // Google Drive conversion
  const driveMatch = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || trimmed.match(/id=([a-zA-Z0-9_-]+)/);
  if (driveMatch && driveMatch[1]) {
    return `https://lh3.googleusercontent.com/d/${driveMatch[1]}`;
  }

  return trimmed;
};

export const MenuManagementView = () => {
  const { userRole } = useApp() || {};
  const isAdmin = userRole === 'admin';

  // ─────────────────────────────────────────────────────────
  // State Management
  // ─────────────────────────────────────────────────────────
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [updatingItemId, setUpdatingItemId] = useState(null);
  const [statusMsg, setStatusMsg] = useState(null);

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all'); // 'all' | 'available' | 'out_of_stock' | 'hidden_paused' | 'popular'

  // Accordion state: Set of open category IDs
  const [openCategories, setOpenCategories] = useState(new Set());

  // Item Drawer Editor State
  const [isItemDrawerOpen, setIsItemDrawerOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null); // null = create mode
  const [itemForm, setItemForm] = useState({
    name: '',
    description: '',
    price: '',
    category_id: '',
    image_url: '',
    status: 'available',
    is_popular: false,
    display_order: 0,
    unit_type: 'qty',
    base_qty: 1
  });
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = useRef(null);

  // Category Manager Modal State
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryOrder, setNewCategoryOrder] = useState(0);

  // Delete Confirmation State
  const [deleteConfirm, setDeleteConfirm] = useState(null); // { type: 'item' | 'category', item: object }

  // ─────────────────────────────────────────────────────────
  // Data Loading
  // ─────────────────────────────────────────────────────────
  const loadData = async () => {
    try {
      setLoading(true);
      const [itemsData, catsData] = await Promise.all([
        supabaseService.fetchMenuItemsAdmin(),
        supabaseService.fetchCategories()
      ]);

      const loadedItems = itemsData || [];
      const loadedCats = catsData || [];

      setItems(loadedItems);
      setCategories(loadedCats);

      // Auto-open first 2 categories on initial load if none opened
      if (openCategories.size === 0 && loadedCats.length > 0) {
        setOpenCategories(new Set(loadedCats.slice(0, 2).map(c => c.id)));
      }
    } catch (err) {
      console.error('[MenuManagement] Failed to load data:', err);
      showStatus('فشل في جلب بيانات المنيو: ' + (err.message || 'خطأ غير معروف'), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const showStatus = (text, type = 'success') => {
    setStatusMsg({ text, type });
    setTimeout(() => {
      setStatusMsg(null);
    }, 4500);
  };

  // ─────────────────────────────────────────────────────────
  // Accordion Toggle Handlers
  // ─────────────────────────────────────────────────────────
  const toggleCategoryAccordion = (catId) => {
    setOpenCategories(prev => {
      const next = new Set(prev);
      if (next.has(catId)) {
        next.delete(catId);
      } else {
        next.add(catId);
      }
      return next;
    });
  };

  const expandAllCategories = () => {
    setOpenCategories(new Set(categories.map(c => c.id)));
  };

  const collapseAllCategories = () => {
    setOpenCategories(new Set());
  };

  // ─────────────────────────────────────────────────────────
  // Quick Availability Toggle
  // ─────────────────────────────────────────────────────────
  const handleToggleAvailability = async (item) => {
    if (updatingItemId) return;
    const isCurrentlyAvailable = item.status === 'available';
    const nextStatus = isCurrentlyAvailable ? 'out_of_stock' : 'available';

    // Optimistic state backup
    const previousItems = [...items];
    setUpdatingItemId(item.id);

    // Apply immediate local update
    setItems(prev => prev.map(i => i.id === item.id ? { 
      ...i, 
      status: nextStatus, 
      isAvailable: !isCurrentlyAvailable 
    } : i));

    try {
      await supabaseService.updateMenuItemStatus(item.id, nextStatus);
      showStatus(`تم تغيير حالة "${item.name}" إلى ${nextStatus === 'available' ? 'متاح 🟢' : 'غير متاح ⚪'}`);
    } catch (err) {
      console.error('[MenuManagement] Availability toggle failed:', err);
      // Rollback
      setItems(previousItems);
      showStatus(`فشل تحديث حالة الصنف: ${err.message || 'خطأ في الاتصال'}`, 'error');
    } finally {
      setUpdatingItemId(null);
    }
  };

  // ─────────────────────────────────────────────────────────
  // Quick Price Update
  // ─────────────────────────────────────────────────────────
  const handleQuickPriceChange = async (item, newPriceStr) => {
    const newPrice = parseFloat(newPriceStr);
    if (isNaN(newPrice) || newPrice < 0 || newPrice === item.price) return;

    const previousItems = [...items];
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, price: newPrice } : i));

    try {
      await supabaseService.updateMenuItem(item.id, { price: newPrice });
      showStatus(`تم تعديل سعر "${item.name}" إلى ${newPrice} ج.م`);
    } catch (err) {
      console.error('[MenuManagement] Price update failed:', err);
      setItems(previousItems);
      showStatus(`فشل تعديل السعر: ${err.message}`, 'error');
    }
  };

  // ─────────────────────────────────────────────────────────
  // Item Reordering (Move Up / Down within category)
  // ─────────────────────────────────────────────────────────
  const handleMoveItemOrder = async (item, direction, categoryItems) => {
    const currentIndex = categoryItems.findIndex(i => i.id === item.id);
    if (currentIndex === -1) return;

    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= categoryItems.length) return;

    const targetItem = categoryItems[targetIndex];

    const currentOrder = item.displayOrder ?? 0;
    const targetOrder = targetItem.displayOrder ?? 0;

    const newCurrentOrder = targetOrder;
    const newTargetOrder = currentOrder === targetOrder ? (direction === 'up' ? targetOrder + 1 : targetOrder - 1) : currentOrder;

    // Optimistic local update
    const previousItems = [...items];
    setItems(prev => prev.map(i => {
      if (i.id === item.id) return { ...i, displayOrder: newCurrentOrder };
      if (i.id === targetItem.id) return { ...i, displayOrder: newTargetOrder };
      return i;
    }));

    try {
      await Promise.all([
        supabaseService.updateMenuItem(item.id, { display_order: newCurrentOrder }),
        supabaseService.updateMenuItem(targetItem.id, { display_order: newTargetOrder })
      ]);
      showStatus(`تم تحديث ترتيب أصناف المنيو`);
    } catch (err) {
      console.error('[MenuManagement] Reorder failed:', err);
      setItems(previousItems);
      showStatus(`فشل تحديث الترتيب: ${err.message}`, 'error');
    }
  };

  // ─────────────────────────────────────────────────────────
  // Category Reordering (Move Up / Down)
  // ─────────────────────────────────────────────────────────
  const handleMoveCategoryOrder = async (category, direction) => {
    const currentIndex = categories.findIndex(c => c.id === category.id);
    if (currentIndex === -1) return;

    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= categories.length) return;

    const targetCategory = categories[targetIndex];

    const currentOrder = category.display_order ?? 0;
    const targetOrder = targetCategory.display_order ?? 0;

    const newCurrentOrder = targetOrder;
    const newTargetOrder = currentOrder === targetOrder ? (direction === 'up' ? targetOrder + 1 : targetOrder - 1) : currentOrder;

    const previousCats = [...categories];
    const updatedCats = [...categories];
    updatedCats[currentIndex] = { ...category, display_order: newCurrentOrder };
    updatedCats[targetIndex] = { ...targetCategory, display_order: newTargetOrder };
    updatedCats.sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));

    setCategories(updatedCats);

    try {
      await Promise.all([
        supabaseService.updateCategory(category.id, { display_order: newCurrentOrder }),
        supabaseService.updateCategory(targetCategory.id, { display_order: newTargetOrder })
      ]);
      showStatus(`تم تحديث ترتيب قسم "${category.name}"`);
    } catch (err) {
      console.error('[MenuManagement] Category reorder failed:', err);
      setCategories(previousCats);
      showStatus(`فشل تحديث ترتيب الأقسام: ${err.message}`, 'error');
    }
  };

  // ─────────────────────────────────────────────────────────
  // Open Item Drawer for Create / Edit
  // ─────────────────────────────────────────────────────────
  const handleOpenItemDrawer = (item = null, defaultCatId = '') => {
    if (item) {
      setEditingItem(item);
      setItemForm({
        name: item.name || '',
        description: item.description || '',
        price: item.price ?? '',
        category_id: item.categoryId || defaultCatId || (categories[0]?.id || ''),
        image_url: item.imageUrl || '',
        status: item.status || 'available',
        is_popular: Boolean(item.isPopular),
        display_order: item.displayOrder ?? 0,
        unit_type: item.unitType || 'qty',
        base_qty: item.baseQty ?? 1
      });
    } else {
      setEditingItem(null);
      const targetCatId = defaultCatId || (categories[0]?.id || '');
      const catItems = items.filter(i => i.categoryId === targetCatId);
      const nextOrder = catItems.length > 0 ? Math.max(...catItems.map(i => i.displayOrder || 0)) + 1 : 1;

      setItemForm({
        name: '',
        description: '',
        price: '',
        category_id: targetCatId,
        image_url: '',
        status: 'available',
        is_popular: false,
        display_order: nextOrder,
        unit_type: 'qty',
        base_qty: 1
      });
    }
    setIsItemDrawerOpen(true);
  };

  // ─────────────────────────────────────────────────────────
  // Save Item (Create or Update)
  // ─────────────────────────────────────────────────────────
  const handleSaveItem = async (e) => {
    e.preventDefault();
    if (!itemForm.name.trim()) {
      showStatus('يرجى إدخال اسم الصنف', 'error');
      return;
    }
    const priceNum = parseFloat(itemForm.price);
    if (isNaN(priceNum) || priceNum < 0) {
      showStatus('يرجى إدخال سعر صالح للصنف', 'error');
      return;
    }

    try {
      setActionLoading(true);

      const payload = {
        name: itemForm.name.trim(),
        description: itemForm.description.trim() || null,
        price: priceNum,
        category_id: itemForm.category_id || null,
        image_url: itemForm.image_url.trim() || null,
        status: itemForm.status,
        is_popular: Boolean(itemForm.is_popular),
        display_order: parseInt(itemForm.display_order) || 0,
        unit_type: itemForm.unit_type || 'qty',
        base_qty: parseInt(itemForm.base_qty) || 1
      };

      if (editingItem) {
        await supabaseService.updateMenuItem(editingItem.id, payload);
        showStatus(`تم تعديل الصنف "${payload.name}" بنجاح ✅`);
      } else {
        await supabaseService.createMenuItem(payload);
        showStatus(`تمت إضافة الصنف "${payload.name}" إلى المنيو بنجاح ✅`);
      }

      setIsItemDrawerOpen(false);
      await loadData();
    } catch (err) {
      console.error('[MenuManagement] Failed to save item:', err);
      showStatus('فشل حفظ الصنف: ' + (err.message || 'خطأ غير معروف'), 'error');
    } finally {
      setActionLoading(false);
    }
  };

  // ─────────────────────────────────────────────────────────
  // Delete Item
  // ─────────────────────────────────────────────────────────
  const handleConfirmDeleteItem = async (item) => {
    try {
      setActionLoading(true);
      await supabaseService.deleteMenuItem(item.id);
      showStatus(`تم حذف الصنف "${item.name}" بنجاح`);
      setDeleteConfirm(null);
      setIsItemDrawerOpen(false);
      await loadData();
    } catch (err) {
      console.error('[MenuManagement] Failed to delete item:', err);
      showStatus('فشل حذف الصنف: ' + (err.message || 'خطأ غير معروف'), 'error');
    } finally {
      setActionLoading(false);
    }
  };

  // ─────────────────────────────────────────────────────────
  // Image Upload to Supabase Storage
  // ─────────────────────────────────────────────────────────
  const handleImageFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      showStatus('حجم الصورة يجب ألا يتجاوز 5 ميجابايت', 'error');
      return;
    }

    try {
      setUploadingImage(true);
      const publicUrl = await supabaseService.uploadMenuImage(file);
      if (publicUrl) {
        setItemForm(prev => ({ ...prev, image_url: publicUrl }));
        showStatus('تم رفع الصورة بنجاح ✅');
      }
    } catch (err) {
      console.error('[MenuManagement] Upload image failed:', err);
      showStatus('فشل رفع الصورة: ' + (err.message || 'خطأ في التخزين'), 'error');
    } finally {
      setUploadingImage(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // ─────────────────────────────────────────────────────────
  // Category Management Handlers
  // ─────────────────────────────────────────────────────────
  const handleCreateCategory = async (e) => {
    e.preventDefault();
    if (!newCategoryName.trim()) {
      showStatus('يرجى إدخال اسم القسم', 'error');
      return;
    }

    try {
      setActionLoading(true);
      const order = parseInt(newCategoryOrder) || (categories.length > 0 ? Math.max(...categories.map(c => c.display_order || 0)) + 1 : 1);
      await supabaseService.createCategory({
        name: newCategoryName.trim(),
        display_order: order
      });
      setNewCategoryName('');
      setNewCategoryOrder(0);
      showStatus('تم إنشاء القسم الجديد بنجاح ✅');
      await loadData();
    } catch (err) {
      console.error('[MenuManagement] Create category failed:', err);
      showStatus('فشل إنشاء القسم: ' + (err.message || 'خطأ غير معروف'), 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleUpdateCategory = async (catId, newName, newOrder) => {
    if (!newName.trim()) return;
    try {
      setActionLoading(true);
      await supabaseService.updateCategory(catId, {
        name: newName.trim(),
        display_order: parseInt(newOrder) || 0
      });
      setEditingCategory(null);
      showStatus('تم تعديل القسم بنجاح ✅');
      await loadData();
    } catch (err) {
      console.error('[MenuManagement] Update category failed:', err);
      showStatus('فشل تعديل القسم: ' + err.message, 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleConfirmDeleteCategory = async (category) => {
    const categoryItemCount = items.filter(i => i.categoryId === category.id).length;
    if (categoryItemCount > 0) {
      showStatus(`لا يمكن حذف هذا القسم لأنه يحتوي على ${categoryItemCount} صنف. يرجى نقل الأصناف أو حذفها أولاً.`, 'error');
      setDeleteConfirm(null);
      return;
    }

    try {
      setActionLoading(true);
      await supabaseService.deleteCategory(category.id);
      showStatus(`تم حذف قسم "${category.name}" بنجاح`);
      setDeleteConfirm(null);
      await loadData();
    } catch (err) {
      console.error('[MenuManagement] Delete category failed:', err);
      showStatus('فشل حذف القسم: ' + err.message, 'error');
    } finally {
      setActionLoading(false);
    }
  };

  // ─────────────────────────────────────────────────────────
  // Filtered & Grouped Menu Items
  // ─────────────────────────────────────────────────────────
  const filteredItems = useMemo(() => {
    return items.filter(item => {
      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchName = item.name?.toLowerCase().includes(q);
        const matchDesc = item.description?.toLowerCase().includes(q);
        const matchCat = item.categoryName?.toLowerCase().includes(q);
        if (!matchName && !matchDesc && !matchCat) return false;
      }

      // Category filter
      if (filterCategory !== 'all' && item.categoryId !== filterCategory) {
        return false;
      }

      // Status filter
      if (filterStatus === 'available' && item.status !== 'available') return false;
      if (filterStatus === 'out_of_stock' && item.status !== 'out_of_stock') return false;
      if (filterStatus === 'hidden_paused' && item.status !== 'hidden' && item.status !== 'paused') return false;
      if (filterStatus === 'popular' && !item.isPopular) return false;

      return true;
    });
  }, [items, searchQuery, filterCategory, filterStatus]);

  // Group items by category according to category display_order
  const groupedCategories = useMemo(() => {
    const map = new Map();

    // Initialize all categories in canonical order
    categories.forEach(cat => {
      map.set(cat.id, {
        category: cat,
        items: []
      });
    });

    // Bucket items into their categories
    filteredItems.forEach(item => {
      const catId = item.categoryId;
      if (map.has(catId)) {
        map.get(catId).items.push(item);
      } else {
        // Fallback for uncategorized items
        if (!map.has('uncategorized')) {
          map.set('uncategorized', {
            category: { id: 'uncategorized', name: 'أصناف بدون قسم', display_order: 9999 },
            items: []
          });
        }
        map.get('uncategorized').items.push(item);
      }
    });

    // Sort items within each category by displayOrder ASC, name ASC
    map.forEach(group => {
      group.items.sort((a, b) => {
        const orderA = a.displayOrder ?? 0;
        const orderB = b.displayOrder ?? 0;
        if (orderA !== orderB) return orderA - orderB;
        return (a.name || '').localeCompare(b.name || '', 'ar');
      });
    });

    // If searching or filtering, hide empty categories
    const groupsArray = Array.from(map.values());
    if (searchQuery.trim() || filterCategory !== 'all' || filterStatus !== 'all') {
      return groupsArray.filter(g => g.items.length > 0);
    }

    return groupsArray;
  }, [categories, filteredItems, searchQuery, filterCategory, filterStatus]);

  // Stats Counters
  const totalCount = items.length;
  const availableCount = items.filter(i => i.status === 'available').length;
  const outOfStockCount = items.filter(i => i.status === 'out_of_stock').length;
  const hiddenOrPausedCount = items.filter(i => i.status === 'hidden' || i.status === 'paused').length;
  const popularCount = items.filter(i => i.isPopular).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%', direction: 'rtl' }}>
      
      {/* ───────────────────────────────────────────────────────
          Status Alert Feedback
      ─────────────────────────────────────────────────────── */}
      {statusMsg && (
        <div style={{
          padding: '14px 18px',
          borderRadius: '12px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          fontWeight: 'bold',
          background: statusMsg.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
          color: statusMsg.type === 'success' ? '#10b981' : '#ef4444',
          border: `1px solid ${statusMsg.type === 'success' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
          animation: 'fadeIn 0.2s ease-in-out'
        }}>
          {statusMsg.type === 'success' ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
          <span>{statusMsg.text}</span>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────
          Top Header Bar: Summary & Quick Actions
      ─────────────────────────────────────────────────────── */}
      <div style={{
        background: 'rgba(255, 255, 255, 0.03)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: '16px',
        padding: '20px',
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '16px'
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
            <UtensilsCrossed size={22} style={{ color: 'var(--primary)' }} />
            <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: '800', color: 'white' }}>
              إدارة إتاحة ومحتوى المنيو (Menu Management)
            </h2>
          </div>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.88rem' }}>
            التحكم الكامل والفوري في الأصناف، الأقسام، الأسعار، الصور، وحالة التوفر في منيو العميل مباشرة.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Admin-only Add Item Button */}
          {isAdmin && (
            <button
              type="button"
              onClick={() => handleOpenItemDrawer(null)}
              style={{
                minHeight: '44px',
                padding: '0 20px',
                background: 'var(--primary)',
                color: '#000',
                fontWeight: 'bold',
                borderRadius: '10px',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '0.92rem',
                boxShadow: '0 4px 12px rgba(255, 170, 0, 0.2)'
              }}
            >
              <Plus size={18} />
              <span>إضافة صنف جديد</span>
            </button>
          )}

          {/* Admin-only Category Manager Button */}
          {isAdmin && (
            <button
              type="button"
              onClick={() => setIsCategoryModalOpen(true)}
              style={{
                minHeight: '44px',
                padding: '0 16px',
                background: 'rgba(255, 255, 255, 0.08)',
                color: 'white',
                fontWeight: '600',
                borderRadius: '10px',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '0.92rem'
              }}
            >
              <Layers size={18} style={{ color: '#60a5fa' }} />
              <span>إدارة وترتيب الأقسام ({categories.length})</span>
            </button>
          )}

          <button
            type="button"
            onClick={loadData}
            disabled={loading}
            title="تحديث البيانات من الخادم"
            style={{
              minHeight: '44px',
              minWidth: '44px',
              padding: '0 12px',
              background: 'rgba(255, 255, 255, 0.05)',
              color: 'var(--text-muted)',
              borderRadius: '10px',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* ───────────────────────────────────────────────────────
          Stats & Quick Filter Pills Bar
      ─────────────────────────────────────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: '12px'
      }}>
        <div 
          onClick={() => setFilterStatus('all')}
          style={{
            background: filterStatus === 'all' ? 'rgba(255, 170, 0, 0.12)' : 'rgba(255, 255, 255, 0.03)',
            border: `1px solid ${filterStatus === 'all' ? 'var(--primary)' : 'rgba(255, 255, 255, 0.08)'}`,
            borderRadius: '12px',
            padding: '12px 14px',
            cursor: 'pointer',
            transition: 'all 0.2s'
          }}
        >
          <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginBottom: '4px' }}>إجمالي الأصناف</div>
          <div style={{ fontSize: '1.25rem', fontWeight: '800', color: 'white' }}>{totalCount} صنف</div>
        </div>

        <div 
          onClick={() => setFilterStatus('available')}
          style={{
            background: filterStatus === 'available' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255, 255, 255, 0.03)',
            border: `1px solid ${filterStatus === 'available' ? '#10b981' : 'rgba(255, 255, 255, 0.08)'}`,
            borderRadius: '12px',
            padding: '12px 14px',
            cursor: 'pointer',
            transition: 'all 0.2s'
          }}
        >
          <div style={{ color: '#10b981', fontSize: '0.78rem', marginBottom: '4px' }}>متاح للطلب</div>
          <div style={{ fontSize: '1.25rem', fontWeight: '800', color: '#10b981' }}>{availableCount} صنف 🟢</div>
        </div>

        <div 
          onClick={() => setFilterStatus('out_of_stock')}
          style={{
            background: filterStatus === 'out_of_stock' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(255, 255, 255, 0.03)',
            border: `1px solid ${filterStatus === 'out_of_stock' ? '#ef4444' : 'rgba(255, 255, 255, 0.08)'}`,
            borderRadius: '12px',
            padding: '12px 14px',
            cursor: 'pointer',
            transition: 'all 0.2s'
          }}
        >
          <div style={{ color: '#ef4444', fontSize: '0.78rem', marginBottom: '4px' }}>غير متوفر (نافد)</div>
          <div style={{ fontSize: '1.25rem', fontWeight: '800', color: '#ef4444' }}>{outOfStockCount} صنف ⚪</div>
        </div>

        <div 
          onClick={() => setFilterStatus('hidden_paused')}
          style={{
            background: filterStatus === 'hidden_paused' ? 'rgba(249, 115, 22, 0.15)' : 'rgba(255, 255, 255, 0.03)',
            border: `1px solid ${filterStatus === 'hidden_paused' ? '#f97316' : 'rgba(255, 255, 255, 0.08)'}`,
            borderRadius: '12px',
            padding: '12px 14px',
            cursor: 'pointer',
            transition: 'all 0.2s'
          }}
        >
          <div style={{ color: '#f97316', fontSize: '0.78rem', marginBottom: '4px' }}>مخفي / موقوف</div>
          <div style={{ fontSize: '1.25rem', fontWeight: '800', color: '#f97316' }}>{hiddenOrPausedCount} صنف 🟠</div>
        </div>

        <div 
          onClick={() => setFilterStatus('popular')}
          style={{
            background: filterStatus === 'popular' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(255, 255, 255, 0.03)',
            border: `1px solid ${filterStatus === 'popular' ? '#f59e0b' : 'rgba(255, 255, 255, 0.08)'}`,
            borderRadius: '12px',
            padding: '12px 14px',
            cursor: 'pointer',
            transition: 'all 0.2s'
          }}
        >
          <div style={{ color: '#f59e0b', fontSize: '0.78rem', marginBottom: '4px' }}>مميز (Popular)</div>
          <div style={{ fontSize: '1.25rem', fontWeight: '800', color: '#f59e0b' }}>{popularCount} صنف ⭐</div>
        </div>
      </div>

      {/* ───────────────────────────────────────────────────────
          Search & Fast Filters Bar
      ─────────────────────────────────────────────────────── */}
      <div style={{
        background: 'rgba(255, 255, 255, 0.02)',
        border: '1px solid rgba(255, 255, 255, 0.06)',
        borderRadius: '14px',
        padding: '14px 18px',
        display: 'flex',
        flexWrap: 'wrap',
        gap: '12px',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        {/* Search input */}
        <div style={{ position: 'relative', flex: '1', minWidth: '240px' }}>
          <Search size={18} style={{ position: 'absolute', right: '14px', top: '13px', color: 'var(--text-muted)' }} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="ابحث عن صنف بالاسم أو الوصف أو القسم..."
            style={{
              width: '100%',
              minHeight: '44px',
              background: 'rgba(0, 0, 0, 0.3)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: '10px',
              padding: '0 42px 0 16px',
              color: 'white',
              fontSize: '0.92rem',
              outline: 'none'
            }}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              style={{
                position: 'absolute',
                left: '10px',
                top: '12px',
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer'
              }}
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* Category Select Filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '200px' }}>
          <Filter size={16} style={{ color: 'var(--text-muted)' }} />
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            style={{
              flex: '1',
              minHeight: '44px',
              background: 'rgba(0, 0, 0, 0.3)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: '10px',
              padding: '0 12px',
              color: 'white',
              fontSize: '0.9rem',
              cursor: 'pointer',
              outline: 'none'
            }}
          >
            <option value="all">كل الأقسام ({categories.length})</option>
            {categories.map(cat => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
          </select>
        </div>

        {/* Accordion Global Controls */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            onClick={expandAllCategories}
            style={{
              minHeight: '40px',
              padding: '0 12px',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '8px',
              color: 'var(--text-muted)',
              fontSize: '0.82rem',
              cursor: 'pointer'
            }}
          >
            فتح الكل ▼
          </button>
          <button
            type="button"
            onClick={collapseAllCategories}
            style={{
              minHeight: '40px',
              padding: '0 12px',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '8px',
              color: 'var(--text-muted)',
              fontSize: '0.82rem',
              cursor: 'pointer'
            }}
          >
            طي الكل ▲
          </button>
        </div>
      </div>

      {/* ───────────────────────────────────────────────────────
          Categories & Items Accordion List
      ─────────────────────────────────────────────────────── */}
      {loading ? (
        <div style={{ padding: '60px', textAlign: 'center', color: 'var(--text-muted)' }}>
          <RefreshCw size={32} className="animate-spin" style={{ margin: '0 auto 16px', color: 'var(--primary)' }} />
          <div>جارِ تحميل قائمة أصناف وتصنيفات المنيو الحقيقية من Supabase...</div>
        </div>
      ) : groupedCategories.length === 0 ? (
        <div style={{
          padding: '50px',
          textAlign: 'center',
          background: 'rgba(255, 255, 255, 0.02)',
          border: '1px dashed rgba(255, 255, 255, 0.1)',
          borderRadius: '16px',
          color: 'var(--text-muted)'
        }}>
          <UtensilsCrossed size={40} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
          <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: 'white', marginBottom: '6px' }}>
            لا توجد أصناف تطابق معايير البحث
          </div>
          <div>جرب تغيير كلمات البحث أو مسح الفلاتر المختارة</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {groupedCategories.map(({ category, items: catItems }, catIndex) => {
            const isOpen = openCategories.has(category.id);
            const catAvailCount = catItems.filter(i => i.status === 'available').length;

            return (
              <div
                key={category.id}
                style={{
                  background: 'rgba(255, 255, 255, 0.025)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: '14px',
                  overflow: 'hidden',
                  transition: 'all 0.2s'
                }}
              >
                {/* Category Accordion Header */}
                <div
                  style={{
                    padding: '14px 18px',
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px',
                    background: isOpen ? 'rgba(255, 255, 255, 0.04)' : 'transparent',
                    borderBottom: isOpen ? '1px solid rgba(255, 255, 255, 0.08)' : 'none',
                    cursor: 'pointer',
                    userSelect: 'none'
                  }}
                  onClick={() => toggleCategoryAccordion(category.id)}
                >
                  {/* Category Title & Badge */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '8px',
                      background: 'rgba(255, 170, 0, 0.15)',
                      color: 'var(--primary)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: '800',
                      fontSize: '0.85rem'
                    }}>
                      #{category.display_order ?? catIndex + 1}
                    </div>

                    <div>
                      <div style={{ fontSize: '1.05rem', fontWeight: '800', color: 'white', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span>{category.name}</span>
                        {category.slug && (
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 'normal' }}>
                            ({category.slug})
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                        <span>{catItems.length} صنف</span>
                        <span style={{ margin: '0 6px' }}>•</span>
                        <span style={{ color: '#10b981' }}>{catAvailCount} متاح</span>
                        {catItems.length - catAvailCount > 0 && (
                          <>
                            <span style={{ margin: '0 6px' }}>•</span>
                            <span style={{ color: '#ef4444' }}>{catItems.length - catAvailCount} نافد</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Category Action Buttons */}
                  <div 
                    style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                    onClick={(e) => e.stopPropagation()} // Prevent accordion toggle when clicking actions
                  >
                    {/* Move category up / down (Admin only) */}
                    {isAdmin && (
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button
                          type="button"
                          onClick={() => handleMoveCategoryOrder(category, 'up')}
                          disabled={catIndex === 0}
                          title="تحريك القسم لأعلى"
                          style={{
                            width: '34px',
                            height: '34px',
                            background: 'rgba(255, 255, 255, 0.05)',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            borderRadius: '8px',
                            color: catIndex === 0 ? 'rgba(255,255,255,0.2)' : 'white',
                            cursor: catIndex === 0 ? 'not-allowed' : 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                        >
                          <ArrowUp size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMoveCategoryOrder(category, 'down')}
                          disabled={catIndex === categories.length - 1}
                          title="تحريك القسم لأسفل"
                          style={{
                            width: '34px',
                            height: '34px',
                            background: 'rgba(255, 255, 255, 0.05)',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            borderRadius: '8px',
                            color: catIndex === categories.length - 1 ? 'rgba(255,255,255,0.2)' : 'white',
                            cursor: catIndex === categories.length - 1 ? 'not-allowed' : 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                        >
                          <ArrowDown size={15} />
                        </button>
                      </div>
                    )}

                    {/* Quick Add item to this category (Admin only) */}
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => handleOpenItemDrawer(null, category.id)}
                        title="إضافة صنف داخل هذا القسم"
                        style={{
                          minHeight: '36px',
                          padding: '0 12px',
                          background: 'rgba(255, 170, 0, 0.15)',
                          border: '1px solid rgba(255, 170, 0, 0.3)',
                          borderRadius: '8px',
                          color: 'var(--primary)',
                          fontSize: '0.82rem',
                          fontWeight: 'bold',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px'
                        }}
                      >
                        <Plus size={15} />
                        <span>صنف</span>
                      </button>
                    )}

                    {/* Accordion Chevron */}
                    <div style={{
                      width: '34px',
                      height: '34px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--text-muted)'
                    }}>
                      {isOpen ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                    </div>
                  </div>
                </div>

                {/* Category Body: Items List (When Open) */}
                {isOpen && (
                  <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {catItems.length === 0 ? (
                      <div style={{
                        padding: '24px',
                        textAlign: 'center',
                        color: 'var(--text-muted)',
                        fontSize: '0.88rem'
                      }}>
                        لا توجد أصناف في هذا القسم حالياً. 
                        <button
                          type="button"
                          onClick={() => handleOpenItemDrawer(null, category.id)}
                          style={{
                            marginRight: '8px',
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--primary)',
                            cursor: 'pointer',
                            textDecoration: 'underline',
                            fontWeight: 'bold'
                          }}
                        >
                          + أضف صنف الآن
                        </button>
                      </div>
                    ) : (
                      catItems.map((item, itemIdx) => {
                        const isAvailable = item.status === 'available';
                        const isUpdating = updatingItemId === item.id;
                        const displayImage = getDisplayImageUrl(item.imageUrl);

                        return (
                          <div
                            key={item.id}
                            style={{
                              background: 'rgba(0, 0, 0, 0.25)',
                              border: `1px solid ${isAvailable ? 'rgba(255, 255, 255, 0.06)' : 'rgba(239, 68, 68, 0.2)'}`,
                              borderRadius: '12px',
                              padding: '12px 16px',
                              display: 'flex',
                              flexWrap: 'wrap',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: '14px',
                              opacity: isAvailable ? 1 : 0.75,
                              transition: 'all 0.2s'
                            }}
                          >
                            {/* Left part: Item Image & Information */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flex: '1', minWidth: '260px' }}>
                              
                              {/* Real Image Thumbnail */}
                              <div style={{
                                width: '56px',
                                height: '56px',
                                borderRadius: '10px',
                                background: 'rgba(255, 255, 255, 0.05)',
                                overflow: 'hidden',
                                flexShrink: 0,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                border: '1px solid rgba(255, 255, 255, 0.1)',
                                position: 'relative'
                              }}>
                                {displayImage ? (
                                  <img
                                    src={displayImage}
                                    alt={item.name}
                                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                    onError={(e) => {
                                      // Fallback on image load error
                                      e.currentTarget.style.display = 'none';
                                    }}
                                  />
                                ) : (
                                  <UtensilsCrossed size={22} style={{ color: 'rgba(255, 255, 255, 0.3)' }} />
                                )}

                                {item.isPopular && (
                                  <div style={{
                                    position: 'absolute',
                                    top: 2,
                                    right: 2,
                                    background: '#f59e0b',
                                    borderRadius: '4px',
                                    padding: '1px 3px',
                                    color: '#000'
                                  }}>
                                    <Star size={10} fill="#000" />
                                  </div>
                                )}
                              </div>

                              {/* Title, description, price & badges */}
                              <div style={{ flex: '1' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                  <span style={{ fontSize: '1rem', fontWeight: 'bold', color: 'white' }}>
                                    {item.name}
                                  </span>
                                  {item.isPopular && (
                                    <span style={{
                                      fontSize: '0.7rem',
                                      background: 'rgba(245, 158, 11, 0.15)',
                                      color: '#f59e0b',
                                      padding: '1px 6px',
                                      borderRadius: '6px',
                                      fontWeight: 'bold',
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '3px'
                                    }}>
                                      <Star size={10} fill="#f59e0b" />
                                      مميز
                                    </span>
                                  )}
                                  <span style={{
                                    fontSize: '0.72rem',
                                    background: 'rgba(255, 255, 255, 0.06)',
                                    color: 'var(--text-muted)',
                                    padding: '1px 6px',
                                    borderRadius: '6px'
                                  }}>
                                    ترتيب #{item.displayOrder ?? 0}
                                  </span>
                                </div>

                                {item.description && (
                                  <div style={{
                                    fontSize: '0.8rem',
                                    color: 'var(--text-muted)',
                                    marginTop: '3px',
                                    lineHeight: '1.3',
                                    maxWidth: '500px',
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis'
                                  }}>
                                    {item.description}
                                  </div>
                                )}

                                {/* Price Tag */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
                                  <span style={{
                                    fontSize: '0.95rem',
                                    fontWeight: '800',
                                    color: 'var(--primary)',
                                    background: 'rgba(255, 170, 0, 0.1)',
                                    padding: '2px 8px',
                                    borderRadius: '6px'
                                  }}>
                                    {parseFloat(item.price || 0).toFixed(2)} ج.م
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* Right part: Quick Controls & Edit Button */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                              
                              {/* Reorder within category */}
                              <div style={{ display: 'flex', gap: '3px' }}>
                                <button
                                  type="button"
                                  onClick={() => handleMoveItemOrder(item, 'up', catItems)}
                                  disabled={itemIdx === 0}
                                  title="تحريك لأعلى"
                                  style={{
                                    width: '32px',
                                    height: '32px',
                                    background: 'rgba(255, 255, 255, 0.05)',
                                    border: '1px solid rgba(255, 255, 255, 0.08)',
                                    borderRadius: '6px',
                                    color: itemIdx === 0 ? 'rgba(255,255,255,0.2)' : 'white',
                                    cursor: itemIdx === 0 ? 'not-allowed' : 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center'
                                  }}
                                >
                                  <ArrowUp size={14} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleMoveItemOrder(item, 'down', catItems)}
                                  disabled={itemIdx === catItems.length - 1}
                                  title="تحريك لأسفل"
                                  style={{
                                    width: '32px',
                                    height: '32px',
                                    background: 'rgba(255, 255, 255, 0.05)',
                                    border: '1px solid rgba(255, 255, 255, 0.08)',
                                    borderRadius: '6px',
                                    color: itemIdx === catItems.length - 1 ? 'rgba(255,255,255,0.2)' : 'white',
                                    cursor: itemIdx === catItems.length - 1 ? 'not-allowed' : 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center'
                                  }}
                                >
                                  <ArrowDown size={14} />
                                </button>
                              </div>

                              {/* Quick Availability Toggle Button */}
                              <button
                                type="button"
                                onClick={() => handleToggleAvailability(item)}
                                disabled={isUpdating}
                                style={{
                                  minHeight: '44px',
                                  padding: '0 14px',
                                  background: isAvailable ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                                  border: `1px solid ${isAvailable ? 'rgba(16, 185, 129, 0.35)' : 'rgba(239, 68, 68, 0.35)'}`,
                                  color: isAvailable ? '#10b981' : '#ef4444',
                                  borderRadius: '8px',
                                  fontWeight: 'bold',
                                  fontSize: '0.85rem',
                                  cursor: isUpdating ? 'wait' : 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '6px',
                                  transition: 'all 0.2s'
                                }}
                              >
                                {isUpdating ? (
                                  <RefreshCw size={14} className="animate-spin" />
                                ) : isAvailable ? (
                                  <Check size={16} />
                                ) : (
                                  <X size={16} />
                                )}
                                <span>{isAvailable ? 'متاح للطلب' : 'غير متوفر'}</span>
                              </button>

                              {/* Full Item Editor Button */}
                              <button
                                type="button"
                                onClick={() => handleOpenItemDrawer(item)}
                                style={{
                                  minHeight: '44px',
                                  padding: '0 14px',
                                  background: 'rgba(255, 255, 255, 0.08)',
                                  border: '1px solid rgba(255, 255, 255, 0.12)',
                                  color: 'white',
                                  borderRadius: '8px',
                                  fontWeight: '600',
                                  fontSize: '0.85rem',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '6px'
                                }}
                              >
                                <Edit3 size={15} />
                                <span>تعديل</span>
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ───────────────────────────────────────────────────────
          ITEM EDITOR DRAWER / MODAL (Tablet & Mobile Optimized)
      ─────────────────────────────────────────────────────── */}
      {isItemDrawerOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'blur(4px)',
          zIndex: 9999,
          display: 'flex',
          justifyContent: 'flex-start',
          direction: 'rtl'
        }}>
          <div style={{
            width: '100%',
            maxWidth: '560px',
            height: '100%',
            background: '#12161f',
            borderLeft: '1px solid rgba(255, 255, 255, 0.1)',
            boxShadow: '-10px 0 30px rgba(0,0,0,0.5)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}>
            {/* Drawer Header */}
            <div style={{
              padding: '18px 24px',
              borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <UtensilsCrossed size={20} style={{ color: 'var(--primary)' }} />
                <h3 style={{ margin: 0, fontSize: '1.15rem', color: 'white' }}>
                  {editingItem ? `تعديل صنف: ${editingItem.name}` : 'إضافة صنف جديد إلى المنيو'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsItemDrawerOpen(false)}
                style={{
                  minHeight: '40px',
                  minWidth: '40px',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: 'none',
                  borderRadius: '8px',
                  color: 'white',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Drawer Form Body */}
            <form onSubmit={handleSaveItem} style={{ flex: '1', overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
              
              {/* Item Name */}
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 'bold' }}>
                  اسم الصنف <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="text"
                  required
                  value={itemForm.name}
                  onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })}
                  placeholder="مثال: كفتة مشوية، طاجن عكاوي..."
                  style={{
                    width: '100%',
                    minHeight: '44px',
                    background: 'rgba(0, 0, 0, 0.4)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    borderRadius: '10px',
                    padding: '0 14px',
                    color: 'white',
                    fontSize: '0.95rem'
                  }}
                />
              </div>

              {/* Category & Price (Grid 2 cols) */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 'bold' }}>
                    القسم / التصنيف <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <select
                    value={itemForm.category_id}
                    onChange={(e) => setItemForm({ ...itemForm, category_id: e.target.value })}
                    style={{
                      width: '100%',
                      minHeight: '44px',
                      background: 'rgba(0, 0, 0, 0.4)',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      borderRadius: '10px',
                      padding: '0 12px',
                      color: 'white',
                      fontSize: '0.92rem'
                    }}
                  >
                    {categories.map(cat => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 'bold' }}>
                    <span>السعر (ج.م) <span style={{ color: '#ef4444' }}>*</span></span>
                    {!isAdmin && (
                      <span style={{ color: '#f59e0b', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '3px' }}>
                        <Lock size={11} /> تعديل السعر للمدير فقط
                      </span>
                    )}
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    required
                    disabled={!isAdmin}
                    value={itemForm.price}
                    onChange={(e) => setItemForm({ ...itemForm, price: e.target.value })}
                    placeholder="0.00"
                    style={{
                      width: '100%',
                      minHeight: '44px',
                      background: !isAdmin ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.4)',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      borderRadius: '10px',
                      padding: '0 14px',
                      color: 'var(--primary)',
                      fontSize: '1rem',
                      fontWeight: 'bold',
                      cursor: !isAdmin ? 'not-allowed' : 'text'
                    }}
                  />
                </div>
              </div>

              {/* Description */}
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 'bold' }}>
                  وصف الصنف ومكوناته
                </label>
                <textarea
                  rows={3}
                  value={itemForm.description}
                  onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })}
                  placeholder="مكونات الصنف، طريقة التحضير، أو أي ملاحظات توضيحية للزبون..."
                  style={{
                    width: '100%',
                    background: 'rgba(0, 0, 0, 0.4)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    borderRadius: '10px',
                    padding: '10px 14px',
                    color: 'white',
                    fontSize: '0.9rem',
                    resize: 'vertical'
                  }}
                />
              </div>

              {/* Availability Status & Popular (Grid 2 cols) */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 'bold' }}>
                    حالة الإتاحة
                  </label>
                  <select
                    value={itemForm.status}
                    onChange={(e) => setItemForm({ ...itemForm, status: e.target.value })}
                    style={{
                      width: '100%',
                      minHeight: '44px',
                      background: 'rgba(0, 0, 0, 0.4)',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      borderRadius: '10px',
                      padding: '0 12px',
                      color: itemForm.status === 'available' ? '#10b981' : '#ef4444',
                      fontWeight: 'bold',
                      fontSize: '0.92rem'
                    }}
                  >
                    <option value="available">🟢 متاح للطلب (Available)</option>
                    <option value="out_of_stock">⚪ غير متاح / نافد (Out of Stock)</option>
                    <option value="hidden">🟠 مخفي من المنيو (Hidden)</option>
                    <option value="paused">⏸️ موقوف مؤقتاً (Paused)</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 'bold' }}>
                    ترتيب الظهور في القسم
                  </label>
                  <input
                    type="number"
                    value={itemForm.display_order}
                    onChange={(e) => setItemForm({ ...itemForm, display_order: e.target.value })}
                    style={{
                      width: '100%',
                      minHeight: '44px',
                      background: 'rgba(0, 0, 0, 0.4)',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      borderRadius: '10px',
                      padding: '0 14px',
                      color: 'white',
                      fontSize: '0.92rem'
                    }}
                  />
                </div>
              </div>

              {/* Popular Checkbox */}
              <div style={{
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '10px',
                padding: '12px 16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer'
              }}
              onClick={() => setItemForm({ ...itemForm, is_popular: !itemForm.is_popular })}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Star size={18} style={{ color: '#f59e0b' }} fill={itemForm.is_popular ? '#f59e0b' : 'transparent'} />
                  <div>
                    <div style={{ fontWeight: 'bold', fontSize: '0.9rem', color: 'white' }}>صنف مميز / الأكثر طلباً (Popular)</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>يظهر في مقدمة المنيو مع شارة مميزة للزبائن</div>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={itemForm.is_popular}
                  onChange={(e) => setItemForm({ ...itemForm, is_popular: e.target.checked })}
                  style={{ width: '20px', height: '20px', accentColor: 'var(--primary)', cursor: 'pointer' }}
                />
              </div>

              {/* Real Image Preview & Upload Management */}
              <div style={{
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '12px',
                padding: '16px'
              }}>
                <label style={{ display: 'block', fontSize: '0.88rem', color: 'white', fontWeight: 'bold', marginBottom: '10px' }}>
                  صورة الصنف (الحقيقية)
                </label>

                <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  {/* Image Preview Box */}
                  <div style={{
                    width: '90px',
                    height: '90px',
                    borderRadius: '10px',
                    background: 'rgba(0, 0, 0, 0.4)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                    flexShrink: 0
                  }}>
                    {itemForm.image_url ? (
                      <img
                        src={getDisplayImageUrl(itemForm.image_url)}
                        alt="Preview"
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      />
                    ) : (
                      <ImageIcon size={30} style={{ color: 'rgba(255, 255, 255, 0.2)' }} />
                    )}
                  </div>

                  {/* Image controls: URL & Upload */}
                  <div style={{ flex: '1', minWidth: '220px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <input
                      type="text"
                      value={itemForm.image_url}
                      onChange={(e) => setItemForm({ ...itemForm, image_url: e.target.value })}
                      placeholder="رابط الصورة (Google Drive أو HTTPS أو Supabase Storage)..."
                      style={{
                        width: '100%',
                        minHeight: '40px',
                        background: 'rgba(0, 0, 0, 0.4)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '8px',
                        padding: '0 10px',
                        color: 'white',
                        fontSize: '0.85rem'
                      }}
                    />

                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <input
                        type="file"
                        ref={fileInputRef}
                        accept="image/*"
                        onChange={handleImageFileUpload}
                        style={{ display: 'none' }}
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploadingImage}
                        style={{
                          minHeight: '38px',
                          padding: '0 12px',
                          background: 'rgba(255, 255, 255, 0.08)',
                          border: '1px solid rgba(255, 255, 255, 0.15)',
                          borderRadius: '8px',
                          color: 'white',
                          fontSize: '0.82rem',
                          fontWeight: 'bold',
                          cursor: uploadingImage ? 'wait' : 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px'
                        }}
                      >
                        <Upload size={14} className={uploadingImage ? 'animate-spin' : ''} />
                        <span>{uploadingImage ? 'جارِ الرفع...' : 'رفع صورة من الجهاز'}</span>
                      </button>

                      {itemForm.image_url && (
                        <button
                          type="button"
                          onClick={() => setItemForm({ ...itemForm, image_url: '' })}
                          style={{
                            minHeight: '38px',
                            padding: '0 10px',
                            background: 'rgba(239, 68, 68, 0.1)',
                            border: '1px solid rgba(239, 68, 68, 0.25)',
                            borderRadius: '8px',
                            color: '#ef4444',
                            fontSize: '0.82rem',
                            cursor: 'pointer'
                          }}
                        >
                          إزالة الصورة
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Actions Footer */}
              <div style={{
                marginTop: 'auto',
                paddingTop: '16px',
                borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px'
              }}>
                {editingItem && isAdmin ? (
                  <button
                    type="button"
                    onClick={() => setDeleteConfirm({ type: 'item', item: editingItem })}
                    style={{
                      minHeight: '44px',
                      padding: '0 16px',
                      background: 'rgba(239, 68, 68, 0.15)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      color: '#ef4444',
                      borderRadius: '10px',
                      fontWeight: 'bold',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                  >
                    <Trash2 size={16} />
                    <span>حذف الصنف</span>
                  </button>
                ) : <div />}

                <div style={{ display: 'flex', gap: '10px' }}>
                  <button
                    type="button"
                    onClick={() => setIsItemDrawerOpen(false)}
                    style={{
                      minHeight: '44px',
                      padding: '0 16px',
                      background: 'rgba(255, 255, 255, 0.06)',
                      border: 'none',
                      borderRadius: '10px',
                      color: 'var(--text-muted)',
                      fontWeight: 'bold',
                      cursor: 'pointer'
                    }}
                  >
                    إلغاء
                  </button>

                  <button
                    type="submit"
                    disabled={actionLoading}
                    style={{
                      minHeight: '44px',
                      padding: '0 24px',
                      background: 'var(--primary)',
                      border: 'none',
                      borderRadius: '10px',
                      color: '#000',
                      fontWeight: '800',
                      fontSize: '0.95rem',
                      cursor: actionLoading ? 'wait' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}
                  >
                    {actionLoading && <RefreshCw size={16} className="animate-spin" />}
                    <span>{editingItem ? 'حفظ التعديلات' : 'إضافة الصنف للمنيو'}</span>
                  </button>
                </div>
              </div>

            </form>
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────
          CATEGORY MANAGEMENT MODAL (Reorder & Edit Categories)
      ─────────────────────────────────────────────────────── */}
      {isCategoryModalOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'blur(4px)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px',
          direction: 'rtl'
        }}>
          <div style={{
            width: '100%',
            maxWidth: '650px',
            maxHeight: '90vh',
            background: '#12161f',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '16px',
            boxShadow: '0 20px 40px rgba(0,0,0,0.6)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}>
            {/* Modal Header */}
            <div style={{
              padding: '18px 24px',
              borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Layers size={22} style={{ color: '#60a5fa' }} />
                <h3 style={{ margin: 0, fontSize: '1.2rem', color: 'white' }}>
                  إدارة وترتيب أقسام المنيو (Categories)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsCategoryModalOpen(false)}
                style={{
                  minHeight: '38px',
                  minWidth: '38px',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: 'none',
                  borderRadius: '8px',
                  color: 'white',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Content */}
            <div style={{ flex: '1', overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
              
              {/* Add New Category Form */}
              <form onSubmit={handleCreateCategory} style={{
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '12px',
                padding: '16px',
                display: 'flex',
                flexWrap: 'wrap',
                gap: '10px',
                alignItems: 'flex-end'
              }}>
                <div style={{ flex: '1', minWidth: '180px' }}>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 'bold' }}>
                    اسم القسم الجديد
                  </label>
                  <input
                    type="text"
                    required
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                    placeholder="مثال: بيتزا، حلويات، مشويات..."
                    style={{
                      width: '100%',
                      minHeight: '44px',
                      background: 'rgba(0, 0, 0, 0.4)',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      borderRadius: '8px',
                      padding: '0 12px',
                      color: 'white'
                    }}
                  />
                </div>

                <div style={{ width: '100px' }}>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 'bold' }}>
                    الترتيب
                  </label>
                  <input
                    type="number"
                    value={newCategoryOrder}
                    onChange={(e) => setNewCategoryOrder(e.target.value)}
                    style={{
                      width: '100%',
                      minHeight: '44px',
                      background: 'rgba(0, 0, 0, 0.4)',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      borderRadius: '8px',
                      padding: '0 12px',
                      color: 'white'
                    }}
                  />
                </div>

                <button
                  type="submit"
                  disabled={actionLoading}
                  style={{
                    minHeight: '44px',
                    padding: '0 18px',
                    background: '#60a5fa',
                    border: 'none',
                    borderRadius: '8px',
                    color: '#000',
                    fontWeight: 'bold',
                    cursor: actionLoading ? 'wait' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <Plus size={16} />
                  <span>إضافة قسم</span>
                </button>
              </form>

              {/* Categories List */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ fontSize: '0.88rem', fontWeight: 'bold', color: 'var(--text-muted)' }}>
                  الأقسام الحالية بالترتيب ({categories.length} قسم):
                </div>

                {categories.map((cat, idx) => {
                  const catItemCount = items.filter(i => i.categoryId === cat.id).length;
                  const isEditingThis = editingCategory?.id === cat.id;

                  return (
                    <div
                      key={cat.id}
                      style={{
                        background: 'rgba(255, 255, 255, 0.03)',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        borderRadius: '10px',
                        padding: '10px 14px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '12px'
                      }}
                    >
                      {/* Left: Reorder buttons & Name */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: '1' }}>
                        {/* Order buttons */}
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <button
                            type="button"
                            onClick={() => handleMoveCategoryOrder(cat, 'up')}
                            disabled={idx === 0}
                            style={{
                              width: '30px',
                              height: '30px',
                              background: 'rgba(255, 255, 255, 0.05)',
                              border: '1px solid rgba(255, 255, 255, 0.1)',
                              borderRadius: '6px',
                              color: idx === 0 ? 'rgba(255,255,255,0.2)' : 'white',
                              cursor: idx === 0 ? 'not-allowed' : 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center'
                            }}
                          >
                            <ArrowUp size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleMoveCategoryOrder(cat, 'down')}
                            disabled={idx === categories.length - 1}
                            style={{
                              width: '30px',
                              height: '30px',
                              background: 'rgba(255, 255, 255, 0.05)',
                              border: '1px solid rgba(255, 255, 255, 0.1)',
                              borderRadius: '6px',
                              color: idx === categories.length - 1 ? 'rgba(255,255,255,0.2)' : 'white',
                              cursor: idx === categories.length - 1 ? 'not-allowed' : 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center'
                            }}
                          >
                            <ArrowDown size={13} />
                          </button>
                        </div>

                        {/* Name or inline edit */}
                        {isEditingThis ? (
                          <div style={{ display: 'flex', gap: '8px', flex: '1' }}>
                            <input
                              type="text"
                              value={editingCategory.name}
                              onChange={(e) => setEditingCategory({ ...editingCategory, name: e.target.value })}
                              style={{
                                flex: '1',
                                minHeight: '36px',
                                background: 'rgba(0,0,0,0.5)',
                                border: '1px solid var(--primary)',
                                borderRadius: '6px',
                                padding: '0 8px',
                                color: 'white'
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => handleUpdateCategory(cat.id, editingCategory.name, cat.display_order)}
                              style={{
                                minHeight: '36px',
                                padding: '0 12px',
                                background: 'var(--primary)',
                                border: 'none',
                                borderRadius: '6px',
                                color: '#000',
                                fontWeight: 'bold',
                                cursor: 'pointer'
                              }}
                            >
                              حفظ
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingCategory(null)}
                              style={{
                                minHeight: '36px',
                                padding: '0 10px',
                                background: 'rgba(255,255,255,0.1)',
                                border: 'none',
                                borderRadius: '6px',
                                color: 'white',
                                cursor: 'pointer'
                              }}
                            >
                              إلغاء
                            </button>
                          </div>
                        ) : (
                          <div>
                            <div style={{ fontWeight: 'bold', color: 'white', fontSize: '0.95rem' }}>
                              #{cat.display_order ?? idx + 1} {cat.name}
                            </div>
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                              يحتوي على {catItemCount} صنف
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Right: Actions */}
                      {!isEditingThis && (
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button
                            type="button"
                            onClick={() => setEditingCategory({ id: cat.id, name: cat.name })}
                            style={{
                              minHeight: '34px',
                              padding: '0 10px',
                              background: 'rgba(255, 255, 255, 0.05)',
                              border: '1px solid rgba(255, 255, 255, 0.1)',
                              borderRadius: '6px',
                              color: 'white',
                              fontSize: '0.8rem',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px'
                            }}
                          >
                            <Edit3 size={13} />
                            <span>تعديل</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => setDeleteConfirm({ type: 'category', item: cat })}
                            disabled={catItemCount > 0}
                            title={catItemCount > 0 ? 'لا يمكن حذف قسم يحتوي على أصناف' : 'حذف القسم'}
                            style={{
                              minHeight: '34px',
                              padding: '0 10px',
                              background: catItemCount > 0 ? 'rgba(255, 255, 255, 0.02)' : 'rgba(239, 68, 68, 0.1)',
                              border: `1px solid ${catItemCount > 0 ? 'rgba(255, 255, 255, 0.05)' : 'rgba(239, 68, 68, 0.25)'}`,
                              borderRadius: '6px',
                              color: catItemCount > 0 ? 'rgba(255, 255, 255, 0.2)' : '#ef4444',
                              fontSize: '0.8rem',
                              cursor: catItemCount > 0 ? 'not-allowed' : 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px'
                            }}
                          >
                            <Trash2 size={13} />
                            <span>حذف</span>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

            </div>
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────
          DELETE CONFIRMATION DIALOG
      ─────────────────────────────────────────────────────── */}
      {deleteConfirm && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.8)',
          backdropFilter: 'blur(4px)',
          zIndex: 10000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px',
          direction: 'rtl'
        }}>
          <div style={{
            width: '100%',
            maxWidth: '420px',
            background: '#1a1f2c',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            borderRadius: '16px',
            padding: '24px',
            textAlign: 'center'
          }}>
            <div style={{
              width: '50px',
              height: '50px',
              borderRadius: '50%',
              background: 'rgba(239, 68, 68, 0.15)',
              color: '#ef4444',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px'
            }}>
              <AlertCircle size={28} />
            </div>

            <h3 style={{ margin: '0 0 8px', color: 'white', fontSize: '1.15rem' }}>
              تأكيد حذف {deleteConfirm.type === 'item' ? 'الصنف' : 'القسم'}
            </h3>

            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '20px' }}>
              هل أنت متأكد من رغبتك في حذف <strong style={{ color: 'white' }}>"{deleteConfirm.item.name}"</strong>؟
              <br />
              {deleteConfirm.type === 'item' 
                ? 'سيتم إزالة الصنف نهائياً من المنيو وقاعدة البيانات.'
                : 'سيتم حذف القسم نهائياً.'}
            </p>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button
                type="button"
                onClick={() => setDeleteConfirm(null)}
                style={{
                  minHeight: '44px',
                  padding: '0 20px',
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: 'none',
                  borderRadius: '10px',
                  color: 'white',
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}
              >
                إلغاء
              </button>

              <button
                type="button"
                disabled={actionLoading}
                onClick={() => {
                  if (deleteConfirm.type === 'item') {
                    handleConfirmDeleteItem(deleteConfirm.item);
                  } else {
                    handleConfirmDeleteCategory(deleteConfirm.item);
                  }
                }}
                style={{
                  minHeight: '44px',
                  padding: '0 24px',
                  background: '#ef4444',
                  border: 'none',
                  borderRadius: '10px',
                  color: 'white',
                  fontWeight: 'bold',
                  cursor: actionLoading ? 'wait' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                {actionLoading && <RefreshCw size={16} className="animate-spin" />}
                <span>نعم، احذف الآن</span>
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
