import React from 'react';
import { FileText, User as UserIcon, Tag, Download, AlertCircle } from 'lucide-react';

export const ApiDocumentCard = ({ doc, entities = [], documentTypes = [], entityById, documentTypeById }) => {
  const entity = entityById ? entityById.get(doc.entity_id?.toString()) : entities.find(e => e.id?.toString() === doc.entity_id?.toString());
  const docType = documentTypeById ? documentTypeById.get(doc.document_type_id?.toString()) : documentTypes.find(t => t.id?.toString() === doc.document_type_id?.toString());
  
  const entityName = entity?.full_name || entity?.name || entity?.label || entity?.email || doc.entity_id || 'Sin Nombre';
  const typeName = docType?.name || docType?.label || docType?.id || doc.document_type_id || 'Documento';

  let status = { label: 'Sin Fecha', bgClass: 'bg-gray-100 text-gray-600 border-gray-200' };

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
      const blockedDays = daysRemaining > 0 ? daysRemaining : 0;
      status = { label: `Bloqueado (${blockedDays} días restantes)`, bgClass: 'bg-red-50 text-[#921E30] border-red-200' };
    } else if (daysRemaining > 30) {
      status = { label: `Vigente por ${daysRemaining} días`, bgClass: 'bg-green-50 text-green-700 border-green-200' };
    } else if (daysRemaining > 0) {
      status = { label: `Próximo a vencer (${daysRemaining} días)`, bgClass: 'bg-yellow-50 text-yellow-700 border-yellow-200' };
    } else if (daysRemaining === 0) {
      status = { label: 'Expira hoy', bgClass: 'bg-red-50 text-[#921E30] border-red-200' };
    } else {
      const expired = Math.abs(daysRemaining);
      status = { label: `Expirado hace ${expired} días`, bgClass: 'bg-red-50 text-[#921E30] border-red-200' };
    }
  }

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  return (
    <div className="bg-white rounded-2xl p-5 relative overflow-hidden shadow-sm border border-gray-100 hover:-translate-y-0.5 hover:shadow-md transition-all duration-200 mb-4">
      <div className="absolute top-0 right-0 w-32 h-32 bg-gray-50 rounded-bl-full z-0"></div>
      
      <div className="relative z-10">
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
          <p className={`text-xs font-extrabold inline-block px-4 py-2 rounded-full border ${status.bgClass}`}>
            {status.label}
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
    </div>
  );
};

export default ApiDocumentCard;