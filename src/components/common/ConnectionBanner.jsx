// src/components/common/ConnectionBanner.jsx
import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Wifi, WifiOff, RefreshCw, AlertTriangle, X, Eye } from 'lucide-react';

const ConnectionBanner = () => {
  const {
    connectionStatus,
    pendingQueueCount,
    failedQueueCount,
    failedQueueItems,
    clearFailedQueue,
    retryFailedQueue
  } = useApp();

  const [showFailedModal, setShowFailedModal] = useState(false);

  // إذا كان متصلاً بنجاح ولا توجد عمليات معلقة أو فاشلة، لا داعي لإظهار البانر
  if (connectionStatus === 'connected' && failedQueueCount === 0 && pendingQueueCount === 0) {
    return null;
  }

  return (
    <>
      <div
        className="connection-banner animate-in fade-in slide-in-from-top-2"
        style={{
          width: '100%',
          marginBottom: '16px',
          padding: '10px 16px',
          borderRadius: '12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '10px',
          fontSize: '0.85rem',
          fontWeight: '600',
          boxShadow: '0 4px 15px rgba(0,0,0,0.2)',
          zIndex: 100,
          background: connectionStatus === 'disconnected'
            ? 'linear-gradient(135deg, rgba(239, 68, 68, 0.2) 0%, rgba(185, 28, 28, 0.3) 100%)'
            : connectionStatus === 'reconnecting'
              ? 'linear-gradient(135deg, rgba(245, 158, 11, 0.2) 0%, rgba(180, 83, 9, 0.3) 100%)'
              : 'linear-gradient(135deg, rgba(239, 68, 68, 0.15) 0%, rgba(245, 158, 11, 0.2) 100%)',
          border: connectionStatus === 'disconnected'
            ? '1px solid rgba(239, 68, 68, 0.5)'
            : connectionStatus === 'reconnecting'
              ? '1px solid rgba(245, 158, 11, 0.5)'
              : '1px solid rgba(245, 158, 11, 0.4)',
          color: '#ffffff'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {connectionStatus === 'disconnected' && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#ef4444', borderRadius: '50%', width: '28px', height: '28px' }}>
                <WifiOff size={16} color="#fff" />
              </div>
              <div>
                <span style={{ color: '#fca5a5', fontWeight: 'bold' }}>🔴 انقطع الاتصال بالإنترنت:</span> النظام يعمل محلياً الآن — يمكنك مواصلة العمل وستُحفظ العمليات محلياً تلقائياً.
                {pendingQueueCount > 0 && (
                  <span style={{ marginRight: '8px', background: 'rgba(239, 68, 68, 0.3)', padding: '2px 8px', borderRadius: '8px', border: '1px solid rgba(239,68,68,0.4)' }}>
                    ⏳ {pendingQueueCount} عملية معلقة
                  </span>
                )}
              </div>
            </>
          )}

          {connectionStatus === 'reconnecting' && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f59e0b', borderRadius: '50%', width: '28px', height: '28px', animation: 'spin 2s linear infinite' }}>
                <RefreshCw size={16} color="#000" />
              </div>
              <div>
                <span style={{ color: '#fde68a', fontWeight: 'bold' }}>🟡 عاد الاتصال:</span> جاري إرسال العمليات المحفوظة ومزامنة الطلبات الحديثة مع السيرفر...
                {pendingQueueCount > 0 && (
                  <span style={{ marginRight: '8px', color: '#fde68a' }}>
                    (متبقي {pendingQueueCount} عملية)
                  </span>
                )}
              </div>
            </>
          )}

          {connectionStatus === 'connected' && failedQueueCount > 0 && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f59e0b', borderRadius: '50%', width: '28px', height: '28px' }}>
                <AlertTriangle size={16} color="#000" />
              </div>
              <div>
                <span style={{ color: '#fde68a', fontWeight: 'bold' }}>⚠️ تنبيه مزامنة:</span> فشلت {failedQueueCount} عملية بعد 3 محاولات (قد يكون بسبب تعارض بيانات أو تعديل الطلب من جهاز آخر).
              </div>
            </>
          )}
        </div>

        {/* أزرار الإجراءات */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {failedQueueCount > 0 && (
            <>
              <button
                onClick={() => setShowFailedModal(true)}
                style={{
                  background: 'rgba(255, 255, 255, 0.1)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  color: '#fff',
                  padding: '5px 12px',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '0.8rem'
                }}
              >
                <Eye size={14} /> تفاصيل ({failedQueueCount})
              </button>
              <button
                onClick={retryFailedQueue}
                style={{
                  background: '#f59e0b',
                  border: 'none',
                  color: '#000',
                  padding: '5px 12px',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '0.8rem'
                }}
              >
                <RefreshCw size={14} /> إعادة المحاولة
              </button>
            </>
          )}
        </div>
      </div>

      {/* Modal تفاصيل العمليات الفاشلة */}
      {showFailedModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.85)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}
          onClick={() => setShowFailedModal(false)}
        >
          <div
            className="glass-card"
            style={{
              width: '100%',
              maxWidth: '550px',
              padding: '24px',
              border: '1px solid var(--warning)',
              maxHeight: '80vh',
              overflowY: 'auto'
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, color: 'var(--warning)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <AlertTriangle size={20} /> العمليات التي فشلت في المزامنة
              </h3>
              <button
                onClick={() => setShowFailedModal(false)}
                style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
              هذه العمليات تمت محاولة إرسالها 3 مرات إلى السيرفر وفشلت. يُرجى التحقق من أسباب الفشل أدناه أو النقر على "إعادة المحاولة" بعد التأكد من الاتصال.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
              {failedQueueItems.map((item, idx) => (
                <div
                  key={item.id || idx}
                  style={{
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '8px',
                    padding: '12px',
                    fontSize: '0.85rem'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', marginBottom: '4px' }}>
                    <span style={{ color: 'var(--accent)' }}>نوع العملية: {item.action}</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                      {item.failedAt ? new Date(item.failedAt).toLocaleTimeString('ar-EG') : ''}
                    </span>
                  </div>
                  <div style={{ color: '#f87171', fontSize: '0.8rem', marginTop: '4px' }}>
                    ❌ سبب الرفض: {item.error || 'خطأ غير معروف في السيرفر'}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => {
                  clearFailedQueue();
                  setShowFailedModal(false);
                }}
                className="btn-danger-outline"
                style={{ fontSize: '0.85rem' }}
              >
                تجاهل ومسح السجل
              </button>
              <button
                onClick={() => {
                  retryFailedQueue();
                  setShowFailedModal(false);
                }}
                className="btn-primary"
                style={{ background: 'var(--warning)', color: '#000', fontSize: '0.85rem', fontWeight: 'bold' }}
              >
                <RefreshCw size={16} /> إعادة محاولة المزامنة
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ConnectionBanner;
