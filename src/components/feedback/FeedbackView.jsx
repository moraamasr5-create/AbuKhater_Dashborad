// Developed & Owned by AmrMamdouh - 01038035884
import React, { useState, useEffect } from 'react';
import { supabaseService } from '../../services/supabaseService';
import { MessageSquare, Trash2, Calendar, Phone, Search, Loader2, MessageCircle, AlertTriangle, AlertCircle, HelpCircle } from 'lucide-react';

const FeedbackView = () => {
  const [feedbacks, setFeedbacks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all'); // all, complaint, suggestion, other

  const loadFeedbacks = async () => {
    setLoading(true);
    try {
      const data = await supabaseService.fetchFeedbacks();
      setFeedbacks(data || []);
    } catch (err) {
      console.error('Error fetching feedbacks:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFeedbacks();
  }, []);

  const handleDelete = async (id) => {
    if (window.confirm('هل أنت متأكد من حذف هذه الرسالة نهائياً؟')) {
      try {
        const success = await supabaseService.deleteFeedback(id);
        if (success) {
          setFeedbacks(prev => prev.filter(f => f.id !== id));
        } else {
          alert('❌ حدث خطأ أثناء الحذف');
        }
      } catch (err) {
        console.error('Error deleting feedback:', err);
        alert('❌ حدث خطأ أثناء الحذف');
      }
    }
  };

  const getNormalizedFeedback = (row) => {
    return {
      id: row.id,
      name: row.full_name
        || 'عميل غير مسجل',
      phone: row.phone || '',
      type: (row.type || 'message').toLowerCase().trim(),
      message: row.message || 'بدون تفاصيل',
      createdAt: row.created_at || new Date().toISOString()
    };
  };

  // Filter & Search
  const filteredFeedbacks = feedbacks
    .map(row => getNormalizedFeedback(row))
    .filter(item => {
      // Search match
      const query = searchQuery.toLowerCase().trim();
      const nameMatch = item.name.toLowerCase().includes(query);
      const phoneMatch = item.phone.includes(query);
      const messageMatch = item.message.toLowerCase().includes(query);
      const matchesSearch = !query || nameMatch || phoneMatch || messageMatch;

      // Type Filter
      let matchesType = true;
      if (typeFilter === 'complaint') {
        matchesType = item.type === 'complaint' || item.type.includes('شكوى');
      } else if (typeFilter === 'suggestion') {
        matchesType = item.type === 'suggestion' || item.type.includes('مقترح');
      } else if (typeFilter === 'other') {
        matchesType = !['complaint', 'suggestion'].includes(item.type) && !item.type.includes('شكوى') && !item.type.includes('مقترح');
      }

      return matchesSearch && matchesType;
    });

  const getTypeBadge = (type) => {
    if (type === 'complaint' || type.includes('شكوى')) {
      return {
        label: '🚨 شكوى',
        color: '#f87171',
        bg: 'rgba(239, 68, 68, 0.1)',
        border: '1px solid rgba(239, 68, 68, 0.2)'
      };
    }
    if (type === 'suggestion' || type.includes('مقترح')) {
      return {
        label: '💡 مقترح',
        color: '#818cf8',
        bg: 'rgba(99, 102, 241, 0.1)',
        border: '1px solid rgba(99, 102, 241, 0.2)'
      };
    }
    // return {
    //   label: '💬 رسالة عامة',
    //   color: '#38bdf8',
    //   bg: 'rgba(14, 165, 233, 0.1)',
    //   border: '1px solid rgba(14, 165, 233, 0.2)'
    // };
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', animation: 'fadeIn 0.3s ease-in-out' }}>

      {/* Header section */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h2 style={{ fontSize: '2.2rem', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '12px', margin: 0 }}>
            <MessageSquare size={32} color="var(--primary)" />
            الشكاوى والمقترحات
          </h2>
          <p style={{ color: 'var(--text-muted)', marginTop: '4px' }}>استعراض تعليقات وشكاوى ومقترحات العملاء الواردة من موقع وتطبيق الطلبات</p>
        </div>

        <button
          onClick={loadFeedbacks}
          disabled={loading}
          className="btn-primary"
          style={{ background: 'var(--primary)', padding: '10px 20px', borderRadius: '12px' }}
        >
          {loading ? <Loader2 size={18} className="spin" /> : 'تحديث القائمة 🔄'}
        </button>
      </header>

      {/* Stats Counter Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px' }}>
        <div className="glass-card" style={{ padding: '16px', borderRight: '4px solid var(--primary)', textAlign: 'center' }}>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>إجمالي الوارد</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 'bold', margin: '4px 0', color: 'white' }}>{feedbacks.length}</div>
        </div>
        <div className="glass-card" style={{ padding: '16px', borderRight: '4px solid #f87171', textAlign: 'center' }}>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>إجمالي الشكاوى</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 'bold', margin: '4px 0', color: '#f87171' }}>
            {feedbacks.filter(f => (f.type || '').toLowerCase().includes('complaint') || (f.type || '').includes('شكوى')).length}
          </div>
        </div>
        <div className="glass-card" style={{ padding: '16px', borderRight: '4px solid #818cf8', textAlign: 'center' }}>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>إجمالي المقترحات</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 'bold', margin: '4px 0', color: '#818cf8' }}>
            {feedbacks.filter(f => (f.type || '').toLowerCase().includes('suggestion') || (f.type || '').includes('مقترح')).length}
          </div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="glass-card" style={{ padding: '16px', display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'center', justifyContent: 'space-between' }}>

        {/* Search Input */}
        <div style={{ position: 'relative', width: '100%', maxWidth: '300px' }}>
          <input
            type="text"
            placeholder="بحث بالاسم، الهاتف، أو نص الرسالة..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="glass-card"
            style={{
              width: '100%',
              padding: '10px 38px 10px 12px',
              borderRadius: '10px',
              border: '1px solid var(--border)',
              background: '#131b2e',
              color: 'white',
              fontSize: '0.9rem'
            }}
          />
          <Search size={18} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
        </div>

        {/* Tab Filters */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {[
            { id: 'all', label: 'عرض الكل' },
            { id: 'complaint', label: '🚨 الشكاوى فقط' },
            { id: 'suggestion', label: '💡 المقترحات فقط' },
            { id: 'other', label: '💬 رسائل عامة' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setTypeFilter(tab.id)}
              className="glass-card"
              style={{
                padding: '8px 16px',
                borderRadius: '8px',
                border: typeFilter === tab.id ? '1px solid var(--primary)' : '1px solid var(--border)',
                background: typeFilter === tab.id ? 'var(--primary)' : 'rgba(255,255,255,0.02)',
                color: typeFilter === tab.id ? 'white' : 'var(--text-muted)',
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: '0.85rem',
                transition: 'all 0.15s ease'
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Feedback Feed */}
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 0', gap: '12px' }}>
          <Loader2 size={48} className="spin" color="var(--primary)" />
          <p style={{ color: 'var(--text-muted)' }}>جاري جلب الشكاوى والمقترحات...</p>
        </div>
      ) : filteredFeedbacks.length === 0 ? (
        <div className="glass-card" style={{ padding: '60px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <MessageCircle size={48} style={{ opacity: 0.3, color: 'var(--primary)' }} />
          <h3 style={{ color: 'white', margin: 0 }}>لا توجد أي رسائل مطابقة حالياً</h3>
          <p style={{ color: 'var(--text-muted)', maxWidth: '400px', margin: 0, fontSize: '0.9rem' }}>
            {feedbacks.length === 0
              ? 'صندوق الشكاوى والمقترحات فارغ! يبدو أن العملاء راضون تماماً عن الخدمة والطلب.'
              : 'قم بتغيير خيارات البحث والتصفية للوصول للنتائج المطلوبة.'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '20px' }}>
          {filteredFeedbacks.map(item => {
            const badge = getTypeBadge(item.type);
            return (
              <div
                key={item.id}
                className="glass-card hover-scale"
                style={{
                  padding: '20px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: '16px',
                  borderTop: `3px solid ${badge.color}`
                }}
              >
                <div>
                  {/* Top Info Header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                    <div>
                      <h4 style={{ fontSize: '1.1rem', margin: '0 0 4px 0', color: 'white', fontWeight: 'bold' }}>{item.name}</h4>
                      {item.phone && (
                        <a
                          href={`tel:${item.phone}`}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--accent)', textDecoration: 'none', fontSize: '0.85rem' }}
                        >
                          <Phone size={12} /> {item.phone}
                        </a>
                      )}
                    </div>

                    {/* Type Badge */}
                    <span style={{
                      fontSize: '0.75rem',
                      fontWeight: 'bold',
                      color: badge.color,
                      background: badge.bg,
                      border: badge.border,
                      padding: '4px 8px',
                      borderRadius: '6px'
                    }}>
                      {badge.label}
                    </span>
                  </div>

                  {/* Message Body */}
                  <div style={{
                    background: 'rgba(0,0,0,0.18)',
                    padding: '12px',
                    borderRadius: '10px',
                    fontSize: '0.9rem',
                    color: '#e2e8f0',
                    lineHeight: '1.5',
                    whiteSpace: 'pre-wrap',
                    minHeight: '60px'
                  }}>
                    {item.message}
                  </div>
                </div>

                {/* Bottom Actions footer */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    <Calendar size={12} />
                    <span>{new Date(item.createdAt).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' })}</span>
                  </div>

                  <button
                    onClick={() => handleDelete(item.id)}
                    style={{
                      background: 'rgba(239, 68, 68, 0.1)',
                      border: '1px solid rgba(239, 68, 68, 0.2)',
                      color: '#f87171',
                      padding: '6px 12px',
                      borderRadius: '8px',
                      fontSize: '0.8rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      transition: 'all 0.2s'
                    }}
                    title="حذف الرسالة"
                  >
                    <Trash2 size={14} />
                    <span>حذف</span>
                  </button>
                </div>

              </div>
            );
          })}
        </div>
      )}

    </div>
  );
};

export default FeedbackView;
