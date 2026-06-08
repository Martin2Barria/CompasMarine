import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import logo50Anios from '../assets/images/compas marine 50 años.jpeg';

const POPUP_DURATION = 2000; // ← segundos que el logo permanece visible (2s)
const FADE_DURATION  = 800;  // ← segundos del difuminado de salida (0.8s) — debe coincidir con fadeOut en CSS

export const Header = () => {
  const [darkMode,  setDarkMode]  = useState(false);
  const [showPopup, setShowPopup] = useState(true);
  const [isClosing, setIsClosing] = useState(false);

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

    const timer = setTimeout(() => {
      setIsClosing(true);             // arranca el fade de salida
      setTimeout(() => {
        setShowPopup(false);          // desmonta el componente al terminar el fade
        setIsClosing(false);
      }, FADE_DURATION);              // ← espera el mismo tiempo que dura el CSS
    }, POPUP_DURATION);               // ← espera antes de empezar a desvanecerse

    return () => clearTimeout(timer);
  }, [showPopup]);

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