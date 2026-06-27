import { FileText, User as UserIcon, Tag, Download, AlertCircle } from 'lucide-react';
import { getDocumentEntityId, getDocumentExpirationDate, hasExpiredDocumentStatus, isBlockedDocument, parseControlDocDate } from '../controldoc/fields';

export const ApiDocumentCard = ({ doc, entities = [], documentTypes = [], entityById, documentTypeById }) => {
  const docEntityId = getDocumentEntityId(doc);
  const entity = entityById ? entityById.get(docEntityId) : entities.find(e => e.id?.toString() === docEntityId);
  const docType = documentTypeById ? documentTypeById.get(doc.document_type_id?.toString()) : documentTypes.find(t => t.id?.toString() === doc.document_type_id?.toString());
  
  const entityName = entity?.full_name || entity?.name || entity?.label || entity?.email || docEntityId || 'Sin Nombre';
  const typeName = docType?.name || docType?.label || docType?.id || doc.document_type_id || 'Documento';

  // bgClass ahora incluye también el color y grosor del borde (border-2) para el efecto "pill"
  let status = { label: 'Sin Fecha', bgClass: 'bg-gray-100 text-gray-600 border-2 border-gray-200' };
  const expirationDateValue = getDocumentExpirationDate(doc);

  const isBlocked = isBlockedDocument(doc);
  const hasExpiredStatus = hasExpiredDocumentStatus(doc);

  if (expirationDateValue) {
    const expirationDate = parseControlDocDate(expirationDateValue);
    const currentDate = new Date(); 
    currentDate.setHours(0, 0, 0, 0);

    const timeDifference = expirationDate ? expirationDate.getTime() - currentDate.getTime() : null;
    const daysRemaining = timeDifference === null ? null : Math.ceil(timeDifference / (1000 * 3600 * 24));

    if (daysRemaining === null) {
      status = { label: 'Sin Fecha', bgClass: 'bg-gray-100 text-gray-600 border-2 border-gray-200' };
    } else if (isBlocked) {
      const blockedDays = daysRemaining > 0 ? daysRemaining : 0;
      status = { label: `Bloqueado (${blockedDays} días)`, bgClass: 'bg-red-50 text-[#921E30] border-2 border-red-200' };
    } else if (daysRemaining > 30) {
      status = { label: `Vigente por ${daysRemaining} días`, bgClass: 'bg-green-50 text-green-700 border-2 border-green-200' };
    } else if (daysRemaining > 0) {
      status = { label: `Próximo a vencer (${daysRemaining} días)`, bgClass: 'bg-yellow-50 text-yellow-700 border-2 border-yellow-200' };
    } else if (daysRemaining === 0) {
      status = { label: 'Expira hoy', bgClass: 'bg-red-50 text-[#921E30] border-2 border-red-200' };
    } else {
      const expired = Math.abs(daysRemaining);
      status = { label: `Expirado hace ${expired} días`, bgClass: 'bg-red-50 text-[#921E30] border-2 border-red-200' };
    }
  }

  if (!expirationDateValue && hasExpiredStatus) {
    status = { label: 'Vencido', bgClass: 'bg-red-50 text-[#921E30] border-2 border-red-200' };
  }

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    const parsedDate = parseControlDocDate(dateString);
    return parsedDate
      ? parsedDate.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : 'N/A';
  };

  return (
    <div className="bg-white rounded-2xl p-4 md:p-5 relative overflow-hidden shadow-sm border border-gray-100 hover:-translate-y-0.5 hover:shadow-md transition-all duration-200 mb-3 w-full">
      {/* Fondo decorativo responsivo */}
      <div className="absolute top-0 right-0 w-20 h-20 md:w-32 md:h-32 bg-gray-50 rounded-bl-full z-0 pointer-events-none"></div>
      
      <div className="relative z-10 w-full">
        {/* Título */}
        <div className="flex items-center gap-2 mb-2.5 pr-12">
          <FileText className="w-4 h-4 md:w-5 h-5 text-[#394049] flex-shrink-0" />
          <h3 className="font-bold text-[#394049] text-xs md:text-sm leading-tight uppercase truncate">
            {doc.label || 'Documento'}
          </h3>
        </div>

        {/* Metadatos principales */}
        <div className="space-y-1.5 mb-3 bg-gray-50/70 p-2.5 rounded-xl border border-gray-100/70">
          <div className="text-xs text-gray-600 flex items-center min-w-0">
            <UserIcon className="w-3.5 h-3.5 mr-2 text-gray-400 flex-shrink-0" />
            <span className="font-semibold text-gray-800 truncate max-w-[200px] xs:max-w-[280px] sm:max-w-none">
              {entityName}
            </span>
          </div>
          <div className="text-xs text-gray-600 flex items-center min-w-0">
            <Tag className="w-3.5 h-3.5 mr-2 text-gray-400 flex-shrink-0" />
            <span className="truncate text-gray-500 font-medium max-w-[200px] xs:max-w-[280px] sm:max-w-none">
              {typeName}
            </span>
          </div>
        </div>

        {/* Fechas de Emisión / Vencimiento */}
        <div className="space-y-1.5 mb-3.5 text-xs px-0.5">
          <div className="text-gray-400 flex justify-between gap-4">
            <span>Emisión:</span> 
            <span className="font-semibold text-gray-600">{formatDate(doc.created_at)}</span>
          </div>
          <div className="text-gray-400 flex justify-between gap-4">
            <span>Expiración:</span> 
            <span className="font-semibold text-gray-600">{formatDate(expirationDateValue)}</span>
          </div>
        </div>

        {/* Acciones adaptables a Mobile */}
        <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center w-full">
          {/* Badge tipo "pill": rounded-full + border-2 para que coincida con el diseño de referencia */}
          <div className={`text-xs font-extrabold text-center px-5 py-2.5 rounded-full border sm:inline-block flex-1 sm:flex-initial ${status.bgClass}`}>
            {status.label}
          </div>
          {doc.download_base64_url && (
            <a 
              href={doc.download_base64_url} 
              target="_blank" 
              rel="noreferrer" 
              className="text-xs font-bold bg-[#394049] text-white px-4 py-2 rounded-xl flex items-center justify-center hover:bg-gray-700 active:bg-gray-800 transition shadow-sm text-center"
            >
              <Download className="w-3.5 h-3.5 mr-1.5 shrink-0" /> Ver/Descargar
            </a>
          )}
        </div>

        {/* Bloqueo descriptivo */}
        {isBlocked && doc.blocked_description && (
          <div className="mt-3 bg-red-50 border border-red-150 p-2.5 rounded-xl flex items-start gap-2 animate-fade-in">
            <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-[11px] text-red-700 font-medium leading-normal">{doc.blocked_description}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ApiDocumentCard;