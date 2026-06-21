// Developed & Owned by AmrMamdouh - 01038035884
import React, { useState, useEffect } from 'react';
import { Shield, KeyRound, User, Delete, Check } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { safeGetItem } from '../../utils/safeStorage';

const Login = ({ onLoginSuccess }) => {
  const { setUserRole } = useApp();
  const [selectedUser, setSelectedUser] = useState('casher'); // Default selection
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [isShaking, setIsShaking] = useState(false);

  // Clear error when user changes selection
  useEffect(() => {
    setError('');
    setPin('');
  }, [selectedUser]);

  const handleKeyPress = (num) => {
    if (pin.length < 8) {
      setError('');
      setPin(prev => prev + num);
    }
  };

  const handleDelete = () => {
    setPin(prev => prev.slice(0, -1));
  };

  const handleClear = () => {
    setPin('');
  };

  const handleSubmit = (e) => {
    if (e) e.preventDefault();
    if (!pin) return;

    // Get correct password from localStorage, fallback to '8080'
    const storageKey = `b_delivery_password_${selectedUser}`;
    const correctPassword = safeGetItem(storageKey) || '8080';

    if (pin === correctPassword) {
      // Save session in sessionStorage
      sessionStorage.setItem('b_delivery_session_user', selectedUser);
      // Update global context state
      setUserRole(selectedUser);
      if (onLoginSuccess) onLoginSuccess(selectedUser);
    } else {
      // Trigger shake animation and error
      setError('⚠️ كلمة المرور غير صحيحة، حاول مرة أخرى');
      setIsShaking(true);
      setPin('');
      // Trigger haptic feedback if available
      if (navigator.vibrate) {
        navigator.vibrate(200);
      }
      setTimeout(() => {
        setIsShaking(false);
      }, 500);
    }
  };

  return (
    <div className="login-viewport" dir="rtl">
      {/* Background decoration */}
      <div className="login-bg-glow login-glow-1"></div>
      <div className="login-bg-glow login-glow-2"></div>

      <div className="login-container">
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div className="login-logo-container">
            <img src="/logo.png" alt="Abu Khater Logo" className="login-logo" onError={(e) => { e.target.style.display = 'none'; }} />
            <Shield size={36} color="var(--accent)" />
          </div>
          <h1 style={{ fontSize: '1.8rem', fontWeight: '800', margin: '12px 0 4px 0', color: 'white' }}>نظام توصيل أبو خاطر</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>الرجاء تسجيل الدخول لمتابعة العمل</p>
        </div>

        {/* User Selection */}
        <div className="login-user-select">
          <button
            type="button"
            className={`login-user-btn ${selectedUser === 'admin' ? 'active admin' : ''}`}
            onClick={() => setSelectedUser('admin')}
          >
            <Shield size={24} />
            <span>مدير النظام (Admin)</span>
          </button>
          <button
            type="button"
            className={`login-user-btn ${selectedUser === 'casher' ? 'active casher' : ''}`}
            onClick={() => setSelectedUser('casher')}
          >
            <User size={24} />
            <span>الكاشير (Casher)</span>
          </button>
        </div>

        {/* PIN Display Dots */}
        <div className={`login-pin-display ${isShaking ? 'shake' : ''}`}>
          <div className="login-dots-container">
            {[...Array(4)].map((_, i) => (
              <span
                key={i}
                className={`login-dot ${pin.length > i ? 'active' : ''}`}
              />
            ))}
            {pin.length > 4 && [...Array(pin.length - 4)].map((_, i) => (
              <span
                key={i + 4}
                className="login-dot active"
              />
            ))}
          </div>

          {error && <p className="login-error-msg">{error}</p>}
        </div>

        {/* Custom Numpad */}
        <div className="login-numpad">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
            <button
              key={num}
              type="button"
              className="login-num-btn"
              onClick={() => handleKeyPress(num)}
            >
              {num}
            </button>
          ))}

          {/* Action Row */}
          <button
            type="button"
            className="login-num-btn clear-btn"
            style={{ fontSize: '0.9rem', fontWeight: 'bold', color: 'var(--danger)' }}
            onClick={handleClear}
          >
            تصفير
          </button>

          <button
            type="button"
            className="login-num-btn"
            onClick={() => handleKeyPress(0)}
          >
            0
          </button>

          <button
            type="button"
            className="login-num-btn delete-btn"
            onClick={handleDelete}
            title="حذف رقم"
          >
            <Delete size={20} />
          </button>
        </div>

        {/* Action Button */}
        <button
          type="button"
          className="login-submit-btn"
          disabled={pin.length === 0}
          onClick={() => handleSubmit()}
        >
          <Check size={20} />
          <span>تأكيد الدخول</span>
        </button>

        {/* Ownership Notice */}
        <div style={{
          marginTop: '20px',
          textAlign: 'center',
          fontSize: '0.72rem',
          color: 'rgba(255, 255, 255, 0.35)',
          direction: 'ltr',
          borderTop: '1px solid rgba(255, 255, 255, 0.05)',
          paddingTop: '12px'
        }}>
          Developed & Owned by <span style={{ color: 'var(--accent, #10b981)', fontWeight: 'bold' }}>AmrMamdouh✔ </span> (01038035884)
        </div>
      </div>

      {/* Embedded Styles for Login Screen */}
      <style dangerouslySetInnerHTML={{
        __html: `
        @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&family=Outfit:wght@400;600;700;800&display=swap');

        .login-viewport * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }

        .login-viewport button {
          outline: none;
          -webkit-tap-highlight-color: transparent;
          font-family: inherit;
        }

        .login-viewport {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          height: 100dvh;
          background: #090d16;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 99999;
          font-family: 'Cairo', 'Outfit', sans-serif;
          overflow-y: auto;
          padding: 16px;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }

        .login-bg-glow {
          position: absolute;
          border-radius: 50%;
          filter: blur(120px);
          opacity: 0.15;
          z-index: 1;
          pointer-events: none;
        }

        @keyframes float-glow {
          0%, 100% { transform: translateY(0px) scale(1); }
          50% { transform: translateY(-20px) scale(1.1); }
        }

        .login-glow-1 {
          width: 320px;
          height: 320px;
          background: var(--primary, #3b82f6);
          top: -50px;
          right: -50px;
          animation: float-glow 8s ease-in-out infinite;
        }

        .login-glow-2 {
          width: 420px;
          height: 420px;
          background: var(--accent, #10b981);
          bottom: -100px;
          left: -100px;
          animation: float-glow 12s ease-in-out infinite alternate;
        }

        .login-container {
          position: relative;
          z-index: 2;
          width: 100%;
          max-width: 360px;
          padding: 24px 20px;
          background: rgba(10, 15, 30, 0.75);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 24px;
          box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5), inset 0 1px 1px rgba(255, 255, 255, 0.1);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          margin: auto;
        }

        .login-logo-container {
          width: 60px;
          height: 60px;
          margin: 0 auto;
          background: rgba(255, 255, 255, 0.03);
          border: 1.5px solid rgba(255, 255, 255, 0.1);
          border-radius: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: inset 0 2px 4px rgba(255, 255, 255, 0.05);
          animation: pulse-ring 3s infinite;
        }

        @keyframes pulse-ring {
          0%, 100% { box-shadow: 0 0 15px rgba(59, 130, 246, 0.2); border-color: rgba(255, 255, 255, 0.1); }
          50% { box-shadow: 0 0 25px rgba(16, 185, 129, 0.3); border-color: rgba(16, 185, 129, 0.3); }
        }

        .login-logo {
          width: 80%;
          height: 80%;
          object-fit: contain;
        }

        .login-user-select {
          display: flex;
          gap: 10px;
          margin-bottom: 20px;
        }

        .login-user-btn {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          padding: 12px 6px;
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 12px;
          color: var(--text-muted, #94a3b8);
          font-weight: bold;
          cursor: pointer;
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .login-user-btn:hover {
          background: rgba(255, 255, 255, 0.05);
          color: white;
          transform: translateY(-1px);
        }

        .login-user-btn.active.admin {
          background: rgba(59, 130, 246, 0.1);
          border-color: #3b82f6;
          color: #60a5fa;
          box-shadow: 0 4px 20px rgba(59, 130, 246, 0.15);
        }

        .login-user-btn.active.casher {
          background: rgba(16, 185, 129, 0.1);
          border-color: #10b981;
          color: #34d399;
          box-shadow: 0 4px 20px rgba(16, 185, 129, 0.15);
        }

        .login-pin-display {
          background: rgba(0, 0, 0, 0.25);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 12px;
          padding: 12px;
          text-align: center;
          margin-bottom: 20px;
          min-height: 70px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
        }

        .login-dots-container {
          display: flex;
          justify-content: center;
          gap: 12px;
          height: 12px;
        }

        .login-dot {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid rgba(255, 255, 255, 0.15);
          transition: all 0.15s ease;
        }

        .login-dot.active {
          background: white;
          transform: scale(1.2);
          box-shadow: 0 0 10px white;
        }

        .login-error-msg {
          color: #ef4444;
          font-size: 0.8rem;
          margin-top: 8px;
          font-weight: bold;
        }

        .login-numpad {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10px;
          margin-bottom: 20px;
        }

        .login-num-btn {
          height: 46px;
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 10px;
          color: white;
          font-size: 1.3rem;
          font-weight: 600;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.15s ease;
          user-select: none;
          box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
        }

        .login-num-btn:hover {
          background: rgba(255, 255, 255, 0.06);
          border-color: rgba(255, 255, 255, 0.12);
          color: #60a5fa;
        }

        .login-num-btn:active {
          background: rgba(59, 130, 246, 0.2);
          border-color: #3b82f6;
          transform: scale(0.92);
          box-shadow: 0 0 10px rgba(59, 130, 246, 0.3);
        }

        .login-num-btn.clear-btn:hover {
          color: #f87171 !important;
          background: rgba(239, 68, 68, 0.1);
          border-color: rgba(239, 68, 68, 0.2);
        }

        .login-num-btn.clear-btn:active {
          background: rgba(239, 68, 68, 0.2);
          border-color: #ef4444;
        }

        .login-num-btn.delete-btn {
          color: #94a3b8;
        }

        .login-num-btn.delete-btn:hover {
          background: rgba(255, 255, 255, 0.08);
          color: white;
        }

        .login-submit-btn {
          width: 100%;
          height: 46px;
          background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
          color: white;
          border: none;
          border-radius: 12px;
          font-size: 0.95rem;
          font-weight: bold;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          box-shadow: 0 4px 15px rgba(59, 130, 246, 0.3);
          transition: all 0.2s;
          text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
        }

        .login-submit-btn:hover:not(:disabled) {
          background: linear-gradient(135deg, #2563eb 0%, #1e40af 100%);
          box-shadow: 0 6px 20px rgba(59, 130, 246, 0.4);
        }

        .login-submit-btn:active:not(:disabled) {
          transform: scale(0.98);
        }

        .login-submit-btn:disabled {
          background: rgba(255, 255, 255, 0.05);
          color: rgba(255, 255, 255, 0.2);
          box-shadow: none;
          cursor: not-allowed;
          text-shadow: none;
        }

        /* Animations */
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20%, 60% { transform: translateX(-6px); }
          40%, 80% { transform: translateX(6px); }
        }

        .login-pin-display.shake {
          animation: shake 0.4s ease-in-out;
          border-color: #ef4444;
          background: rgba(239, 68, 68, 0.05);
        }

        /* 📱 Responsive overrides for extremely tiny mobile screens and landscape orientations */
        @media (max-width: 480px), (max-height: 680px) {
          .login-container {
            padding: 16px 14px;
            border-radius: 18px;
            max-width: 320px;
            box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4);
          }
          .login-logo-container {
            width: 44px;
            height: 44px;
            border-radius: 12px;
          }
          .login-logo-container svg {
            width: 22px !important;
            height: 22px !important;
          }
          h1 {
            font-size: 1.25rem !important;
            margin: 6px 0 2px 0 !important;
          }
          p {
            font-size: 0.75rem !important;
          }
          .login-user-select {
            gap: 6px;
            margin-bottom: 12px;
          }
          .login-user-btn {
            padding: 8px 4px;
            border-radius: 10px;
            font-size: 0.75rem;
            gap: 4px;
          }
          .login-user-btn svg {
            width: 16px !important;
            height: 16px !important;
          }
          .login-pin-display {
            padding: 8px;
            min-height: 48px;
            margin-bottom: 12px;
            border-radius: 10px;
          }
          .login-dot {
            width: 8px;
            height: 8px;
          }
          .login-numpad {
            gap: 8px;
            margin-bottom: 12px;
          }
          .login-num-btn {
            height: 38px;
            font-size: 1.1rem;
            border-radius: 8px;
          }
          .login-submit-btn {
            height: 38px;
            font-size: 0.85rem;
            border-radius: 10px;
          }
        }
      `}} />
    </div>
  );
};

export default Login;
