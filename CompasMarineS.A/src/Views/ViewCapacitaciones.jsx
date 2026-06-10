import { useState } from 'react';
import { GraduationCap, Play, ShieldCheck, Flame, Anchor, LifeBuoy, Hammer, MapPin, Truck, Activity, FireExtinguisher } from 'lucide-react';

const capacitaciones = [
  { id: 'autocuidado', title: 'Autocuidado', description: 'Seguridad y bienestar personal en faenas.', icon: ShieldCheck },
  { id: 'higiene-manipulacion', title: 'Higiene y manipulación', description: 'Buenas prácticas para manipulación segura.', icon: Hammer },
  { id: 'oxicorte', title: 'Oxicorte', description: 'Operación segura durante trabajos con oxicorte.', icon: Flame },
  { id: 'manejo-manual-carga', title: 'Manejo Manual de carga', description: 'Técnicas para levantar y mover cargas sin riesgos.', icon: Activity },
  { id: 'navegacion-segura', title: 'Navegación Segura', description: 'Protocolos de seguridad para navegar con tranquilidad.', icon: Anchor },
  { id: 'uso-extintores', title: 'Uso de extintores', description: 'Manejo correcto de extintores en emergencias.', icon: FireExtinguisher },
  { id: 'uso-winches-izaje', title: 'Uso de winches e izaje', description: 'Operación segura de equipos de izaje y winches.', icon: Hammer },
  { id: 'uso-cuidado-epp', title: 'Uso y cuidado EPP', description: 'Uso correcto y mantenimiento del EPP.', icon: ShieldCheck },
  { id: 'uso-epp-buceo', title: 'Uso EPP buceo', description: 'Equipos de protección personal para buceo.', icon: LifeBuoy },
  { id: 'pts-fondeo-robot', title: 'PTS Fondeo de robot', description: 'Procedimientos de fondeo para robots submarinos.', icon: MapPin },
  { id: 'supervision-faenas', title: 'Supervisión en Faenas', description: 'Revisión de seguridad y coordinación en faenas.', icon: Activity },
  { id: 'primeros-auxilios', title: 'Primeros Auxilios', description: 'Respuesta inmediata ante accidentes y emergencias.', icon: LifeBuoy },
  { id: 'uso-bote-auxiliar', title: 'Uso de bote Auxiliar', description: 'Operación segura de botes auxiliares.', icon: Anchor },
  { id: 'uso-grua-hidraulica', title: 'Uso de Grua Hidráulica', description: 'Control y seguridad en grúas hidráulicas.', icon: Truck },
  { id: 'uso-art-hpt-croquis', title: 'Uso de ART,HPT y Croquis', description: 'Aplicación segura de ART, HPT y croquis.', icon: MapPin },
  { id: 'induccion-mow', title: 'Inducción MOW', description: 'Introducción a normas y procedimientos MOW.', icon: ShieldCheck }
];

export const ViewCapacitaciones = () => {
  const [selectedCapacitacion, setSelectedCapacitacion] = useState('all');

  const filteredCapacitaciones = selectedCapacitacion === 'all'
    ? capacitaciones
    : capacitaciones.filter(item => item.id === selectedCapacitacion);

  return (
    <div className="flex flex-col flex-1 overflow-hidden animate-fade-in">
      <div className="bg-[#394049] p-5 flex items-center justify-between flex-shrink-0">
        <h2 className="text-white text-xl font-semibold flex items-center">
          <GraduationCap className="w-6 h-6 mr-2" /> Capacitaciones
        </h2>
      </div>

      <main className="flex-1 overflow-y-auto scrollable-content pb-24 bg-gray-50 p-6">
        <div className="bg-white rounded-xl p-4 mb-4 border border-gray-200 shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-2 uppercase">Filtrar por capacitación</label>
              <select
                value={selectedCapacitacion}
                onChange={(e) => setSelectedCapacitacion(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#921E30] bg-white truncate"
              >
                <option value="all">Todas las capacitaciones</option>
                {capacitaciones.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end text-right text-xs text-gray-600">
              <div>
                <p className="font-semibold text-gray-800">{filteredCapacitaciones.length} de {capacitaciones.length}</p>
                <p>Capacitaciones visibles según el filtro seleccionado.</p>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {filteredCapacitaciones.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.id} className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 relative overflow-hidden">
                <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#921E30]"></div>
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 mt-1 p-2 rounded-full bg-[#f7fafc] border border-gray-200 text-[#394049]">
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-bold text-[#394049] text-base mb-1.5">{item.title}</h4>
                    <p className="text-xs text-gray-500 mb-3">{item.description}</p>
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-semibold text-gray-500 bg-gray-100 px-2 py-1 rounded">No iniciado</span>
                      <button className="bg-[#394049] text-white text-[10px] px-3 py-1 rounded-full flex items-center hover:bg-[#2f343d] transition">
                        <Play className="w-3 h-3 mr-1" /> Ver
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
};
