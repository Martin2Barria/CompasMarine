import { useState } from 'react';
import { Eye, EyeOff, ArrowLeft } from 'lucide-react';
import { getApiUrl } from '../config/api';
import logoCompasMarine1 from '../assets/images/compas-marine1.jpeg';

// Función para formatear RUT/RUN
const formatRut = (value) => {
  let rut = value.replace(/[^0-9kK]/g, '').toUpperCase();
  if (rut.length <= 1) return rut;

  const cuerpo = rut.slice(0, -1);
  const dv = rut.slice(-1);

  let cuerpoFormateado = '';
  let i = 0;
  for (let j = cuerpo.length - 1; j >= 0; j--) {
    cuerpoFormateado = cuerpo[j] + cuerpoFormateado;
    i++;
    if (i === 3 && j !== 0) {
      cuerpoFormateado = '.' + cuerpoFormateado;
      i = 0;
    }
  }

  return `${cuerpoFormateado}-${dv}`;
};

// Validación módulo 11
const validarRut = (rut) => {
  rut = rut.replace(/\./g, '').replace(/-/g, '').toUpperCase();
  const cuerpo = rut.slice(0, -1);
  const dv = rut.slice(-1);

  let suma = 0;
  let multiplo = 2;

  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += parseInt(cuerpo[i]) * multiplo;
    multiplo = multiplo < 7 ? multiplo + 1 : 2;
  }

  const dvEsperado = 11 - (suma % 11);
  let dvFinal = dvEsperado === 11 ? '0' : dvEsperado === 10 ? 'K' : dvEsperado.toString();

  return dvFinal === dv;
};

export const Registro = ({ onNavigate }) => {
  const [name, setName] = useState('');
  const [rut, setRut] = useState('');
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

    if (!name.trim() || !rut.trim() || !email.trim() || !password) {
      setError('Por favor completa todos los campos.');
      return;
    }

    if (!validarRut(rut)) {
      setError('El RUT ingresado no es válido. Ejemplo: 12.345.678-9');
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
          rut: rut.trim(),
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
              <label className="field-label">RUN / RUT</label>
              <input
                className="input"
                type="text"
                placeholder="Ej: 12.345.678-9"
                value={rut}
                onChange={(e) => setRut(formatRut(e.target.value))}
              />
            </div>

            <div className="field">
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

          <p className="footer-note">Compas Marine &copy; 2026 &middot; Gestión Documental</p>
        </div>
      </div>
    </main>
  );
};
