import { useEffect, useState } from 'react';
import { Moon, Sun, X } from 'lucide-react';
import logo50Anios from '../assets/images/compas marine 50 años.jpeg'; 

export const Header = () => {
  const [darkMode, setDarkMode] = useState(false);
  const [showPopup, setShowPopup] = useState(true);

  useEffect(() => {
    const storedTheme = localStorage.getItem('theme');
    const userPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const initialTheme = storedTheme ? storedTheme === 'dark' : userPrefersDark;

    setDarkMode(initialTheme);
    document.documentElement.classList.toggle('dark', initialTheme);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  const toggleTheme = () => {
    setDarkMode((current) => !current);
  };

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
        {darkMode ? <Sun className="header-theme-icon" /> : <Moon className="header-theme-icon" />}
        <span>{darkMode ? 'Claro' : 'Oscuro'}</span>
      </button>

      {showPopup && (
        <div className="popup-overlay">
          <div className="popup-content">
            <button className="popup-close" onClick={() => setShowPopup(false)}>
              <X size={20} />
            </button>
            <img
              src={logo50Anios}
              alt="Compas Marine 50 años"
              className="popup-image"
            />
          </div>
        </div>
      )}
    </header>
  );
};