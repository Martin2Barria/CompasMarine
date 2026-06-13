import { useState, useEffect, useMemo } from 'react';
import { GraduationCap, Play, ShieldCheck, Flame, Anchor, LifeBuoy, Hammer, MapPin, Truck, Activity, FireExtinguisher, Loader2, AlertCircle, CheckCircle, Clock } from 'lucide-react';
import { getApiUrl } from '../config/api';
import { readControlDocSnapshot, saveControlDocSnapshot } from '../storage/controlDocOffline';

const urls = {
  documents: getApiUrl('/controldoc/documents'),
  entities: getApiUrl('/controldoc/entities'),
  documentTypes: getApiUrl('/controldoc/document-types')
};

// 1. EL CATÁLOGO OFICIAL (Esto sí va afuera porque nunca cambia)
const baseCapacitaciones = [
  { id: 'autocuidado', title: 'Autocuidado', keyword: 'autocuidado', description: 'Seguridad y bienestar personal en faenas.', icon: ShieldCheck },
  { id: 'higiene-manipulacion', title: 'Higiene y manipulación', keyword: 'higiene y manipulacion', description: 'Buenas prácticas para manipulación segura.', icon: Hammer },
  { id: 'oxicorte', title: 'Oxicorte', keyword: 'oxicorte', description: 'Operación segura durante trabajos con oxicorte.', icon: Flame },
  { id: 'manejo-manual-carga', title: 'Manejo Manual de carga', keyword: 'manejo manual de carga', description: 'Técnicas para levantar y mover cargas sin riesgos.', icon: Activity },
  { id: 'navegacion-segura', title: 'Navegación Segura', keyword: 'navegacion segura', description: 'Protocolos de seguridad para navegar con tranquilidad.', icon: Anchor },
  { id: 'uso-extintores', title: 'Uso de extintores', keyword: 'uso de extintores', description: 'Manejo correcto de extintores en emergencias.', icon: FireExtinguisher },
  { id: 'uso-winches-izaje', title: 'Uso de winches e izaje', keyword: 'uso de winche', description: 'Operación segura de equipos de izaje y winches.', icon: Hammer },
  { id: 'uso-cuidado-epp', title: 'Uso y cuidado EPP', keyword: 'uso y cuidado epp', description: 'Uso correcto y mantenimiento del EPP.', icon: ShieldCheck },
  { id: 'uso-epp-buceo', title: 'Uso EPP buceo', keyword: 'uso epp buceo', description: 'Equipos de protección personal para buceo.', icon: LifeBuoy },
  { id: 'pts-fondeo-robot', title: 'PTS Fondeo de robot', keyword: 'pts fondeo', description: 'Procedimientos de fondeo para robots submarinos.', icon: MapPin },
  { id: 'supervision-faenas', title: 'Supervisión en Faenas', keyword: 'supervision en faenas', description: 'Revisión de seguridad y coordinación en faenas.', icon: Activity },
  { id: 'primeros-auxilios', title: 'Primeros Auxilios', keyword: 'primeros auxilios', description: 'Respuesta inmediata ante accidentes y emergencias.', icon: LifeBuoy },
  { id: 'uso-bote-auxiliar', title: 'Uso de bote Auxiliar', keyword: 'uso de bote auxiliar', description: 'Operación segura de botes auxiliares.', icon: Anchor },
  { id: 'uso-grua-hidraulica', title: 'Uso de Grua Hidráulica', keyword: 'uso de grua hidraulica', description: 'Control y seguridad en grúas hidráulicas.', icon: Truck },
  { id: 'uso-art-hpt-croquis', title: 'Uso de ART,HPT y Croquis', keyword: 'uso de art', description: 'Aplicación segura de ART, HPT y croquis.', icon: MapPin },
  { id: 'induccion-mow', title: 'Inducción MOW', keyword: 'induccion mow', description: 'Introducción a normas y procedimientos MOW.', icon: ShieldCheck }
];

export const ViewCapacitaciones = () => {
  // 2. LOS ESTADOS (Variables internas del componente)
  const [apiData, setApiData] = useState({ documents: [], entities: [], documentTypes: [] });
  const [isLoading, setIsLoading] = useState(false);
  const [progressInfo, setProgressInfo] = useState('');
  
  const [selectedEntityId, setSelectedEntityId] = useState('all');
  const [selectedCapacitacion, setSelectedCapacitacion] = useState('all');

  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  // 3. LA LÓGICA DE CARGA (Fetch)
  useEffect(() => {
    const fetchAllData = async () => {
      setIsLoading(true);
      
      const showCached = () => {
        const snap = readControlDocSnapshot();
        if (snap) setApiData(snap.data);
      };

      const requestOptions = { method: 'GET', credentials: 'same-origin', redirect: 'follow' };
      let hadFetchError = false;

      const fetchAllPages = async (baseUrl, name) => {
        let allItems = [];
        let page = 1;
        let hasMore = true;
        
        while (hasMore && page <= 40) {
          try {
            setProgressInfo(`Cargando ${name}...`);
            const sep = baseUrl.includes('?') ? '&' : '?';
            const response = await fetch(`${baseUrl}${sep}page=${page}&per_page=100`, requestOptions);
            
            if (response.status === 429) { await delay(1000); continue; }
            if (!response.ok) throw new Error();
            
            const json = await response.json();
            let items = Array.isArray(json) ? json : (json[Object.keys(json).find(k => Array.isArray(json[k]))] || []);
            
            if (items.length === 0) hasMore = false;
            else {
              allItems = [...allItems, ...items];
              page++;
              if (items.length < 20) hasMore = false;
              await delay(200);
            }
          } catch (e) {
            hadFetchError = true; hasMore = false;
          }
        }
        return allItems;
      };

      try {
        const types = await fetchAllPages(urls.documentTypes, "Tipos");
        const entities = await fetchAllPages(urls.entities, "Usuarios");
        const docs = await fetchAllPages(urls.documents, "Documentos");
        
        const nextData = { documents: docs, entities: entities, documentTypes: types };
        if (hadFetchError && docs.length === 0 && showCached()) return;
        
        setApiData(nextData);
        if (!hadFetchError) saveControlDocSnapshot(nextData);
      } catch (err) {
        showCached();
      } finally {
        setIsLoading(false);
      }
    };

    fetchAllData();
  }, []);

  // 4. EL CRUCE DE DATOS (Adentro del componente, después de declarar apiData)
  const { relevantEntities, processedCapacitaciones, progressMetrics } = useMemo(() => {
    const entities = apiData.entities || [];
    let completedCount = 0;
    
    let processed = baseCapacitaciones.map(cap => {
      let matchedDoc = null;

      if (selectedEntityId !== 'all') {
        const userDocs = apiData.documents.filter(d => d.entity_id?.toString() === selectedEntityId);
        
        matchedDoc = userDocs.find(doc => {
          const type = apiData.documentTypes.find(t => t.id?.toString() === doc.document_type_id?.toString());
          const typeName = type ? (type.name || type.label || '') : '';
          const docLabel = doc.label || '';
          
          const combinedText = `${typeName} ${docLabel}`.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          
          // Debugging
          if (combinedText.includes(cap.keyword)) {
             console.log(`¡ENCONTRADO! Curso: ${cap.title} -> Match con: "${combinedText}"`);
          }

          return combinedText.includes(cap.keyword);
        });

        if (matchedDoc) completedCount++;
      }

      return { ...cap, doc: matchedDoc };
    });

    if (selectedCapacitacion !== 'all') {
      processed = processed.filter(c => c.id === selectedCapacitacion);
    }

    const percentage = Math.round((completedCount / baseCapacitaciones.length) * 100) || 0;

    return { 
      relevantEntities: entities, 
      processedCapacitaciones: processed,
      progressMetrics: { count: completedCount, total: baseCapacitaciones.length, percentage }
    };
  }, [apiData, selectedEntityId, selectedCapacitacion]);

  // 5. FUNCIONES AUXILIARES
  const getDocStatus = (doc) => {
    if (!doc) return { label: 'Sin subir', color: 'bg-gray-100 text-gray-500', icon: Clock };
    if (doc.aasm_state === 'blocked') return { label: 'Rechazado', color: 'bg-red-100 text-red-700', icon: AlertCircle };
    
    if (doc.expires_at) {
      const exp = new Date(doc.expires_at);
      const now = new Date(); now.setHours(0,0,0,0);
      const days = Math.ceil((exp - now) / (1000 * 3600 * 24));
      
      if (days < 0) return { label: 'Expirado', color: 'bg-red-100 text-red-700', icon: AlertCircle };
      if (days <= 30) return { label: `Vence en ${days}d`, color: 'bg-yellow-100 text-yellow-700', icon: Clock };
      return { label: 'Vigente', color: 'bg-green-100 text-green-700', icon: CheckCircle };
    }
    return { label: 'Completado', color: 'bg-blue-100 text-blue-700', icon: CheckCircle };
  };

  // 6. LA VISTA (El retorno de tu interfaz gráfica)
  return (
    <div className="flex flex-col flex-1 overflow-hidden animate-fade-in">
      <div className="bg-[#394049] p-5 flex items-center justify-between flex-shrink-0">
        <h2 className="text-white text-xl font-semibold flex items-center">
          <GraduationCap className="w-6 h-6 mr-2" /> Panel de Capacitaciones
        </h2>
      </div>

      <main className="flex-1 overflow-y-auto scrollable-content pb-24 bg-gray-50 p-6">
        
        {selectedEntityId !== 'all' && (
          <div className="mb-6 bg-white p-5 rounded-2xl border border-gray-200 shadow-sm">
            <div className="flex justify-between items-end mb-2">
              <div>
                <h3 className="text-sm font-bold text-[#394049] uppercase">Avance del Trabajador</h3>
                <p className="text-xs text-gray-500">Cursos completados del catálogo base</p>
              </div>
              <div className="text-right">
                <span className="text-2xl font-black text-[#921E30]">{progressMetrics.percentage}%</span>
                <p className="text-xs font-semibold text-gray-500">{progressMetrics.count} de {progressMetrics.total} cursos</p>
              </div>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-3 mt-3 overflow-hidden">
              <div 
                className="bg-[#921E30] h-3 rounded-full transition-all duration-1000 ease-out" 
                style={{ width: `${progressMetrics.percentage}%` }}
              ></div>
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl p-4 mb-6 border border-gray-200 shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1.5 uppercase">Trabajador</label>
              <select
                value={selectedEntityId}
                onChange={(e) => setSelectedEntityId(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#921E30] bg-white truncate font-medium"
              >
                <option value="all">-- Selecciona un trabajador para ver su avance --</option>
                {relevantEntities.map(entity => (
                  <option key={entity.id} value={entity.id?.toString()}>
                    {entity.full_name || entity.name || entity.email}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1.5 uppercase">Ver curso en específico</label>
              <select
                value={selectedCapacitacion}
                onChange={(e) => setSelectedCapacitacion(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#921E30] bg-white truncate font-medium"
              >
                <option value="all">Ver catálogo completo</option>
                {baseCapacitaciones.map(item => (
                  <option key={item.id} value={item.id}>{item.title}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {isLoading && (
          <div className="flex flex-col items-center justify-center py-10 text-gray-500">
            <Loader2 className="w-8 h-8 animate-spin text-[#921E30] mb-3" />
            <p className="text-sm font-medium">{progressInfo}</p>
          </div>
        )}

        {!isLoading && (
          <div className="space-y-4">
            {processedCapacitaciones.map((item) => {
              const Icon = item.icon;
              const status = getDocStatus(item.doc);
              const StatusIcon = status.icon;

              return (
                <div key={item.id} className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 relative overflow-hidden hover:shadow-md transition">
                  <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${item.doc ? 'bg-[#921E30]' : 'bg-gray-200'}`}></div>
                  
                  <div className="flex items-start gap-4 pl-2">
                    <div className={`flex-shrink-0 mt-1 p-3 rounded-full border ${item.doc ? 'bg-red-50 border-red-100 text-[#921E30]' : 'bg-gray-50 border-gray-200 text-gray-400'}`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    
                    <div className="flex-1">
                      <div className="flex justify-between items-start mb-1">
                        <h4 className="font-bold text-[#394049] text-base">{item.title}</h4>
                        
                        {selectedEntityId !== 'all' && (
                          <span className={`text-[10px] font-bold px-2 py-1 rounded flex items-center gap-1 ${status.color} uppercase tracking-wide`}>
                            <StatusIcon className="w-3 h-3" />
                            {status.label}
                          </span>
                        )}
                      </div>
                      
                      <p className="text-xs text-gray-500 mb-3">{item.description}</p>
                      
                      <div className="flex items-center gap-3">
                        {item.doc && item.doc.download_base64_url ? (
                          <a href={item.doc.download_base64_url} target="_blank" rel="noreferrer" className="bg-[#394049] text-white text-[10px] font-bold px-3 py-1.5 rounded-md flex items-center hover:bg-[#2f343d] transition">
                            <Play className="w-3 h-3 mr-1.5" /> Ver Certificado
                          </a>
                        ) : (
                          <button disabled className="bg-gray-100 text-gray-400 text-[10px] font-bold px-3 py-1.5 rounded-md flex items-center cursor-not-allowed">
                            Pendiente
                          </button>
                        )}

                        {item.doc?.expires_at && (
                          <span className="text-[10px] text-gray-500 font-medium">
                            Vence: {new Date(item.doc.expires_at).toLocaleDateString('es-ES')}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
};