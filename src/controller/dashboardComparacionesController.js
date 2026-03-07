import prisma from "../config/prisma.js";

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
        const hoy = new Date();
        let gteActual = new Date(hoy), lteActual = new Date(hoy);
        let gteAnterior = new Date(hoy), lteAnterior = new Date(hoy);
        let tituloComparacion = "";

        gteActual.setHours(0, 0, 0, 0); lteActual.setHours(23, 59, 59, 999);
        gteAnterior.setHours(0, 0, 0, 0); lteAnterior.setHours(23, 59, 59, 999);

        // Si elige una pestaña fija, sobreescribimos la lógica del "periodo" global
        switch (tab_seleccionada) {
            case 'Mes vs Mes Anterior':
                gteActual.setDate(1);
                gteAnterior.setMonth(gteAnterior.getMonth() - 1, 1);
                lteAnterior.setDate(0); 
                tituloComparacion = "Mes Actual vs Mes Anterior";
                break;

            case 'Trimestre vs Anterior':
                const mesTrim = Math.floor(gteActual.getMonth() / 3) * 3;
                gteActual.setMonth(mesTrim, 1);
                gteAnterior.setMonth(mesTrim - 3, 1);
                lteAnterior = new Date(gteAnterior.getFullYear(), gteAnterior.getMonth() + 3, 0);
                tituloComparacion = "Trimestre Actual vs Trimestre Anterior";
                break;

            case 'Semestre vs Anterior':
                const mesSem = gteActual.getMonth() < 6 ? 0 : 6;
                gteActual.setMonth(mesSem, 1);
                gteAnterior.setMonth(mesSem - 6, 1);
                lteAnterior = new Date(gteAnterior.getFullYear(), gteAnterior.getMonth() + 6, 0);
                tituloComparacion = "Semestre Actual vs Semestre Anterior";
                break;

            case 'Ano vs Anterior':
                gteActual.setMonth(0, 1);
                gteAnterior.setFullYear(gteAnterior.getFullYear() - 1, 0, 1);
                lteAnterior.setFullYear(lteAnterior.getFullYear() - 1, 11, 31);
                tituloComparacion = "Año Actual vs Año Anterior";
                break;

            case 'Periodo Seleccionado':
            default:
                // Usa la lógica normal del filtro global de la izquierda
                tituloComparacion = `${periodo} vs Periodo Anterior`;
                switch (periodo) {
                    case 'Hoy':
                        gteAnterior.setDate(gteAnterior.getDate() - 1); lteAnterior.setDate(lteAnterior.getDate() - 1);
                        tituloComparacion = "Hoy vs Ayer";
                        break;
                    case 'Esta Semana':
                        const diaSemana = gteActual.getDay() || 7;
                        gteActual.setDate(gteActual.getDate() - diaSemana + 1);
                        gteAnterior = new Date(gteActual); gteAnterior.setDate(gteAnterior.getDate() - 7);
                        lteAnterior = new Date(gteActual); lteAnterior.setDate(lteAnterior.getDate() - 1);
                        break;
                    case 'Este Mes':
                        gteActual.setDate(1);
                        gteAnterior.setMonth(gteAnterior.getMonth() - 1, 1); lteAnterior.setDate(0); 
                        break;
                    case 'Este Trimestre':
                        const mT = Math.floor(gteActual.getMonth() / 3) * 3;
                        gteActual.setMonth(mT, 1); gteAnterior.setMonth(mT - 3, 1);
                        lteAnterior = new Date(gteAnterior.getFullYear(), gteAnterior.getMonth() + 3, 0);
                        break;
                    case 'Este Semestre':
                        const mS = gteActual.getMonth() < 6 ? 0 : 6;
                        gteActual.setMonth(mS, 1); gteAnterior.setMonth(mS - 6, 1);
                        lteAnterior = new Date(gteAnterior.getFullYear(), gteAnterior.getMonth() + 6, 0);
                        break;
                    case 'Este Ano': 
                        gteActual.setMonth(0, 1); gteAnterior.setFullYear(gteAnterior.getFullYear() - 1, 0, 1);
                        lteAnterior.setFullYear(lteAnterior.getFullYear() - 1, 11, 31);
                        break;
                    case 'Personalizado':
                        if (fecha_inicio && fecha_fin) {
                            gteActual = new Date(`${fecha_inicio}T00:00:00.000Z`); lteActual = new Date(`${fecha_fin}T23:59:59.999Z`);
                            const diffDays = Math.ceil(Math.abs(lteActual - gteActual) / (1000 * 60 * 60 * 24));
                            gteAnterior = new Date(gteActual); gteAnterior.setDate(gteAnterior.getDate() - diffDays);
                            lteAnterior = new Date(gteActual); lteAnterior.setDate(lteAnterior.getDate() - 1);
                        }
                        break;
                }
                break;
        }
        // Ajustamos horas del periodo anterior por si las matemáticas de días las movieron
        lteAnterior.setHours(23, 59, 59, 999);

        // B. CONSULTAS A LA BD
        const [
            ventasActual, gastosActual, membresiasActual,
            ventasAnterior, gastosAnterior, membresiasAnterior,
            membresiasAgrupadas
        ] = await Promise.all([
            prisma.cajaMovimiento.aggregate({ where: { tipo: 'ingreso', referenciaTipo: 'venta', fecha: { gte: gteActual, lte: lteActual } }, _sum: { monto: true } }),
            prisma.cajaMovimiento.aggregate({ where: { tipo: 'gasto', fecha: { gte: gteActual, lte: lteActual } }, _sum: { monto: true } }),
            prisma.cajaMovimiento.aggregate({ where: { tipo: 'ingreso', referenciaTipo: 'membresia', fecha: { gte: gteActual, lte: lteActual } }, _sum: { monto: true } }),
            
            prisma.cajaMovimiento.aggregate({ where: { tipo: 'ingreso', referenciaTipo: 'venta', fecha: { gte: gteAnterior, lte: lteAnterior } }, _sum: { monto: true } }),
            prisma.cajaMovimiento.aggregate({ where: { tipo: 'gasto', fecha: { gte: gteAnterior, lte: lteAnterior } }, _sum: { monto: true } }),
            prisma.cajaMovimiento.aggregate({ where: { tipo: 'ingreso', referenciaTipo: 'membresia', fecha: { gte: gteAnterior, lte: lteAnterior } }, _sum: { monto: true } }),

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