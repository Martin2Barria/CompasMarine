import { useEffect, useState } from 'react';
import { Moon, Sun, X } from 'lucide-react';
import logo50Anios from '../assets/images/compas marine 50 años.jpeg';

const POPUP_DURATION = 5000; // ms que permanece visible
const FADE_DURATION  = 400;  // ms de la animación de salida

export const Header = () => {
  const [darkMode,   setDarkMode]   = useState(false);
  const [showPopup,  setShowPopup]  = useState(true);
  const [isClosing,  setIsClosing]  = useState(false);

  // Leer tema guardado
  useEffect(() => {
    const stored       = localStorage.getItem('theme');
    const prefersDark  = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const initial      = stored ? stored === 'dark' : prefersDark;
    setDarkMode(initial);
    document.documentElement.classList.toggle('dark', initial);
  }, []);

  // Sincronizar tema
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  // ✅ Auto-cierre del popup
  useEffect(() => {
    if (!showPopup) return;

    const autoClose = setTimeout(() => {
      // 1. Disparar animación de salida
      setIsClosing(true);
      // 2. Quitar el DOM al terminar la animación
      setTimeout(() => {
        setShowPopup(false);
        setIsClosing(false);
      }, FADE_DURATION);
    }, POPUP_DURATION);

    return () => clearTimeout(autoClose); // limpia si el usuario cierra antes
  }, [showPopup]);

  // Cierre manual (botón ✕)
  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      setShowPopup(false);
      setIsClosing(false);
    }, FADE_DURATION);
  };

  const toggleTheme = () => setDarkMode(prev => !prev);

  return (
    <header className="header-nav">
      <div className="header-logo">
        <div className="header-logo-text">
          <span className="header-logo-title">COMPAS</span>
          <span className="header-logo-subtitle">marine</span>
        </div>
      </div>

      <button
        type="button"
        className="header-theme-button"
        onClick={toggleTheme}
        aria-label="Cambiar modo claro/oscuro"
      >
        {darkMode
          ? <Sun  className="header-theme-icon" />
          : <Moon className="header-theme-icon" />}
        <span>{darkMode ? 'Claro' : 'Oscuro'}</span>
      </button>

      {showPopup && (
        <div className={`popup-overlay ${isClosing ? 'closing' : ''}`}>
          <div className={`popup-content ${isClosing ? 'closing' : ''}`}>
            <button className="popup-close" onClick={handleClose}>
              <X size={20} />
            </button>

            <img
              src={logo50Anios}
              alt="Compas Marine 50 años"
              className="popup-image"
            />

            {/* Barra de progreso */}
            <div className="popup-progress">
              <div
                className="popup-progress-bar"
                style={{ animationDuration: `${POPUP_DURATION}ms` }}
              />
            </div>
          </div>
        </div>
      )}
    </header>
  );
};