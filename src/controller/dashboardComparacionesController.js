import prisma from "../config/prisma.js";
import { ahoraEnMerida, localAUTC, fechaStrAInicio, fechaStrAFin } from "../utils/timezone.js";

const mapaPeriodos = {
    'hoy': 'Hoy',
    'esta semana': 'Esta Semana',
    'este mes': 'Este Mes',
    'este trimestre': 'Este Trimestre',
    'este semestre': 'Este Semestre',
    'este ano': 'Este Ano',
    'personalizado': 'Personalizado'
};

const mapaTabs = {
    'periodo seleccionado': 'Periodo Seleccionado',
    'mes vs mes anterior': 'Mes vs Mes Anterior',
    'trimestre vs anterior': 'Trimestre vs Anterior',
    'semestre vs anterior': 'Semestre vs Anterior',
    'ano vs anterior': 'Ano vs Anterior'
};

// OBTENER DATOS PARA LA PESTAÑA DE "COMPARACIONES"
export const obtenerComparacionesFinancieras = async (req, res) => {
    try {
        let { periodo, tab_seleccionada, fecha_inicio, fecha_fin } = req.query;

        // ESCUDO ANTI-TYPOS
        periodo = (periodo && mapaPeriodos[periodo.toLowerCase()]) || 'Este Mes';
        tab_seleccionada = (tab_seleccionada && mapaTabs[tab_seleccionada.toLowerCase()]) || 'Periodo Seleccionado';

        // A. LÓGICA DE FECHAS SEGÚN LA PESTAÑA SELECCIONADA
        const { year, month, day } = ahoraEnMerida();
        let gteActual  = localAUTC(year, month, day, 0, 0, 0, 0);
        let lteActual  = localAUTC(year, month, day, 23, 59, 59, 999);
        let gteAnterior = localAUTC(year, month, day, 0, 0, 0, 0);
        let lteAnterior = localAUTC(year, month, day, 23, 59, 59, 999);
        let tituloComparacion = "";

        // Si elige una pestaña fija, sobreescribimos la lógica del "periodo" global
        switch (tab_seleccionada) {
            case 'Mes vs Mes Anterior':
                gteActual   = localAUTC(year, month, 1, 0, 0, 0, 0);
                gteAnterior = localAUTC(year, month - 1, 1, 0, 0, 0, 0);
                lteAnterior = localAUTC(year, month, 0, 23, 59, 59, 999);
                tituloComparacion = "Mes Actual vs Mes Anterior";
                break;

            case 'Trimestre vs Anterior': {
                const mesTriStart = Math.floor((month - 1) / 3) * 3 + 1;
                gteActual   = localAUTC(year, mesTriStart, 1, 0, 0, 0, 0);
                gteAnterior = localAUTC(year, mesTriStart - 3, 1, 0, 0, 0, 0);
                lteAnterior = localAUTC(year, mesTriStart, 0, 23, 59, 59, 999);
                tituloComparacion = "Trimestre Actual vs Trimestre Anterior";
                break;
            }

            case 'Semestre vs Anterior': {
                const mesSemStart = month <= 6 ? 1 : 7;
                gteActual   = localAUTC(year, mesSemStart, 1, 0, 0, 0, 0);
                gteAnterior = localAUTC(year, mesSemStart - 6, 1, 0, 0, 0, 0);
                lteAnterior = localAUTC(year, mesSemStart, 0, 23, 59, 59, 999);
                tituloComparacion = "Semestre Actual vs Semestre Anterior";
                break;
            }

            case 'Ano vs Anterior':
                gteActual   = localAUTC(year, 1, 1, 0, 0, 0, 0);
                gteAnterior = localAUTC(year - 1, 1, 1, 0, 0, 0, 0);
                lteAnterior = localAUTC(year - 1, 12, 31, 23, 59, 59, 999);
                tituloComparacion = "Año Actual vs Año Anterior";
                break;

            case 'Periodo Seleccionado':
            default:
                // Usa la lógica normal del filtro global de la izquierda
                tituloComparacion = `${periodo} vs Periodo Anterior`;
                switch (periodo) {
                    case 'Hoy':
                        gteAnterior = localAUTC(year, month, day - 1, 0, 0, 0, 0);
                        lteAnterior = localAUTC(year, month, day - 1, 23, 59, 59, 999);
                        tituloComparacion = "Hoy vs Ayer";
                        break;
                    case 'Esta Semana': {
                        const jsDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
                        const diaSemana = jsDay === 0 ? 7 : jsDay;
                        gteActual   = localAUTC(year, month, day - diaSemana + 1, 0, 0, 0, 0);
                        gteAnterior = localAUTC(year, month, day - diaSemana - 6, 0, 0, 0, 0);
                        lteAnterior = localAUTC(year, month, day - diaSemana, 23, 59, 59, 999);
                        break;
                    }
                    case 'Este Mes':
                        gteActual   = localAUTC(year, month, 1, 0, 0, 0, 0);
                        gteAnterior = localAUTC(year, month - 1, 1, 0, 0, 0, 0);
                        lteAnterior = localAUTC(year, month, 0, 23, 59, 59, 999);
                        break;
                    case 'Este Trimestre': {
                        const mT = Math.floor((month - 1) / 3) * 3 + 1;
                        gteActual   = localAUTC(year, mT, 1, 0, 0, 0, 0);
                        gteAnterior = localAUTC(year, mT - 3, 1, 0, 0, 0, 0);
                        lteAnterior = localAUTC(year, mT, 0, 23, 59, 59, 999);
                        break;
                    }
                    case 'Este Semestre': {
                        const mS = month <= 6 ? 1 : 7;
                        gteActual   = localAUTC(year, mS, 1, 0, 0, 0, 0);
                        gteAnterior = localAUTC(year, mS - 6, 1, 0, 0, 0, 0);
                        lteAnterior = localAUTC(year, mS, 0, 23, 59, 59, 999);
                        break;
                    }
                    case 'Este Ano':
                        gteActual   = localAUTC(year, 1, 1, 0, 0, 0, 0);
                        gteAnterior = localAUTC(year - 1, 1, 1, 0, 0, 0, 0);
                        lteAnterior = localAUTC(year - 1, 12, 31, 23, 59, 59, 999);
                        break;
                    case 'Personalizado':
                        if (fecha_inicio && fecha_fin) {
                            gteActual = fechaStrAInicio(fecha_inicio);
                            lteActual = fechaStrAFin(fecha_fin);
                            const diffDays = Math.ceil(Math.abs(lteActual - gteActual) / (1000 * 60 * 60 * 24));
                            const [fy, fm, fd] = fecha_inicio.split('-').map(Number);
                            gteAnterior = localAUTC(fy, fm, fd - diffDays, 0, 0, 0, 0);
                            lteAnterior = localAUTC(fy, fm, fd - 1, 23, 59, 59, 999);
                        }
                        break;
                }
                break;
        }

        // B. CONSULTAS A LA BD
        const [
            ventasActual, gastosActual, membresiasActual,
            ventasAnterior, gastosAnterior, membresiasAnterior,
            membresiasAgrupadas
        ] = await Promise.all([
            prisma.cajaMovimiento.aggregate({ where: { tipo: 'ingreso', referenciaTipo: 'venta', fecha: { gte: gteActual, lte: lteActual }, NOT: { concepto: { nombre: { contains: 'apertura', mode: 'insensitive' } } } }, _sum: { monto: true } }),
            prisma.cajaMovimiento.aggregate({ where: { tipo: 'gasto', fecha: { gte: gteActual, lte: lteActual } }, _sum: { monto: true } }),
            prisma.cajaMovimiento.aggregate({ where: { tipo: 'ingreso', referenciaTipo: 'membresia', fecha: { gte: gteActual, lte: lteActual }, NOT: { concepto: { nombre: { contains: 'apertura', mode: 'insensitive' } } } }, _sum: { monto: true } }),
            
            prisma.cajaMovimiento.aggregate({ where: { tipo: 'ingreso', referenciaTipo: 'venta', fecha: { gte: gteAnterior, lte: lteAnterior }, NOT: { concepto: { nombre: { contains: 'apertura', mode: 'insensitive' } } } }, _sum: { monto: true } }),
            prisma.cajaMovimiento.aggregate({ where: { tipo: 'gasto', fecha: { gte: gteAnterior, lte: lteAnterior } }, _sum: { monto: true } }),
            prisma.cajaMovimiento.aggregate({ where: { tipo: 'ingreso', referenciaTipo: 'membresia', fecha: { gte: gteAnterior, lte: lteAnterior }, NOT: { concepto: { nombre: { contains: 'apertura', mode: 'insensitive' } } } }, _sum: { monto: true } }),

            // Para sacar el "Plan más popular" de los insights
            prisma.membresiaSocio.findMany({ where: { fechaInicio: { gte: gteActual, lte: lteActual } }, include: { plan: true } })
        ]);

        // C. MATEMÁTICAS 
        const parse = (ag) => ag._sum.monto ? parseFloat(ag._sum.monto) : 0;
        
        const actVentas = parse(ventasActual); const antVentas = parse(ventasAnterior);
        const actGastos = parse(gastosActual); const antGastos = parse(gastosAnterior);
        const actMembresias = parse(membresiasActual); const antMembresias = parse(membresiasAnterior);
        const actUtilidad = (actVentas + actMembresias) - actGastos; 
        const antUtilidad = (antVentas + antMembresias) - antGastos;

        const calcularStats = (actual, anterior, invertido = false) => {
            const diferencia = actual - anterior;
            let porcentaje = 0;
            if (anterior !== 0) porcentaje = (diferencia / Math.abs(anterior)) * 100;
            else if (actual !== 0) porcentaje = 100;

            // Invertido = true significa que "Bajar es Bueno" (Ej: Gastos).
            let esPositivo = diferencia >= 0;
            if (invertido) esPositivo = diferencia <= 0;

            return {
                actual: actual,
                anterior: anterior,
                diferencia: diferencia,
                porcentaje: Number(porcentaje.toFixed(1)),
                es_positivo: esPositivo
            };
        };

        const compVentas = calcularStats(actVentas, antVentas);
        const compGastos = calcularStats(actGastos, antGastos, true); // Gastos: menos es mejor
        const compUtilidad = calcularStats(actUtilidad, antUtilidad);
        const compMembresias = calcularStats(actMembresias, antMembresias);

        // Conteo de indicadores
        let positivos = 0; let negativos = 0;
        [compVentas, compGastos, compUtilidad, compMembresias].forEach(comp => {
            if (comp.es_positivo) positivos++;
            else negativos++;
        });

        // D. INSIGHTS INTELIGENTES
        const insights = [];

        // Insight Ventas
        if (compVentas.porcentaje > 0) insights.push({ tipo: 'positivo', texto: `Las ventas aumentaron un ${compVentas.porcentaje}% respecto al periodo anterior. ¡Excelente ritmo!` });
        else if (compVentas.porcentaje < 0) insights.push({ tipo: 'negativo', texto: `Las ventas bajaron ${compVentas.porcentaje}% respecto al periodo anterior. Considere revisar estrategias comerciales.` });

        // Insight Gastos
        if (compGastos.porcentaje < 0) insights.push({ tipo: 'positivo', texto: `Los gastos se redujeron un ${Math.abs(compGastos.porcentaje)}%. Buen control de costos operativos.` });
        else if (compGastos.porcentaje > 0) insights.push({ tipo: 'negativo', texto: `Atención: Los gastos se incrementaron un ${compGastos.porcentaje}%.` });

        // Insight Membresías
        const planesMap = new Map();
        membresiasAgrupadas.forEach(mem => {
            if(mem.plan) planesMap.set(mem.plan.nombre, (planesMap.get(mem.plan.nombre) || 0) + 1);
        });
        const planesOrdenados = Array.from(planesMap, ([plan, cantidad]) => ({ plan, cantidad })).sort((a, b) => b.cantidad - a.cantidad);
        
        if (planesOrdenados.length > 0) {
            insights.push({ tipo: 'neutral', texto: `El plan más popular es "${planesOrdenados[0].plan}" con ${planesOrdenados[0].cantidad} suscripciones nuevas. Total de socios adquiridos: ${membresiasAgrupadas.length}.` });
        } else {
            insights.push({ tipo: 'neutral', texto: `El plan más popular es "N/A" con 0 suscripciones activas. Total de socios: 0.` });
        }

        // E. RESPUESTA FINAL
        res.status(200).json({
            message: "Datos de comparaciones generados",
            filtros_aplicados: { periodo, tab_seleccionada },
            data: {
                titulo_grafica: tituloComparacion,
                comparaciones: {
                    ventas: compVentas,
                    gastos: compGastos,
                    utilidad: compUtilidad,
                    membresias: compMembresias
                },
                resumen_indicadores: {
                    positivos: positivos,
                    negativos: negativos
                },
                insights: insights
            }
        });

    } catch (error) {
        console.error("Error al obtener Comparaciones Financieras:", error);
        res.status(500).json({ error: "Error interno al calcular las comparaciones." });
    }
};