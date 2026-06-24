import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import logoCompasMarine1 from '../assets/images/compas-marine1.jpeg';

export const OlvidastePassword = ({ onNavigate }) => {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleResetPassword = (e) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    if (!email.trim()) {
      setError('Por favor ingresa tu correo electrónico.');
      return;
    }

    setIsLoading(true);

    // Simulación de envío de correo de recuperación
    setTimeout(() => {
      setIsLoading(false);
      setSuccessMsg('Si el correo existe en nuestro sistema, recibirás las instrucciones de recuperación en unos minutos.');
    }, 1500);
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
              <p className="card-sub">Te enviaremos un enlace para restablecer tu contraseña.</p>
            </div>
          </header>

          <form onSubmit={handleResetPassword}>
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

            {error && <div className="error-box">{error}</div>}
            {successMsg && <div className="success-box">{successMsg}</div>}

            <button 
              type="submit" 
              className="submit-btn" 
              disabled={isLoading || !!successMsg}
            >
              {isLoading ? 'Enviando...' : 'Enviar enlace'}
            </button>
          </form>

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