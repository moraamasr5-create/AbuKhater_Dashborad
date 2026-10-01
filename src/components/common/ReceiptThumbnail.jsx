import React from 'react';
import { useSignedReceiptUrl } from '../../services/storageService';

/**
 * Component to securely render payment receipt thumbnails with Signed URLs
 */
export const ReceiptThumbnail = ({
  src,
  alt = 'إيصال الدفع',
  size = 45,
  borderRadius = 8,
  border = '2px solid var(--border)',
  onOpen,
  className = 'hover-scale',
  style = {}
}) => {
  const { signedUrl, isLoading } = useSignedReceiptUrl(src);

  if (!src) return null;

  return (
    <div
      onClick={() => onOpen && onOpen(signedUrl || src)}
      className={className}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: `${borderRadius}px`,
        overflow: 'hidden',
        cursor: 'pointer',
        border,
        background: 'rgba(255,255,255,0.03)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        flexShrink: 0,
        ...style
      }}
      title="عرض صورة الإيصال"
    >
      {isLoading ? (
        <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>⏳</span>
      ) : (
        <img
          src={signedUrl || src}
          alt={alt}
          loading="lazy"
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          onError={(e) => {
            e.target.style.display = 'none';
          }}
        />
      )}
    </div>
  );
};

export default ReceiptThumbnail;
