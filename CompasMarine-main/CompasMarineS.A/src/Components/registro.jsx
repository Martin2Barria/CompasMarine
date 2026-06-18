import { useState } from 'react';
import { Eye, EyeOff, ArrowLeft } from 'lucide-react';
import { getApiUrl } from '../config/api';

export const Registro = ({ onNavigate }) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passVisible, setPassVisible] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    if (!name.trim() || !email.trim() || !password) {
      setError('Por favor completa todos los campos.');
      return;
    }

    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.');
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch(getApiUrl('/auth/register'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          nombre: name.trim(),
          email: email.trim().toLowerCase(),
          password
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'No se pudo completar el registro.');
      }

      setSuccessMsg('Cuenta creada con éxito. Redirigiendo al inicio de sesión...');
      setTimeout(() => {
        onNavigate('login');
      }, 2000);
    } catch (err) {
      setError(err.message || 'No se pudo completar el registro.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="main-container">
      <div className="card">
        <div className="card-bg-deco"></div>

        <div className="card-body">
          
          {/* Cabecera unificada y protegida contra colisiones */}
          <header className="auth-branding-header">
            <div className="auth-branding-logo-wrapper">
              <div className="auth-branding-logo">
                <div className="auth-branding-text">
                  <span className="auth-branding-title">COMPAS</span>
                  <span className="auth-branding-subtitle">marine</span>
                </div>
              </div>

              {/* Botón de regreso integrado perfectamente al lado del logo */}
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
              <h2 className="card-heading">Crear Cuenta</h2>
              <p className="card-sub">Regístrate en la plataforma de tripulación</p>
            </div>
          </header>

          <form onSubmit={handleRegister}>
            <div className="field">
              <label className="field-label">Nombre Completo</label>
              <input
                className="input"
                type="text"
                placeholder="Juan Pérez"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="field">
              <label className="field-label">Correo electrónico corporativo</label>
              <input
                className="input"
                type="email"
                placeholder="correo@compas.com"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="field" style={{ marginBottom: '1.5rem' }}>
              <label className="field-label">Contraseña</label>
              <div className="input-wrap">
                <input
                  className="input with-icon"
                  type={passVisible ? 'text' : 'password'}
                  placeholder="••••••••"
                  autoComplete="new-password"
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
            {successMsg && <div className="success-box">{successMsg}</div>}

            <button 
              type="submit" 
              className="submit-btn" 
              disabled={isLoading || !!successMsg}
            >
              {isLoading ? 'Registrando...' : 'Registrarse'}
            </button>
          </form>

          <div className="divider">
            <div className="divider-line"></div>
            <span className="divider-txt">Acceso corporativo</span>
            <div className="divider-line"></div>
          </div>

          <p className="footer-note">Compas Marine &copy; 2026 &middot; Gestión de Tripulación</p>
        </div>
      </div>
    </main>
  );
};