import React from 'react';
import { FileText, User as UserIcon, Tag, Download, AlertCircle } from 'lucide-react';

export const ApiDocumentCard = ({ doc, entities = [], documentTypes = [], entityById, documentTypeById }) => {
  const entity = entityById ? entityById.get(doc.entity_id?.toString()) : entities.find(e => e.id?.toString() === doc.entity_id?.toString());
  const docType = documentTypeById ? documentTypeById.get(doc.document_type_id?.toString()) : documentTypes.find(t => t.id?.toString() === doc.document_type_id?.toString());
  
  const entityName = entity?.full_name || entity?.name || entity?.label || entity?.email || doc.entity_id || 'Sin Nombre';
  const typeName = docType?.name || docType?.label || docType?.id || doc.document_type_id || 'Documento';

  let status = { text: 'Sin Fecha', days: '--', bgClass: 'bg-gray-100 text-gray-600', borderClass: 'border-gray-500', textClass: 'text-gray-600', glowClass: 'bg-gray-500' };
  
  let isBlocked = doc.aasm_state === 'blocked';

  if (isBlocked && doc.blocked_description?.toLowerCase().includes('cargo')) {
    isBlocked = false;
  }

  if (doc.expires_at) {
    const expirationDate = new Date(doc.expires_at);
    const currentDate = new Date(); 
    currentDate.setHours(0, 0, 0, 0);

    const timeDifference = expirationDate.getTime() - currentDate.getTime();
    const daysRemaining = Math.ceil(timeDifference / (1000 * 3600 * 24));

    if (isBlocked) {
       status = { text: 'Bloqueado', days: daysRemaining > 0 ? daysRemaining : '0', bgClass: 'bg-red-50 text-[#921E30] border-red-200', borderClass: 'border-[#921E30]', textClass: 'text-[#921E30]', glowClass: 'bg-[#921E30]' };
    } else if (daysRemaining > 30) {
      status = { text: 'Vigente', days: daysRemaining, bgClass: 'bg-green-50 text-green-700 border-green-200', borderClass: 'border-green-500', textClass: 'text-green-600', glowClass: 'bg-green-500' };
    } else if (daysRemaining > 0) {
      status = { text: 'Próximo a vencer', days: daysRemaining, bgClass: 'bg-yellow-50 text-yellow-700 border-yellow-200', borderClass: 'border-yellow-400', textClass: 'text-yellow-600', glowClass: 'bg-yellow-400' };
    } else {
      const expired = Math.abs(daysRemaining);
      status = { text: daysRemaining === 0 ? 'Expira hoy' : `Expirado`, days: daysRemaining === 0 ? '0' : `-${expired}`, bgClass: 'bg-red-50 text-[#921E30] border-red-200', borderClass: 'border-[#921E30]', textClass: 'text-[#921E30]', glowClass: 'bg-[#921E30]' };
    }
  }

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  return (
    <div className="bg-white rounded-2xl p-5 relative overflow-hidden shadow-sm border border-gray-100 hover:-translate-y-0.5 hover:shadow-md transition-all duration-200 mb-4">
      <div className="absolute top-0 right-0 w-32 h-32 bg-gray-50 rounded-bl-full z-0"></div>
      
      <div className="flex justify-between items-start relative z-10">
        <div className="flex-1 pr-4">
          <div className="flex items-center gap-2 mb-2">
            <FileText className="w-5 h-5 text-[#394049] flex-shrink-0" />
            <h3 className="font-bold text-[#394049] text-sm leading-tight uppercase">{doc.label || 'Documento'}</h3>
          </div>
          
          <div className="space-y-1.5 mb-3 bg-gray-50 p-2 rounded-lg border border-gray-100">
            <p className="text-xs text-gray-600 flex items-center">
              <UserIcon className="w-3 h-3 mr-1.5 text-gray-400" />
              <span className="font-semibold text-gray-800 truncate">{entityName}</span>
            </p>
            <p className="text-xs text-gray-600 flex items-center">
              <Tag className="w-3 h-3 mr-1.5 text-gray-400" />
              <span className="truncate">{typeName}</span>
            </p>
          </div>
          
          <div className="space-y-1 mb-3 text-xs">
            <p className="text-gray-500 flex justify-between pr-4">
              <span>Emisión:</span> <span className="font-medium text-gray-700">{formatDate(doc.created_at)}</span>
            </p>
            <p className="text-gray-500 flex justify-between pr-4">
              <span>Expiración:</span> <span className="font-medium text-gray-700">{formatDate(doc.expires_at)}</span>
            </p>
          </div>

          <div className="flex gap-2 items-center flex-wrap">
            <p className={`text-[10px] font-bold inline-block px-2 py-1 rounded border ${status.bgClass} uppercase`}>
              {status.text}
            </p>
            {doc.download_base64_url && (
              <a href={doc.download_base64_url} target="_blank" rel="noreferrer" className="text-[10px] font-bold bg-[#394049] text-white px-2 py-1 rounded flex items-center hover:bg-gray-700 transition">
                <Download className="w-3 h-3 mr-1" /> Ver/Bajar
              </a>
            )}
          </div>

          {isBlocked && doc.blocked_description && (
            <div className="mt-3 bg-red-50 border border-red-200 p-2 rounded flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-[10px] text-red-700 font-medium leading-tight">{doc.blocked_description}</p>
            </div>
          )}
        </div>

        <div className="relative flex-shrink-0 mt-1">
          <div className={`absolute inset-0 rounded-full blur-md opacity-20 ${status.glowClass}`}></div>
          <div className={`w-16 h-16 rounded-full border-4 bg-white flex flex-col items-center justify-center text-center p-1 relative z-10 shadow-inner ${status.borderClass}`}>
            <span className={`font-black text-xl leading-none tracking-tight ${status.textClass}`}>{status.days}</span>
            <span className="text-[7px] font-semibold uppercase tracking-wider text-gray-500 mt-1 leading-tight text-center">Días<br/>Restantes</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ApiDocumentCard;