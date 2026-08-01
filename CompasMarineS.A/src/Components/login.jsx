import { useState } from 'react';
import { Eye, EyeOff, Info } from 'lucide-react';
import { getApiUrl } from '../config/api';
import logoCompasMarine1 from '../assets/images/compas-marine1.jpeg';

export const Login = ({ onLoginSuccess, onLoadingProgress }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passVisible, setPassVisible] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Estados para el control de la ayuda visual (permanecen activos hasta el click)
  const [showEmailTip, setShowEmailTip] = useState(true);
  const [showPassTip, setShowPassTip] = useState(true);
  const [showSecurityNotice, setShowSecurityNotice] = useState(true);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');

    if (!email.trim() || !password) {
      setError('Por favor completa todos los campos.');
      return;
    }

    setIsLoading(true);
    onLoadingProgress?.({ percent: 12 });

    try {
      const response = await fetch(getApiUrl('/auth/login'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password })
      });

      onLoadingProgress?.({ percent: 68 });
      const data = await response.json();
      onLoadingProgress?.({ percent: 88 });

      if (!response.ok || !data.ok || !data.user) {
        throw new Error(data.error || 'Credenciales incorrectas. Intenta nuevamente.');
      }

      onLoadingProgress?.({ percent: 100, done: true });
      onLoginSuccess(data.user);
    } catch (err) {
      onLoadingProgress?.({ active: false });
      setError(err.message || 'No se pudo iniciar sesión.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="main-container">
      <div className="card">
        <div className="card-bg-deco"></div>

        <div className="card-body">
          
          {/* Cabecera corporativa */}
          <header className="auth-branding-header">
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
            
            <div className="auth-branding-titles">
              <h2 className="card-heading">Iniciar Sesión</h2>
              <p className="card-sub">Ingresa tus credenciales de acceso</p>
            </div>
          </header>

          {/* Recordatorio de cambio de contraseña (Seguridad) - Tonos Grises Neutros */}
          {showSecurityNotice && (
            <div 
              onClick={() => setShowSecurityNotice(false)}
              className="bg-zinc-100 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 p-2.5 rounded-lg text-xs font-medium mb-4 flex items-center justify-between cursor-pointer transition-all hover:bg-zinc-200 dark:hover:bg-zinc-800 select-none"
              title="Haz clic para descartar"
            >
              <div className="flex items-center gap-2">
                <Info size={14} className="shrink-0 text-zinc-500 dark:text-zinc-400" />
                <span><strong>Aviso de seguridad:</strong> Más adelante se le solicitará cambiar su contraseña para mayor resguardo de su cuenta.</span>
              </div>
              <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-bold ml-2">✕</span>
            </div>
          )}
        
          <form onSubmit={handleLogin}>
            <div className="field">
              <label className="field-label">Correo electrónico</label>
              <input
                className="input"
                type="email"
                placeholder="Correo Electrónico Personal"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              
              {/* Ayuda visual Correo - Tonos Grises Neutros */}
              {showEmailTip && (
                <div 
                  onClick={() => setShowEmailTip(false)}
                  className="bg-zinc-100 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 px-3 py-1.5 rounded-md text-[11px] font-medium mt-1 flex items-center justify-between cursor-pointer hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors select-none"
                  title="Haz clic para ocultar"
                >
                  <span>💡 Ingrese su correo electrónico personal o el que se le haya asignado.</span>
                  <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-bold ml-2">✕</span>
                </div>
              )}
            </div>

            <div className="field" style={{ marginBottom: '0.5rem' }}>
              <label className="field-label">Contraseña</label>
              <div className="input-wrap">
                <input
                  className="input with-icon"
                  type={passVisible ? 'text' : 'password'}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="eye-btn"
                  onClick={() => setPassVisible(!passVisible)}
                  aria-label={passVisible ? "Ocultar contraseña" : "Mostrar contraseña"}
                >
                  {passVisible ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>

              {/* Ayuda visual Contraseña - Tonos Grises Neutros */}
              {showPassTip && (
                <div 
                  onClick={() => setShowPassTip(false)}
                  className="bg-zinc-100 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 px-3 py-1.5 rounded-md text-[11px] font-medium mt-1 flex items-center justify-between cursor-pointer hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors select-none"
                  title="Haz clic para ocultar"
                >
                  <span>🔑 Ingrese su RUT completo como contraseña.</span>
                  <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-bold ml-2">✕</span>
                </div>
              )}
            </div>

            {error && <div className="error-box">{error}</div>}

            <div className="btn-group" style={{ marginTop: '1.25rem' }}>
              <button 
                type="submit" 
                className="submit-btn" 
                disabled={isLoading}
              >
                {isLoading ? 'Ingresando...' : 'Ingresar'}
              </button>
            </div>
          </form>

          <div className="divider">
            <div className="divider-line"></div>
            <span className="divider-txt">Acceso corporativo</span>
            <div className="divider-line"></div>
          </div>
          
          <p className="footer-note">Compas Marine / Desarrollado por IngeniaSur &copy; 2026 &middot; Gestión Documental</p>
        </div>
      </div>
    </main>
  );
};
