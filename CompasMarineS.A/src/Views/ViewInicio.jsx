import { useState, useEffect } from 'react';
import { Search, User, Clock, PenTool } from 'lucide-react';
import { readControlDocSnapshot } from '../storage/controlDocOffline';
import { getApiUrl } from '../config/api';

const formatDate = (dateString) => {
  if (!dateString) return 'N/A';
  return new Date(dateString).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const getDaysRemaining = (dateString) => {
  if (!dateString) return null;
  const expirationDate = new Date(dateString);
  const currentDate = new Date();
  currentDate.setHours(0, 0, 0, 0);
  const diff = expirationDate.getTime() - currentDate.getTime();
  return Math.ceil(diff / (1000 * 3600 * 24));
};

const getCookie = (name) => {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name.replace(/([.*+?^${}()|[\]\\])/g, '\\$1')}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
};

export const ViewInicio = ({ setView }) => (
  <div className="flex flex-col flex-1 overflow-hidden animate-fade-in">
    <div className="bg-[#394049] p-6 flex items-center gap-4 relative overflow-hidden flex-shrink-0">
      <div className="absolute -right-10 -top-10 w-40 h-40 bg-white opacity-5 rounded-full blur-2xl"></div>
      <div className="w-16 h-16 rounded-full bg-white border-2 border-[#921E30] flex-shrink-0 flex items-center justify-center shadow-lg relative z-10 overflow-hidden">
        <User className="w-8 h-8 text-gray-300 mt-2" />
      </div>
      <div className="relative z-10">
        <p className="text-[#921E30] text-xs font-bold tracking-wider mb-1 uppercase">Bienvenido</p>
        <h2 className="text-white text-2xl font-semibold tracking-wide">Juan Pérez</h2>
      </div>
    </div>

    <main className="flex-1 overflow-y-auto scrollable-content pb-24 bg-gray-50">
      <div className="p-6 pb-2">
        <div className="relative bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden focus-within:ring-2 focus-within:ring-[#921E30] transition-all">
          <Search className="w-5 h-5 absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="Buscar documentos, cursos..." className="w-full bg-transparent py-4 pl-12 pr-4 focus:outline-none text-sm" />
        </div>
      </div>

      <div className="px-6 pt-4 pb-2 flex justify-between items-end">
        <h3 className="font-bold text-[#394049] text-lg border-b-2 border-[#921E30] pb-1">Mis Documentos</h3>
        <button onClick={() => setView('documentos')} className="text-xs font-semibold text-[#921E30]">Ver todos</button>
      </div>
      <div className="px-6 mb-4 mt-3">
        <PassportCard />
      </div>

      <div className="px-6 pt-2">
        <div className="flex justify-between items-end mb-4">
          <h3 className="font-bold text-[#394049] text-lg border-b-2 border-[#921E30] pb-1">Mis Capacitaciones</h3>
          <button onClick={() => setView('capacitaciones')} className="text-xs font-semibold text-[#921E30]">Ver todas</button>
        </div>
      </div>
    </main>
  </div>
);
