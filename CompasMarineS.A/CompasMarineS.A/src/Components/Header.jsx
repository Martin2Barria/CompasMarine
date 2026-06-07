import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

export const Header = () => {
  const [darkMode, setDarkMode] = useState(false);

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
    </header>
  );
};
