import { useState } from 'react';
import { ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { getApiUrl } from '../config/api';
import logoCompasMarine1 from '../assets/images/compas-marine1.jpeg';

export const OlvidastePassword = ({ onNavigate, onLoadingProgress }) => {
  const [step, setStep] = useState('verify');
  const [email, setEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [verificationToken, setVerificationToken] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleVerifyIdentity = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    if (!email.trim()) {
      setError('Por favor ingresa tu correo electrónico.');
      return;
    }

    if (!currentPassword) {
      setError('Por favor ingresa tu contraseña actual.');
      return;
    }

    setIsLoading(true);
    onLoadingProgress?.({ percent: 18 });

    try {
      const response = await fetch(getApiUrl('/auth/verify-reset-identity'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password: currentPassword
        })
      });

      onLoadingProgress?.({ percent: 66 });
      const data = await response.json();
      onLoadingProgress?.({ percent: 92 });

      if (!response.ok) {
        throw new Error(data.error || 'No se pudo validar tu identidad.');
      }

      setVerificationToken(data.verificationToken || '');
      setStep('reset');
      setCurrentPassword('');
      setIsLoading(false);
      onLoadingProgress?.({ percent: 100, done: true });
    } catch (err) {
      onLoadingProgress?.({ active: false });
      setIsLoading(false);
      setError(err.message || 'No se pudo validar tu identidad.');
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    if (!newPassword) {
      setError('Por favor ingresa una nueva contraseña.');
      return;
    }

    if (newPassword.length < 8) {
      setError('La nueva contraseña debe tener al menos 8 caracteres.');
      return;
    }

    if (newPassword !== confirmNewPassword) {
      setError('La confirmación de contraseña no coincide.');
      return;
    }

    if (!verificationToken) {
      setError('Debes validar tu identidad antes de cambiar la contraseña.');
      return;
    }

    setIsLoading(true);
    onLoadingProgress?.({ percent: 18 });

    try {
      const response = await fetch(getApiUrl('/auth/reset-password'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password: newPassword,
          verificationToken
        })
      });

      onLoadingProgress?.({ percent: 68 });
      const data = await response.json();
      onLoadingProgress?.({ percent: 92 });

      if (!response.ok) {
        throw new Error(data.error || 'No se pudo actualizar la contraseña.');
      }

      setIsLoading(false);
      onLoadingProgress?.({ percent: 100, done: true });
      setSuccessMsg('La contraseña fue actualizada. Ahora puedes iniciar sesión con la nueva clave.');
      setNewPassword('');
      setConfirmNewPassword('');
      setVerificationToken('');
      setStep('verify');
    } catch (err) {
      onLoadingProgress?.({ active: false });
      setIsLoading(false);
      setError(err.message || 'No se pudo actualizar la contraseña.');
    }
  };

  return (
    <main className="main-container">
      <div className="card">
        <div className="card-bg-deco"></div>

        <div className="card-body">
          
          {/* Cabecera unificada y protegida */}
          <header className="auth-branding-header">
              <div className="auth-branding-logo-wrapper">
                <div className="auth-branding-logo">
                  <img 
                    src={logoCompasMarine1} 
                    alt="COMPAS marine Logo" 
                    className="header-logo-img"
                    width="669"
                    height="373"
                    decoding="async"
                  />
                </div>

              {/* Botón de regreso alineado estéticamente a la derecha del logo */}
              <button 
                type="button" 
                className="auth-back-inline-btn" 
                onClick={() => onNavigate('login')}
                aria-label="Volver al inicio de sesión"
              >
                <ArrowLeft size={14} /> Volver
              </button>
            </div>
            
            <div className="auth-branding-titles">
              <h2 className="card-heading">Recuperar Acceso</h2>
              <p className="card-sub">
                {step === 'verify'
                  ? 'Paso 1: valida tu correo y contraseña actual.'
                  : 'Paso 2: define tu nueva contraseña.'}
              </p>
            </div>
          </header>

          {step === 'verify' && (
          <form onSubmit={handleVerifyIdentity}>
            <div className="field" style={{ marginBottom: '1.5rem' }}>
              <label className="field-label">Correo electrónico corporativo</label>
              <input
                className="input"
                type="email"
                placeholder="Correo Electrónico Personal"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="field">
              <label className="field-label">Contraseña actual</label>
              <div className="input-wrap">
                <input
                  className="input with-icon"
                  type={showCurrentPassword ? 'text' : 'password'}
                  placeholder="Tu contraseña actual"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="eye-btn"
                  onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                  aria-label={showCurrentPassword ? 'Ocultar contraseña actual' : 'Mostrar contraseña actual'}
                >
                  {showCurrentPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {error && <div className="error-box">{error}</div>}
            {successMsg && <div className="success-box">{successMsg}</div>}

            <button 
              type="submit" 
              className="submit-btn" 
              disabled={isLoading}
            >
              {isLoading ? 'Validando...' : 'Continuar'}
            </button>
          </form>
          )}

          {step === 'reset' && (
          <form onSubmit={handleResetPassword}>
            <div className="field" style={{ marginBottom: '1.5rem' }}>
              <label className="field-label">Correo validado</label>
              <input
                className="input"
                type="email"
                value={email}
                disabled
                readOnly
              />
            </div>

            <div className="field">
              <label className="field-label">Nueva contraseña</label>
              <div className="input-wrap">
                <input
                  className="input with-icon"
                  type={showNewPassword ? 'text' : 'password'}
                  placeholder="Mínimo 8 caracteres"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="eye-btn"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  aria-label={showNewPassword ? 'Ocultar nueva contraseña' : 'Mostrar nueva contraseña'}
                >
                  {showNewPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <div className="field" style={{ marginBottom: '1.5rem' }}>
              <label className="field-label">Confirmar nueva contraseña</label>
              <div className="input-wrap">
                <input
                  className="input with-icon"
                  type={showConfirmPassword ? 'text' : 'password'}
                  placeholder="Repite tu nueva contraseña"
                  autoComplete="new-password"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="eye-btn"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  aria-label={showConfirmPassword ? 'Ocultar confirmación de contraseña' : 'Mostrar confirmación de contraseña'}
                >
                  {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {error && <div className="error-box">{error}</div>}
            {successMsg && <div className="success-box">{successMsg}</div>}

            <button 
              type="submit" 
              className="submit-btn" 
              disabled={isLoading}
            >
              {isLoading ? 'Actualizando...' : 'Cambiar contraseña'}
            </button>

            <button
              type="button"
              className="link-btn"
              style={{ marginTop: '0.75rem' }}
              onClick={() => {
                setStep('verify');
                setVerificationToken('');
                setNewPassword('');
                setConfirmNewPassword('');
                setError('');
                setSuccessMsg('');
              }}
            >
              Volver al paso anterior
            </button>
          </form>
          )}

          <div className="divider">
            <div className="divider-line"></div>
            <span className="divider-txt">Acceso corporativo</span>
            <div className="divider-line"></div>
          </div>

          <p className="footer-note">Compas Marine &copy; 2026 &middot; Gestión Documental</p>
        </div>
      </div>
    </main>
  );
};
