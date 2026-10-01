// Developed & Owned by AmrMamdouh - 01038035884
import React, { useState, useEffect } from 'react';
import { Shield, User, Bike, Delete, Check, Lock, Mail, Loader2, KeyRound } from 'lucide-react';
import { useApp } from '../../context/AppContext';

const DEFAULT_EMAILS = {
  admin: 'admin@abukhater.com',
  casher: 'casher@abukhater.com',
  driver: 'driver@abukhater.com'
};

const Login = ({ onLoginSuccess }) => {
  const { loginStaff, currentStaff } = useApp();
  const [selectedUser, setSelectedUser] = useState('casher'); // admin | casher | driver
  const [authMode, setAuthMode] = useState('password'); // Default to real Supabase Email + Password
  const [email, setEmail] = useState(DEFAULT_EMAILS.casher);
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [isShaking, setIsShaking] = useState(false);

  // Update default email when role changes
  useEffect(() => {
    setError('');
    setPin('');
    setPassword('');
    setEmail(DEFAULT_EMAILS[selectedUser] || '');
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

  const triggerError = (msg) => {
    setError(msg);
    setIsShaking(true);
    setPin('');
    if (navigator.vibrate) {
      navigator.vibrate(200);
    }
    setTimeout(() => {
      setIsShaking(false);
    }, 500);
  };

  const handleAuthSubmit = async (e) => {
    if (e) e.preventDefault();
    if (loading) return;

    const targetEmail = email.trim();

    // Mode 1: Quick PIN validation for existing session unlock
    if (authMode === 'pin') {
      if (!pin) {
        triggerError('⚠️ يرجى إدخال رمز الـ PIN');
        return;
      }

      if (currentStaff) {
        if (currentStaff.quick_pin && pin === String(currentStaff.quick_pin)) {
          if (onLoginSuccess) onLoginSuccess(currentStaff.role);
          return;
        } else {
          triggerError('⚠️ رمز الـ PIN غير صحيح');
          return;
        }
      } else {
        triggerError('⚠️ يرجى تسجيل الدخول أولاً بالبريد وكلمة المرور');
        setAuthMode('password');
        return;
      }
    }

    // Mode 2: Real Supabase Auth (Email + Password)
    if (!targetEmail || !password) {
      triggerError('⚠️ يرجى إدخال البريد الإلكتروني وكلمة المرور');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const profile = await loginStaff({
        email: targetEmail,
        password: password
      });

      if (profile) {
        if (onLoginSuccess) onLoginSuccess(profile.role);
      }
    } catch (err) {
      console.error('[Login] Auth error:', err);
      const msg = err?.message || '';
      if (msg.includes('Invalid login credentials') || msg.includes('invalid_credentials')) {
        triggerError('⚠️ البريد الإلكتروني أو كلمة المرور غير صحيحة');
      } else if (msg.includes('Staff Role Required') || msg.includes('ليس لديه صلاحية')) {
        triggerError('⚠️ هذا الحساب غير مسجل كعضو في طاقم العمل');
      } else if (msg.includes('تعطيل')) {
        triggerError('⚠️ تم تعطيل هذا الحساب من قبل إدارة المطعم');
      } else {
        triggerError(`⚠️ ${msg || 'فشل تسجيل الدخول، تحقق من اتصالك'}`);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-viewport" dir="rtl">
      {/* Background decoration */}
      <div className="login-bg-glow login-glow-1"></div>
      <div className="login-bg-glow login-glow-2"></div>

      <div className="login-container">
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
          <div className="login-logo-container">
            <img src="/logo.png" alt="Abu Khater Logo" className="login-logo" onError={(e) => { e.target.style.display = 'none'; }} />
            <Shield size={36} color="var(--accent, #10b981)" />
          </div>
          <h1 style={{ fontSize: '1.6rem', fontWeight: '800', margin: '10px 0 4px 0', color: 'white' }}>نظام توصيل أبو خاطر</h1>
          <p style={{ color: 'var(--text-muted, #94a3b8)', fontSize: '0.85rem' }}>بوابة مصادقة موظفي المطعم الموثقة</p>
        </div>

        {/* User Role Selection */}
        <div className="login-user-select" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px', marginBottom: '16px' }}>
          <button
            type="button"
            className={`login-user-btn ${selectedUser === 'admin' ? 'active admin' : ''}`}
            onClick={() => setSelectedUser('admin')}
            disabled={loading}
          >
            <Shield size={20} />
            <span>المدير</span>
          </button>
          <button
            type="button"
            className={`login-user-btn ${selectedUser === 'casher' ? 'active casher' : ''}`}
            onClick={() => setSelectedUser('casher')}
            disabled={loading}
          >
            <User size={20} />
            <span>الكاشير</span>
          </button>
          <button
            type="button"
            className={`login-user-btn ${selectedUser === 'driver' ? 'active driver' : ''}`}
            onClick={() => setSelectedUser('driver')}
            disabled={loading}
          >
            <Bike size={20} />
            <span>طيار</span>
          </button>
        </div>

        {/* Auth Mode Toggle */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginBottom: '16px' }}>
          <button
            type="button"
            onClick={() => setAuthMode('pin')}
            style={{
              padding: '6px 14px',
              borderRadius: '8px',
              border: authMode === 'pin' ? '1px solid var(--accent, #10b981)' : '1px solid rgba(255,255,255,0.1)',
              background: authMode === 'pin' ? 'rgba(16, 185, 129, 0.15)' : 'transparent',
              color: authMode === 'pin' ? '#34d399' : '#94a3b8',
              fontSize: '0.8rem',
              fontWeight: 'bold',
              cursor: 'pointer'
            }}
          >
            رمز الـ PIN السريع
          </button>
          <button
            type="button"
            onClick={() => setAuthMode('password')}
            style={{
              padding: '6px 14px',
              borderRadius: '8px',
              border: authMode === 'password' ? '1px solid var(--accent, #10b981)' : '1px solid rgba(255,255,255,0.1)',
              background: authMode === 'password' ? 'rgba(16, 185, 129, 0.15)' : 'transparent',
              color: authMode === 'password' ? '#34d399' : '#94a3b8',
              fontSize: '0.8rem',
              fontWeight: 'bold',
              cursor: 'pointer'
            }}
          >
            البريد وكلمة السر
          </button>
        </div>

        {/* Error message */}
        {error && (
          <div style={{ background: 'rgba(239, 68, 68, 0.15)', border: '1px solid #ef4444', color: '#fca5a5', padding: '10px', borderRadius: '10px', fontSize: '0.82rem', marginBottom: '14px', textAlign: 'center' }}>
            {error}
          </div>
        )}

        {/* Mode 1: PIN Numpad */}
        {authMode === 'pin' && (
          <>
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
            </div>

            <div className="login-numpad">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
                <button
                  key={num}
                  type="button"
                  className="login-num-btn"
                  onClick={() => handleKeyPress(num)}
                  disabled={loading}
                >
                  {num}
                </button>
              ))}

              <button
                type="button"
                className="login-num-btn clear-btn"
                style={{ fontSize: '0.9rem', fontWeight: 'bold', color: 'var(--danger, #ef4444)' }}
                onClick={handleClear}
                disabled={loading}
              >
                تصفير
              </button>

              <button
                type="button"
                className="login-num-btn"
                onClick={() => handleKeyPress(0)}
                disabled={loading}
              >
                0
              </button>

              <button
                type="button"
                className="login-num-btn delete-btn"
                onClick={handleDelete}
                title="حذف رقم"
                disabled={loading}
              >
                <Delete size={20} />
              </button>
            </div>
          </>
        )}

        {/* Mode 2: Standard Email & Password Form */}
        {authMode === 'password' && (
          <form onSubmit={handleAuthSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
            <div>
              <label style={{ display: 'block', color: 'var(--text-muted, #94a3b8)', fontSize: '0.8rem', marginBottom: '4px' }}>
                البريد الإلكتروني:
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 36px 10px 12px',
                    borderRadius: '10px',
                    border: '1px solid rgba(255,255,255,0.15)',
                    background: 'rgba(255,255,255,0.05)',
                    color: 'white',
                    fontSize: '0.9rem',
                    outline: 'none'
                  }}
                  required
                />
                <Mail size={16} color="#94a3b8" style={{ position: 'absolute', right: '12px', top: '12px' }} />
              </div>
            </div>

            <div>
              <label style={{ display: 'block', color: 'var(--text-muted, #94a3b8)', fontSize: '0.8rem', marginBottom: '4px' }}>
                كلمة المرور:
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 36px 10px 12px',
                    borderRadius: '10px',
                    border: '1px solid rgba(255,255,255,0.15)',
                    background: 'rgba(255,255,255,0.05)',
                    color: 'white',
                    fontSize: '0.9rem',
                    outline: 'none'
                  }}
                  required
                />
                <Lock size={16} color="#94a3b8" style={{ position: 'absolute', right: '12px', top: '12px' }} />
              </div>
            </div>
          </form>
        )}

        {/* Action Button */}
        <button
          type="button"
          className="login-submit-btn"
          disabled={loading || (authMode === 'pin' && pin.length === 0)}
          onClick={handleAuthSubmit}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
        >
          {loading ? (
            <>
              <Loader2 size={20} className="animate-spin" />
              <span>جاري التحقق من السيرفر...</span>
            </>
          ) : (
            <>
              <Check size={20} />
              <span>تأكيد الدخول عبر Supabase</span>
            </>
          )}
        </button>

        {/* Ownership Notice */}
        <div style={{
          marginTop: '16px',
          textAlign: 'center',
          fontSize: '0.72rem',
          color: 'rgba(255, 255, 255, 0.35)',
          direction: 'ltr',
          borderTop: '1px solid rgba(255, 255, 255, 0.05)',
          paddingTop: '10px'
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
          background: rgba(15, 23, 42, 0.75);
          backdrop-filter: blur(16px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 24px;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
        }

        .login-logo-container {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 56px;
          height: 56px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 16px;
          margin-bottom: 4px;
        }

        .login-logo {
          width: 36px;
          height: 36px;
          object-fit: contain;
        }

        .login-user-select {
          margin-bottom: 16px;
        }

        .login-user-btn {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 10px 4px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 14px;
          color: var(--text-muted, #94a3b8);
          font-size: 0.75rem;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .login-user-btn:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.06);
          color: white;
        }

        .login-user-btn.active.admin {
          background: rgba(59, 130, 246, 0.15);
          border-color: rgba(59, 130, 246, 0.5);
          color: #60a5fa;
        }

        .login-user-btn.active.casher {
          background: rgba(16, 185, 129, 0.15);
          border-color: rgba(16, 185, 129, 0.5);
          color: #34d399;
        }

        .login-user-btn.active.driver {
          background: rgba(245, 158, 11, 0.15);
          border-color: rgba(245, 158, 11, 0.5);
          color: #fbbf24;
        }

        .login-pin-display {
          display: flex;
          flex-direction: column;
          align-items: center;
          margin-bottom: 16px;
        }

        .login-dots-container {
          display: flex;
          gap: 12px;
          margin-bottom: 4px;
        }

        .login-dot {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          border: 2px solid rgba(255, 255, 255, 0.2);
          background: transparent;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .login-dot.active {
          background: var(--accent, #10b981);
          border-color: var(--accent, #10b981);
          box-shadow: 0 0 12px var(--accent, #10b981);
          transform: scale(1.15);
        }

        .login-numpad {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 8px;
          margin-bottom: 16px;
        }

        .login-num-btn {
          height: 48px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 12px;
          color: white;
          font-size: 1.25rem;
          font-weight: 700;
          font-family: 'Outfit', sans-serif;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .login-num-btn:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.08);
          border-color: rgba(255, 255, 255, 0.15);
          transform: translateY(-1px);
        }

        .login-num-btn:active:not(:disabled) {
          transform: translateY(1px);
        }

        .login-submit-btn {
          width: 100%;
          height: 48px;
          background: var(--accent, #10b981);
          border: none;
          border-radius: 14px;
          color: #090d16;
          font-size: 0.95rem;
          font-weight: 800;
          cursor: pointer;
          transition: all 0.2s ease;
          box-shadow: 0 4px 14px rgba(16, 185, 129, 0.35);
        }

        .login-submit-btn:hover:not(:disabled) {
          filter: brightness(1.08);
          transform: translateY(-1px);
        }

        .login-submit-btn:disabled {
          opacity: 0.45;
          cursor: not-allowed;
          box-shadow: none;
          transform: none;
        }

        .login-pin-display.shake {
          animation: shake 0.4s ease-in-out;
        }

        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20%, 60% { transform: translateX(-6px); }
          40%, 80% { transform: translateX(6px); }
        }

        .animate-spin {
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        `
      }} />
    </div>
  );
};

export default Login;
