import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { getApiUrl } from '../config/api';
import logoCompasMarine1 from '../assets/images/compas-marine1.jpeg';

export const Login = ({ onLoginSuccess, onLoadingProgress }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passVisible, setPassVisible] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

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

      if (!response.ok) {
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
          
          {/* Cabecera aislada con nombres de clase únicos */}
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
            </div>

            {error && <div className="error-box">{error}</div>}

            <div className="btn-group">
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
          {/* ==========================================================================
             ⚠️ BOTÓN TEMPORAL DE DESARROLLO (Borrar por completo para producción)
             ========================================================================== */}
          {/* <div style={{ marginBottom: '1.5rem', textAlign: 'center' }}>
            <button
              type="button"
              onClick={onLoginSuccess}
              style={{
                width: '100%',
                padding: '0.6rem',
                fontSize: '0.8rem',
                fontWeight: '600',
                backgroundColor: '#fef3c7', // Color amarillo de advertencia suave
                color: '#92400e',
                border: '1px dashed #f59e0b',
                borderRadius: '0.5rem',
                cursor: 'pointer',
              }}
            >
              ⚠️ Modo Desarrollo: Saltar Login (Bypass)
            </button>
          </div> */}
          {/* ========================================================================== */}

          <p className="footer-note">Compas Marine &copy; 2026 &middot; Gestión Documental</p>
        </div>
      </div>
    </main>
  );
};
