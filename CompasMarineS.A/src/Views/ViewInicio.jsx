import { useState, useEffect } from 'react';
import { Search, User, Clock, GraduationCap, ShieldCheck, Anchor, PenTool } from 'lucide-react';
import { PassportCard } from '../Components/PassportCard';
import { readControlDocSnapshot } from '../storage/controlDocOffline';
import { getApiUrl } from '../config/api';

const capacitaciones = [
  { id: 'autocuidado', title: 'Autocuidado', description: 'Seguridad y bienestar personal en faenas.', icon: ShieldCheck },
  { id: 'higiene-manipulacion', title: 'Higiene y manipulación', description: 'Buenas prácticas para manipulación segura.', icon: ShieldCheck },
  { id: 'oxicorte', title: 'Oxicorte', description: 'Operación segura durante trabajos con oxicorte.', icon: GraduationCap },
  { id: 'manejo-manual-carga', title: 'Manejo Manual de carga', description: 'Técnicas para levantar y mover cargas sin riesgos.', icon: Anchor },
  { id: 'navegacion-segura', title: 'Navegación Segura', description: 'Protocolos de seguridad para navegar con tranquilidad.', icon: Anchor }
];

const normalizeText = (text) =>
  String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

const isTrainingType = (typeName) => {
  const normalized = normalizeText(typeName);
  const trainingKeywords = [
    'autocuidado', 'higiene y manipulacion', 'oxicorte', 'manejo manual de carga',
    'navegacion segura', 'uso de extintores', 'uso de winches', 'uso y cuidado epp',
    'uso epp buceo', 'pts fondeo de robot', 'supervision en faenas', 'primeros auxilios',
    'uso de bote auxiliar', 'uso de grua hidraulica', 'uso de art', 'induccion mow'
  ];
  return trainingKeywords.some((keyword) => normalized.includes(keyword));
};

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

export const ViewInicio = ({ setView }) => {
  const [expiringDocs, setExpiringDocs] = useState([]);
  const [currentEntityName, setCurrentEntityName] = useState('');
  const [userTrainings, setUserTrainings] = useState([]);
  const [docPercentage, setDocPercentage] = useState(100);
  const [isSyncing, setIsSyncing] = useState(false);

  const displayName = currentEntityName || 'Usuario';

  useEffect(() => {
    const currentEntityId = getCookie('compas_user_id');

    // Función unificada para procesar y dibujar los datos en pantalla
    const processData = (allDocs, allTypes, allEntities) => {
      if (currentEntityId && allEntities) {
        const entity = allEntities.find((e) => e.id?.toString() === currentEntityId.toString());
        if (entity) setCurrentEntityName(entity.full_name || entity.name || entity.email);
      }

      // 1. Filtrar solo los documentos del usuario logueado
      const userDocs = currentEntityId 
        ? allDocs.filter((doc) => doc.entity_id?.toString() === currentEntityId.toString())
        : allDocs;

      // 2. Extraer y ordenar los documentos por vencer (Prioridad: Vencidos -> Por vencer)
      const alerts = userDocs
        .map(doc => ({ ...doc, daysRemaining: getDaysRemaining(doc.expires_at) }))
        .filter(doc => doc.daysRemaining !== null && doc.daysRemaining <= 60) // Trae vencidos (<0) y hasta 60 días
        .sort((a, b) => a.daysRemaining - b.daysRemaining) // Los más vencidos (números negativos) quedan de primeros
        .slice(0, 5); // Tomamos exactamente 5 como solicitaste

      setExpiringDocs(alerts);

      // Calcular porcentaje general del usuario (Documentos vigentes vs Total)
      if (userDocs.length > 0) {
        const healthyDocs = userDocs.filter(d => {
           const days = getDaysRemaining(d.expires_at);
           return days === null || days > 30;
        }).length;
        setDocPercentage(Math.round((healthyDocs / userDocs.length) * 100));
      }

      // 3. Procesar Capacitaciones
      if (allTypes.length > 0) {
        const trainingTypeIds = allTypes
          .filter((type) => isTrainingType(type.name || type.label || type.description || type.id))
          .map((type) => type.id?.toString());

        const trainingDocs = userDocs.filter((doc) => trainingTypeIds.includes(doc.document_type_id?.toString()));

        const trainings = trainingDocs.map((doc) => {
          const type = allTypes.find((t) => t.id?.toString() === doc.document_type_id?.toString());
          const trainingTypeName = type?.name || type?.label || '';
          const matchedCapacitacion = capacitaciones.find(
            (item) => normalizeText(item.title) === normalizeText(trainingTypeName)
          );

          return {
            id: doc.id,
            title: doc.label || trainingTypeName || 'Capacitación',
            description: type?.name || type?.label || 'Capacitación registrada',
            icon: matchedCapacitacion?.icon || ShieldCheck,
            daysRemaining: getDaysRemaining(doc.expires_at),
            expires_at: doc.expires_at
          };
        });

        setUserTrainings(trainings.slice(0, 5));
      }
    };

    // FASE A: Cargar instantáneamente desde caché (si existe)
    const snapshot = readControlDocSnapshot();
    if (snapshot?.data) {
      processData(snapshot.data.documents || [], snapshot.data.documentTypes || [], snapshot.data.entities || []);
    }

    // FASE B: Fetch silencioso en segundo plano para datos 100% reales
    const fetchFreshData = async () => {
      setIsSyncing(true);
      try {
        const [docsRes, typesRes, entitiesRes] = await Promise.all([
          fetch(getApiUrl('/controldoc/documents/sync')),
          fetch(getApiUrl('/controldoc/document-types?page=1&per_page=100')),
          fetch(getApiUrl('/controldoc/entities?page=1&per_page=100'))
        ]);

        if (docsRes.ok && typesRes.ok) {
          const freshDocs = await docsRes.json();
          const rawTypes = await typesRes.json();
          const rawEntities = await entitiesRes.json();
          
          const freshTypes = Array.isArray(rawTypes) ? rawTypes : (Object.keys(rawTypes).find(k => Array.isArray(rawTypes[k])) ? rawTypes[Object.keys(rawTypes).find(k => Array.isArray(rawTypes[k]))] : []);
          const freshEntities = Array.isArray(rawEntities) ? rawEntities : (Object.keys(rawEntities).find(k => Array.isArray(rawEntities[k])) ? rawEntities[Object.keys(rawEntities).find(k => Array.isArray(rawEntities[k]))] : []);

          processData(freshDocs, freshTypes, freshEntities);
        }
      } catch (error) {
        console.error("Error sincronizando inicio:", error);
      } finally {
        setIsSyncing(false);
      }
    };

    fetchFreshData();
  }, []);

  return (
    <div className="flex flex-col flex-1 overflow-hidden animate-fade-in">
      {/* HEADER */}
      <div className="bg-[#394049] p-6 flex items-center gap-4 relative overflow-hidden flex-shrink-0">
        <div className="absolute -right-10 -top-10 w-40 h-40 bg-white opacity-5 rounded-full blur-2xl"></div>
        <div className="w-16 h-16 rounded-full bg-white border-2 border-[#921E30] flex-shrink-0 flex items-center justify-center shadow-lg relative z-10 overflow-hidden">
          <User className="w-8 h-8 text-gray-300 mt-2" />
        </div>
        <div className="relative z-10 flex-1">
          <p className="text-white text-xs font-bold tracking-wider mb-1 uppercase">Bienvenido</p>
          <h2 className="text-white text-2xl font-semibold tracking-wide">{displayName}</h2>
        </div>
        
        <div className="relative z-10 flex flex-col items-center justify-center ml-auto">
          <div className="w-12 h-12 rounded-full border-4 flex items-center justify-center shadow-md bg-[#2A3037]" 
               style={{ borderColor: docPercentage >= 80 ? '#22c55e' : docPercentage >= 50 ? '#B8860B' : '#FF0000' }}>
            <span className="text-white text-sm font-bold">{docPercentage}%</span>
          </div>
          <span className="text-white text-[9px] mt-1 uppercase font-bold tracking-wider">Al día</span>
        </div>
      </div>

      <main className="flex-1 overflow-y-auto scrollable-content pb-24 bg-gray-50">
        
        {/* BUSCADOR */}
        <div className="p-6 pb-2">
          <div className="relative bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden focus-within:ring-2 focus-within:ring-[#921E30] transition-all">
            <Search className="w-5 h-5 absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400" />
            <input type="text" placeholder="Buscar documentos, cursos..." className="w-full bg-transparent py-4 pl-12 pr-4 focus:outline-none text-sm" />
          </div>
        </div>

        {/* 1. FIRMAS PENDIENTES */}
        <div className="px-6 pt-4 pb-2 flex justify-between items-end">
          <h3 className="font-bold text-[#394049] text-lg border-b-2 border-[#921E30] pb-1">Mis Firmas Pendientes</h3>
          <button onClick={() => setView('firmas')} className="text-xs font-semibold text-[#921E30]">Ver todas</button>
        </div>
        <div className="px-6 mb-4 mt-2">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
            <div className="flex justify-between items-center bg-red-50 p-3 rounded-lg border border-red-100 mb-2">
              <div className="flex items-center gap-3">
                <PenTool className="w-5 h-5 text-[#921E30]" />
                <div>
                  <p className="text-sm font-semibold text-[#394049]">Anexo de Contrato</p>
                  <p className="text-[11px] text-gray-500">Requiere firma digital vía CDOC</p>
                </div>
              </div>
              <button className="bg-[#921E30] text-white text-xs px-3 py-1.5 rounded-md font-semibold shadow-sm hover:bg-red-800 transition-colors">
                Firmar
              </button>
            </div>
          </div>
        </div>

        {/* 2. ALERTAS (5 DOCUMENTOS DEL FETCH) */}
        <div className="px-6 mb-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-xs uppercase font-semibold text-[#921E30]">Alertas</p>
                <h4 className="text-base font-bold text-[#394049]">Documentos por Vencer</h4>
              </div>
              <div className="inline-flex items-center gap-2 text-xs text-gray-500">
                {isSyncing ? (
                   <span className="flex items-center text-blue-500 animate-pulse"><Clock className="w-3 h-3 mr-1" /> Actualizando...</span>
                ) : (
                   <><Clock className="w-4 h-4" /> Alertas activas</>
                )}
              </div>
            </div>

            {expiringDocs.length > 0 ? (
              <div className="space-y-3">
                {expiringDocs.map((doc) => {
                  const isExpired = doc.daysRemaining < 0;
                  const isCritical = doc.daysRemaining >= 0 && doc.daysRemaining <= 30;
                  const isWarning = doc.daysRemaining > 30 && doc.daysRemaining <= 60;
                  
                  let colorClass = '';
                  let textColor = '';
                  let statusText = '';

                  if (isExpired || isCritical) {
                    colorClass = 'bg-[#FF0000]/10 border-[#FF0000]';
                    textColor = 'text-[#FF0000]';
                    statusText = isExpired ? `Expirado hace ${Math.abs(doc.daysRemaining)} días` : `Expira en ${doc.daysRemaining} días`;
                  } else if (isWarning) {
                    colorClass = 'bg-[#B8860B]/10 border-[#B8860B]';
                    textColor = 'text-[#B8860B]';
                    statusText = `Expira en ${doc.daysRemaining} días`;
                  }

                  return (
                    <div key={doc.id} className="rounded-2xl border border-gray-200 p-3 bg-white shadow-sm hover:shadow transition">
                      <div className="flex justify-between items-start gap-3">
                        <div className="flex-1 overflow-hidden">
                          <p className="text-sm font-semibold text-[#394049] truncate">{doc.label || 'Documento sin nombre'}</p>
                          <p className="text-[11px] text-gray-500">Expira {formatDate(doc.expires_at)}</p>
                        </div>
                        <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border flex-shrink-0 ${colorClass} ${textColor}`}>
                          {statusText}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-gray-200 p-4 text-center text-xs text-gray-500">
                {isSyncing ? 'Buscando documentos...' : 'No tienes documentos próximos a expirar.'}
              </div>
            )}
          </div>
        </div>

        {/* 3. MIS DOCUMENTOS (PASSPORT CARD) */}
        <div className="px-6 pt-2 flex justify-between items-end">
          <h3 className="font-bold text-[#394049] text-lg border-b-2 border-[#921E30] pb-1">Mis Documentos</h3>
          <button onClick={() => setView('documentos')} className="text-xs font-semibold text-[#921E30]">Ver todos</button>
        </div>
        <div className="px-6 mb-6 mt-3">
          <PassportCard />
        </div>

        {/* 4. MIS CAPACITACIONES */}
        <div className="px-6 pt-2">
          <div className="flex justify-between items-end mb-4">
            <h3 className="font-bold text-[#394049] text-lg border-b-2 border-[#921E30] pb-1">Mis Capacitaciones</h3>
            <button onClick={() => setView('capacitaciones')} className="text-xs font-semibold text-[#921E30]">Ver todas</button>
          </div>

          <div className="grid grid-cols-1 gap-4 mb-6">
            {(userTrainings.length > 0 ? userTrainings : capacitaciones.slice(0,3)).map((item) => {
              const Icon = item.icon || ShieldCheck;
              return (
                <div key={item.id} className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-[#f7fafc] border border-gray-200 flex items-center justify-center text-[#394049]">
                      <Icon className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-[#394049]">{item.title}</p>
                      <p className="text-[11px] text-gray-500">{item.description}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </main>
    </div>
  );
};