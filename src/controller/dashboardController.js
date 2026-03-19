import prisma from "../config/prisma.js";
import { ahoraEnMerida, localAUTC, fechaUTCADiaStr, partesEnMerida } from "../utils/timezone.js";

// ==========================================
// MOTOR DE FECHAS CENTRALIZADO
// ==========================================
const calcularFechasDashboard = (periodoFiltro) => {
    const p = (periodoFiltro || 'semana').toLowerCase();
    const { year, month, day } = ahoraEnMerida();

    // Inicio y fin de HOY en Mérida (como UTC para consultas Prisma)
    const inicioHoy = localAUTC(year, month, day, 0, 0, 0, 0);
    const finHoy    = localAUTC(year, month, day, 23, 59, 59, 999);

    let gteAct = inicioHoy, lteAct = new Date(); // "ahora mismo" como límite superior
    let gteAnt = inicioHoy, lteAnt = finHoy;

    if (p === 'mes') {
        gteAct = localAUTC(year, month, 1, 0, 0, 0, 0);            // 1ro de este mes
        gteAnt = localAUTC(year, month - 1, 1, 0, 0, 0, 0);        // 1ro del mes pasado
        lteAnt = localAUTC(year, month, 0, 23, 59, 59, 999);        // Último día del mes pasado
    } else if (p === 'hoy') {
        gteAnt = localAUTC(year, month, day - 1, 0, 0, 0, 0);      // Ayer 00:00
        lteAnt = localAUTC(year, month, day - 1, 23, 59, 59, 999); // Ayer 23:59
    } else {
        // Por defecto 'semana' (Lunes a Domingo)
        const jsDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
        const diaSemana = jsDay === 0 ? 7 : jsDay; // 1=Lun ... 7=Dom
        gteAct = localAUTC(year, month, day - diaSemana + 1, 0, 0, 0, 0); // Lunes de esta semana
        gteAnt = localAUTC(year, month, day - diaSemana - 6, 0, 0, 0, 0); // Lunes semana pasada
        lteAnt = localAUTC(year, month, day - diaSemana, 23, 59, 59, 999); // Domingo pasado 23:59
    }

    const periodoLabel = p.charAt(0).toUpperCase() + p.slice(1); // 'Mes', 'Semana', 'Hoy'
    return { gteAct, lteAct, gteAnt, lteAnt, periodoLabel };
};


// ==========================================
// 1. OBTENER KPIs PRINCIPALES (Tarjetas Superiores)
// ==========================================
export const obtenerKPIsDashboard = async (req, res) => {
    try {
        const { periodo } = req.query;
        const { gteAct, lteAct, gteAnt, lteAnt } = calcularFechasDashboard(periodo);

        const [ ventasAct, gastosAct, ventasAnt, gastosAnt ] = await Promise.all([
            prisma.cajaMovimiento.aggregate({ 
                where: { 
                    tipo: 'ingreso', 
                    fecha: { gte: gteAct, lte: lteAct },
                    NOT: { concepto: { nombre: { contains: 'apertura', mode: 'insensitive' } } } // 🔥 ESCUDO APLICADO
                }, 
                _sum: { monto: true } 
            }),
            prisma.cajaMovimiento.aggregate({ where: { tipo: 'gasto', fecha: { gte: gteAct, lte: lteAct } }, _sum: { monto: true } }),
            prisma.cajaMovimiento.aggregate({ 
                where: { 
                    tipo: 'ingreso', 
                    fecha: { gte: gteAnt, lte: lteAnt },
                    NOT: { concepto: { nombre: { contains: 'apertura', mode: 'insensitive' } } } // 🔥 ESCUDO APLICADO
                }, 
                _sum: { monto: true } 
            }),
            prisma.cajaMovimiento.aggregate({ where: { tipo: 'gasto', fecha: { gte: gteAnt, lte: lteAnt } }, _sum: { monto: true } })
        ]);

        const parseTotal = (ag) => ag._sum.monto ? parseFloat(ag._sum.monto) : 0;
        
        const totalVentasActual = parseTotal(ventasAct); const totalGastosActual = parseTotal(gastosAct);
        const utilidadActual = totalVentasActual - totalGastosActual;
        
        const totalVentasAnterior = parseTotal(ventasAnt); const totalGastosAnterior = parseTotal(gastosAnt);
        const utilidadAnterior = totalVentasAnterior - totalGastosAnterior;

        const calcularPorcentaje = (actual, anterior) => {
            if (anterior === 0) return actual > 0 ? 100 : 0;
            return parseFloat((((actual - anterior) / Math.abs(anterior)) * 100).toFixed(1));
        };

        res.status(200).json({
            message: "KPIs del Dashboard obtenidos",
            data: {
                ventas: { total: totalVentasActual, variacion: calcularPorcentaje(totalVentasActual, totalVentasAnterior), texto_comparacion: "vs anterior" },
                gastos: { total: totalGastosActual, variacion: calcularPorcentaje(totalGastosActual, totalGastosAnterior), texto_comparacion: "vs anterior" },
                utilidad: { total: utilidadActual, variacion: calcularPorcentaje(utilidadActual, utilidadAnterior), texto_comparacion: "vs anterior" },
                saldo_neto: { total: utilidadActual, variacion: calcularPorcentaje(utilidadActual, utilidadAnterior), texto_comparacion: "vs anterior" }
            }
        });

    } catch (error) {
        console.error("Error al obtener KPIs:", error);
        res.status(500).json({ error: "Error interno al calcular los datos del dashboard." });
    }
};


// ==========================================
// 2. OBTENER MÉTRICAS SECUNDARIAS (Gráficas y Tablas completas)
// ==========================================
export const obtenerMetricasDashboard = async (req, res) => {
    try {
        const { periodo } = req.query;
        // Motor de fechas dinámico para el Widget de Insight
        const { gteAct: insGteAct, lteAct: insLteAct, gteAnt: insGteAnt, lteAnt: insLteAnt, periodoLabel } = calcularFechasDashboard(periodo);

        // ---------------------------------------------------------
        // A. CÁLCULO ESTÁTICO DE FECHAS (Para Gráficas fijas)
        // ---------------------------------------------------------
        const { year, month, day } = ahoraEnMerida();

        const inicioHoy   = localAUTC(year, month, day, 0, 0, 0, 0);
        const inicioAyer  = localAUTC(year, month, day - 1, 0, 0, 0, 0);
        const finAyer     = localAUTC(year, month, day - 1, 23, 59, 59, 999);
        const hace7Dias   = localAUTC(year, month, day - 6, 0, 0, 0, 0);
        const ahoraUtc = new Date();

        const jsDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
        const diaSemana = jsDay === 0 ? 7 : jsDay;
        const inicioEstaSemana  = localAUTC(year, month, day - diaSemana + 1, 0, 0, 0, 0);
        const inicioSemanaPasada = localAUTC(year, month, day - diaSemana - 6, 0, 0, 0, 0);
        const finSemanaPasada    = localAUTC(year, month, day - diaSemana, 23, 59, 59, 999);

        // ---------------------------------------------------------
        // B. CONSULTAS MASIVAS EN PARALELO
        // ---------------------------------------------------------
        const [
            ingresos7Dias, accesosHoy, accesosAyerCount, stockCriticoRaw,
            ventasEstaSemana, ventasSemanaPasada,
            insIngresosAct, insGastosAct, insIngresosAnt, insGastosAnt // Consultas rápidas para el Insight
        ] = await Promise.all([
            prisma.cajaMovimiento.findMany({ 
                where: { 
                    tipo: 'ingreso', 
                    fecha: { gte: hace7Dias, lte: ahoraUtc },
                    NOT: { concepto: { nombre: { contains: 'apertura', mode: 'insensitive' } } } // 🔥
                }, 
                select: { fecha: true, monto: true } 
            }),
            prisma.acceso.findMany({ where: { tipo: 'IN', fechaHora: { gte: inicioHoy, lte: ahoraUtc } }, include: { socio: { select: { genero: true } } } }),
            prisma.acceso.count({ where: { tipo: 'IN', fechaHora: { gte: inicioAyer, lte: finAyer } } }),
            prisma.producto.findMany({ where: { isDeleted: false, stock: { is: { cantidad: { lte: 10 } } } }, select: { nombre: true, stock: { select: { cantidad: true } } }, orderBy: { stock: { cantidad: 'asc' } }, take: 5 }),
            
            prisma.cajaMovimiento.findMany({ 
                where: { 
                    tipo: 'ingreso', 
                    fecha: { gte: inicioEstaSemana, lte: ahoraUtc },
                    NOT: { concepto: { nombre: { contains: 'apertura', mode: 'insensitive' } } } // 🔥
                }, 
                select: { fecha: true, monto: true } 
            }),
            prisma.cajaMovimiento.findMany({ 
                where: { 
                    tipo: 'ingreso', 
                    fecha: { gte: inicioSemanaPasada, lte: finSemanaPasada },
                    NOT: { concepto: { nombre: { contains: 'apertura', mode: 'insensitive' } } } // 🔥
                }, 
                select: { fecha: true, monto: true } 
            }),
            
            // INSIGHT MATH
            prisma.cajaMovimiento.aggregate({ 
                where: { 
                    tipo: 'ingreso', 
                    fecha: { gte: insGteAct, lte: insLteAct },
                    NOT: { concepto: { nombre: { contains: 'apertura', mode: 'insensitive' } } } // 🔥
                }, 
                _sum: { monto: true } 
            }),
            prisma.cajaMovimiento.aggregate({ where: { tipo: 'gasto', fecha: { gte: insGteAct, lte: insLteAct } }, _sum: { monto: true } }),
            prisma.cajaMovimiento.aggregate({ 
                where: { 
                    tipo: 'ingreso', 
                    fecha: { gte: insGteAnt, lte: insLteAnt },
                    NOT: { concepto: { nombre: { contains: 'apertura', mode: 'insensitive' } } } // 🔥
                }, 
                _sum: { monto: true } 
            }),
            prisma.cajaMovimiento.aggregate({ where: { tipo: 'gasto', fecha: { gte: insGteAnt, lte: insLteAnt } }, _sum: { monto: true } })
        ]);

        // ---------------------------------------------------------
        // C. PROCESAMIENTO MATEMÁTICO 
        // ---------------------------------------------------------
        const parseTotal = (ag) => ag._sum.monto ? parseFloat(ag._sum.monto) : 0;

        // 1. WIDGET: Insight Inteligente (Alineado con las Tarjetas)
        const utilActual = parseTotal(insIngresosAct) - parseTotal(insGastosAct);
        const utilAnterior = parseTotal(insIngresosAnt) - parseTotal(insGastosAnt);

        let pctInsight = 0;
        if (utilAnterior === 0) pctInsight = utilActual > 0 ? 100 : 0;
        else pctInsight = ((utilActual - utilAnterior) / Math.abs(utilAnterior)) * 100;

        // 2. GRÁFICA: Ingresos Diarios
        const ingresosMap = new Map();
        for (let i = 0; i < 7; i++) {
            const d = localAUTC(year, month, day - 6 + i, 0, 0, 0, 0);
            ingresosMap.set(fechaUTCADiaStr(d), 0);
        }
        ingresos7Dias.forEach(mov => {
            const dia = fechaUTCADiaStr(mov.fecha);
            if (ingresosMap.has(dia)) ingresosMap.set(dia, ingresosMap.get(dia) + parseFloat(mov.monto));
        });
        const grafica_ingresos = Array.from(ingresosMap, ([fecha, total]) => ({ fecha, total }));

        // 3. WIDGETS: Asistencia, Horas Pico y Género
        const horasMap = new Map();
        let hombres = 0, mujeres = 0;

        accesosHoy.forEach(acceso => {
            const etiquetaHora = `${partesEnMerida(acceso.fechaHora).hour}:00`;
            horasMap.set(etiquetaHora, (horasMap.get(etiquetaHora) || 0) + 1);

            const gen = (acceso.socio?.genero || '').toLowerCase();
            if (gen === 'masculino' || gen === 'hombre') hombres++;
            else if (gen === 'femenino' || gen === 'mujer') mujeres++;
        });

        const horas_pico = Array.from(horasMap, ([hora, visitantes]) => ({ hora, visitantes })).sort((a, b) => b.visitantes - a.visitantes).slice(0, 4);

        let varAsistencia = 0;
        if (accesosAyerCount === 0) varAsistencia = accesosHoy.length > 0 ? 100 : 0;
        else varAsistencia = ((accesosHoy.length - accesosAyerCount) / accesosAyerCount) * 100;

        // 4. GRÁFICA: Ventas vs Periodo Anterior (Siempre de Lunes a Domingo)
        const nombresDias = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];
        const ventasMap = new Map();
        ['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom'].forEach(d => ventasMap.set(d, { actual: 0, anterior: 0 }));

        ventasEstaSemana.forEach(v => {
            const p = partesEnMerida(v.fecha);
            const nom = nombresDias[new Date(p.year, p.month - 1, p.day).getDay()];
            if(ventasMap.has(nom)) ventasMap.get(nom).actual += parseFloat(v.monto);
        });
        ventasSemanaPasada.forEach(v => {
            const p = partesEnMerida(v.fecha);
            const nom = nombresDias[new Date(p.year, p.month - 1, p.day).getDay()];
            if(ventasMap.has(nom)) ventasMap.get(nom).anterior += parseFloat(v.monto);
        });
        const grafica_ventas_vs_anterior = Array.from(ventasMap, ([dia, vals]) => ({ dia, actual: vals.actual, anterior: vals.anterior }));

        // ---------------------------------------------------------
        // D. ESTRUCTURA FINAL JSON
        // ---------------------------------------------------------
        res.status(200).json({
            message: "Métricas secundarias obtenidas",
            data: {
                grafica_ventas_vs_anterior,
                grafica_ingresos,
                horas_pico,
                stock_critico: stockCriticoRaw.map(p => ({ nombre: p.nombre, stock: p.stock ? p.stock.cantidad : 0 })),
                widgets: {
                    asistencia: {
                        hoy: accesosHoy.length,
                        ayer: accesosAyerCount,
                        variacion: Number(varAsistencia.toFixed(1)),
                        tendencia_positiva: varAsistencia >= 0
                    },
                    por_genero: [
                        { nombre: 'Hombres', valor: hombres },
                        { nombre: 'Mujeres', valor: mujeres }
                    ],
                    insight_negocio: {
                        titulo: pctInsight >= 0 ? "El negocio mejoró" : "Requiere atención",
                        texto: `La utilidad ${pctInsight >= 0 ? 'subió' : 'bajó'} un ${Math.abs(pctInsight).toFixed(1)}% comparado con el periodo anterior.`,
                        tendencia_positiva: pctInsight >= 0,
                        periodo_aplicado: periodoLabel
                    }
                }
            }
        });

    } catch (error) {
        console.error("Error al obtener métricas del Dashboard:", error);
        res.status(500).json({ error: "Error interno al calcular las métricas." });
    }
};