import { useEffect, useState, useRef } from 'react';
import { Moon, Sun } from 'lucide-react';
import logo50Anios from '../assets/images/compas marine 50 años.jpeg';
import logoCompasMarine1 from '../assets/images/compas-marine1.jpeg';

const POPUP_DURATION = 1500; // ← tiempo normal antes del fade (1.5s)
const FADE_DURATION  = 900;  // ← duración del fadeOut en CSS (0.9s)

export const Header = () => {
  const [darkMode,  setDarkMode]  = useState(false);
  const [showPopup, setShowPopup] = useState(true);
  const [isClosing, setIsClosing] = useState(false);

  // Usamos referencias para poder limpiar los timers desde cualquier función
  const timerTimeoutRef = useRef(null);
  const fadeTimeoutRef = useRef(null);

  useEffect(() => {
    const stored      = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const initial     = stored ? stored === 'dark' : prefersDark;
    setDarkMode(initial);
    document.documentElement.classList.toggle('dark', initial);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  useEffect(() => {
    if (!showPopup) return;

    // Guardamos el timer en la referencia
    timerTimeoutRef.current = setTimeout(() => {
      setIsClosing(true);            
      fadeTimeoutRef.current = setTimeout(() => {
        setShowPopup(false);          
        setIsClosing(false);
      }, FADE_DURATION);              
    }, POPUP_DURATION);               

    return () => {
      clearTimeout(timerTimeoutRef.current);
      clearTimeout(fadeTimeoutRef.current);
    };
  }, [showPopup]);

  // Función para cerrar el popup inmediatamente al hacer clic
  const handleSkipPopup = () => {
    // Cancelamos los contadores de tiempo activos para que no interfieran
    clearTimeout(timerTimeoutRef.current);
    clearTimeout(fadeTimeoutRef.current);
    
    // Saltamos directo al desmontado del componente
    setIsClosing(false);
    setShowPopup(false);
  };

  const toggleTheme = () => setDarkMode(prev => !prev);

  return (
    <header className="header-nav">
      <div className="header-logo">
        <img 
          src={logoCompasMarine1} 
          alt="COMPAS marine Logo" 
          className="header-logo-img"
        />
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

      {/* NUEVO: Al hacer clic en el overlay (fondo o imagen), se ejecuta handleSkipPopup */}
      {showPopup && (
        <div 
          className={`popup-overlay ${isClosing ? 'closing' : ''}`}
          onClick={handleSkipPopup}
          style={{ cursor: 'pointer' }} // Muestra la manito en PC indicando que es cliqueable
        >
          <img
            src={logo50Anios}
            alt="Compas Marine 50 años"
            className="popup-image"
          />
        </div>
      )}
    </header>
  );
};