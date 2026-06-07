import { useState, useEffect } from 'react';
import { IdCard } from 'lucide-react';

export const PassportCard = () => {
  const [status, setStatus] = useState({
    text: 'Calculando...',
    days: '--',
    bgClass: 'bg-gray-100 text-gray-600',
    borderClass: 'border-gray-500',
    textClass: 'text-gray-600',
    glowClass: 'bg-gray-500'
  });

  useEffect(() => {
    const expirationDate = new Date('2026-05-05T00:00:00');
    const currentDate = new Date(); 
    currentDate.setHours(0, 0, 0, 0);

    const timeDifference = expirationDate.getTime() - currentDate.getTime();
    const daysRemaining = Math.ceil(timeDifference / (1000 * 3600 * 24));

    if (daysRemaining > 30) {
      setStatus({
        text: 'Estado: Vigente',
        days: daysRemaining,
        bgClass: 'bg-green-50 text-green-700 border-green-200',
        borderClass: 'border-green-500',
        textClass: 'text-green-600',
        glowClass: 'bg-green-500'
      });
    } else if (daysRemaining > 0) {
      setStatus({
        text: 'Estado: Próximo a vencer',
        days: daysRemaining,
        bgClass: 'bg-yellow-50 text-yellow-700 border-yellow-200',
        borderClass: 'border-yellow-400',
        textClass: 'text-yellow-600',
        glowClass: 'bg-yellow-400'
      });
    } else {
      const expired = Math.abs(daysRemaining);
      setStatus({
        text: daysRemaining === 0 ? 'Expira hoy' : `Expirado (hace ${expired} días)`,
        days: daysRemaining === 0 ? '0' : `-${expired}`,
        bgClass: 'bg-red-50 text-[#921E30] border-red-200',
        borderClass: 'border-[#921E30]',
        textClass: 'text-[#921E30]',
        glowClass: 'bg-[#921E30]'
      });
    }
  }, []);

  return (
    <div className="passport-card">
      <div className="passport-card-bg"></div>
      <div className="passport-card-body">

        <div className="passport-card-info">
          <div className="passport-card-title">
            <IdCard className="passport-card-title-icon" />
            <h3>Pasaporte Marítimo</h3>
          </div>
          <div className="passport-card-dates">
            <p><span>Emisión:</span> <span className="value">05/05/2025</span></p>
            <p><span>Expiración:</span> <span className="value">05/05/2026</span></p>
          </div>
          <span className={`passport-status ${status.statusClass}`}>
            {status.text}
          </span>
        </div>

        <div className="passport-days-wrapper">
          <div className={`passport-days-glow ${status.daysClass}`}></div>
          <div className={`passport-days-circle ${status.daysClass}`}>
            <span className="passport-days-number">{status.days}</span>
            <span className="passport-days-label">Días<br/>Restantes</span>
          </div>
        </div>
      </div>
    </div>
  );
};
