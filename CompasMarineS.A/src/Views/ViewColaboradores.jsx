import React from 'react';
import { ArrowLeft } from 'lucide-react';

export const ViewColaboradores = ({ setView }) => {
    return (
        <div className="bg-[#121212] min-h-screen flex flex-col justify-between text-gray-800 font-sans w-full py-8 px-4">

            {/* Contenedor Principal Estilo Tarjeta Corporativa */}
            <main className="max-w-5xl w-full mx-auto bg-white rounded-2xl shadow-xl p-6 sm:p-8 flex-grow border border-gray-100 flex flex-col">
                
                {/* Cabecera con Logotipo Corporativo e Identidad */}
                <div className="flex flex-col items-center border-b border-gray-100 pb-6 mb-6">
                    {/* Logotipo Estilizado Compas Marine */}
                    <div className="text-center mb-4">
                        <h2 className="text-2xl sm:text-3xl font-black tracking-widest text-[#802030] uppercase">COMPAS</h2>
                        <span className="text-[10px] tracking-[0.3em] font-semibold text-gray-500 uppercase block -mt-1">marine</span>
                    </div>

                    <div className="w-full flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mt-2">
                        <div>
                            <button
                                type="button"
                                onClick={() => setView?.('admin')}
                                className="mb-2 inline-flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-[#802030] transition-colors"
                            >
                                <ArrowLeft className="w-3.5 h-3.5" /> Volver al panel admin
                            </button>
                            <h1 className="text-lg sm:text-xl font-bold text-gray-900 tracking-tight">Gestión de Colaboradores</h1>
                            <p className="text-xs text-gray-500 mt-0.5">Supervisa el estado de la documentación vigente y vencida.</p>
                        </div>
                        <div>
                            <button type="button" className="bg-[#802030] hover:bg-[#6a1a28] text-white text-xs sm:text-sm font-medium px-4 py-2 rounded-xl transition duration-200 shadow-sm cursor-pointer flex items-center gap-1.5 active:scale-95">
                                <span className="text-sm leading-none font-bold">+</span> Nuevo Colaborador
                            </button>
                        </div>
                    </div>
                </div>

                {/* Tabla de Colaboradores Compacta (Ideal para muchos registros) */}
                <div className="overflow-x-auto rounded-xl border border-gray-100 flex-grow">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-gray-50/70 border-b border-gray-100 text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                                <th className="py-2.5 px-3">Colaborador</th>
                                <th className="py-2.5 px-3">Estado General</th>
                                <th className="py-2.5 px-3">Documentos Vencidos</th>
                                <th className="py-2.5 px-3">Por Expirar</th>
                                <th className="py-2.5 px-3">Vigentes</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50 text-xs">
                            
                            {/* Fila Ejemplo 1 */}
                            <tr className="hover:bg-gray-50/60 transition-colors">
                                <td className="py-3 px-3 align-middle">
                                    <span className="font-semibold text-gray-900 block">Juan Pérez</span>
                                    <span className="text-[11px] text-gray-400">jperez@compasmarine.cl</span>
                                </td>
                                <td className="py-3 px-3 align-middle">
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium bg-red-50 text-red-700 border border-red-100">
                                        <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-red-600"></span>
                                        Atención
                                    </span>
                                </td>
                                <td className="py-3 px-3 align-middle">
                                    <span className="inline-block bg-red-50/60 text-red-700 px-2.5 py-1 rounded-lg border border-red-100 font-medium">
                                        Licencia de Conducir <span className="text-[10px] text-red-500 font-normal">(Venció 10/07)</span>
                                    </span>
                                </td>
                                <td className="py-3 px-3 align-middle">
                                    <span className="inline-block bg-amber-50/60 text-amber-800 px-2.5 py-1 rounded-lg border border-amber-100 font-medium">
                                        Curso de Altura <span className="text-[10px] text-amber-600 font-normal">(Vence 05/09)</span>
                                    </span>
                                </td>
                                <td className="py-3 px-3 align-middle">
                                    <span className="inline-block bg-emerald-50/60 text-emerald-800 px-2.5 py-1 rounded-lg border border-emerald-100 font-medium">
                                        ✓ 2 al día
                                    </span>
                                </td>
                            </tr>

                            {/* Fila Ejemplo 2 */}
                            <tr className="hover:bg-gray-50/60 transition-colors">
                                <td className="py-3 px-3 align-middle">
                                    <span className="font-semibold text-gray-900 block">María González</span>
                                    <span className="text-[11px] text-gray-400">mgonzalez@compasmarine.cl</span>
                                </td>
                                <td className="py-3 px-3 align-middle">
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium bg-emerald-50 text-emerald-700 border border-emerald-100">
                                        <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-emerald-600"></span>
                                        Al día
                                    </span>
                                </td>
                                <td className="py-3 px-3 align-middle text-gray-300">—</td>
                                <td className="py-3 px-3 align-middle text-gray-300">—</td>
                                <td className="py-3 px-3 align-middle">
                                    <span className="inline-block bg-emerald-50/60 text-emerald-800 px-2.5 py-1 rounded-lg border border-emerald-100 font-medium">
                                        ✓ 3 al día
                                    </span>
                                </td>
                            </tr>

                        </tbody>
                    </table>
                </div>

            </main>

            {/* Pie de página corporativo */}
            <footer className="text-center py-4 text-xs text-gray-400 border-t border-gray-800/60 bg-[#121212] mt-6">
                Compas Marine / Desarrollado por IngeniaSur © 2026 · Gestión Documental
            </footer>

        </div>
    );
};

export default ViewColaboradores;