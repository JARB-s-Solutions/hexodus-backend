import prisma from "../config/prisma.js";
import { ahoraEnMerida, localAUTC, fechaStrAInicio, fechaStrAFin, fechaUTCADiaStr, fechaUTCAMesStr } from "../utils/timezone.js";

const mapaPeriodos = {
    'hoy': 'Hoy',
    'esta semana': 'Esta Semana',
    'este mes': 'Este Mes',
    'este trimestre': 'Este Trimestre',
    'este semestre': 'Este Semestre',
    'este año': 'Este Ano',
    'este ano': 'Este Ano',
    'personalizado': 'Personalizado'
};

const mapaVistas = {
    'reporte completo': 'Reporte Completo',
    'ventas': 'Ventas',
    'gastos': 'Gastos',
    'utilidad': 'Utilidad',
    'membresías': 'Membresias',
    'membresias': 'Membresias'
};

// OBTENER RESUMEN FINANCIERO
export const obtenerResumenFinanciero = async (req, res) => {
    try {
        let { periodo, tipo_reporte, fecha_inicio, fecha_fin } = req.query;

        // ESCUDO ANTI-TYPOS (CASE INSENSITIVE)
        periodo = (periodo && mapaPeriodos[periodo.toLowerCase()]) || 'Este Mes';
        tipo_reporte = (tipo_reporte && mapaVistas[tipo_reporte.toLowerCase()]) || 'Reporte Completo';

        // A. LÓGICA DE FECHAS
        const { year, month, day } = ahoraEnMerida();
        let gteActual  = localAUTC(year, month, day, 0, 0, 0, 0);
        let lteActual  = localAUTC(year, month, day, 23, 59, 59, 999);
        let gteAnterior = localAUTC(year, month, day, 0, 0, 0, 0);
        let lteAnterior = localAUTC(year, month, day, 23, 59, 59, 999);

        switch (periodo) {
            case 'Hoy':
                gteAnterior = localAUTC(year, month, day - 1, 0, 0, 0, 0);
                lteAnterior = localAUTC(year, month, day - 1, 23, 59, 59, 999);
                break;
            case 'Esta Semana': {
                const jsDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
                const diaSemana = jsDay === 0 ? 7 : jsDay;
                gteActual   = localAUTC(year, month, day - diaSemana + 1, 0, 0, 0, 0);
                gteAnterior = localAUTC(year, month, day - diaSemana - 6, 0, 0, 0, 0);
                lteAnterior = localAUTC(year, month, day - diaSemana, 23, 59, 59, 999);
                break;
            }
            case 'Este Trimestre': {
                const mesTriStart = Math.floor((month - 1) / 3) * 3 + 1;
                gteActual   = localAUTC(year, mesTriStart, 1, 0, 0, 0, 0);
                gteAnterior = localAUTC(year, mesTriStart - 3, 1, 0, 0, 0, 0);
                lteAnterior = localAUTC(year, mesTriStart, 0, 23, 59, 59, 999);
                break;
            }
            case 'Este Semestre': {
                const mesSemStart = month <= 6 ? 1 : 7;
                gteActual   = localAUTC(year, mesSemStart, 1, 0, 0, 0, 0);
                gteAnterior = localAUTC(year, mesSemStart - 6, 1, 0, 0, 0, 0);
                lteAnterior = localAUTC(year, mesSemStart, 0, 23, 59, 59, 999);
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
            case 'Este Mes':
            default:
                gteActual   = localAUTC(year, month, 1, 0, 0, 0, 0);
                gteAnterior = localAUTC(year, month - 1, 1, 0, 0, 0, 0);
                lteAnterior = localAUTC(year, month, 0, 23, 59, 59, 999);
                break;
        }

        // B. CONSULTAS A LA BD
        const [
            ingresosActual, gastosActual, membresiasActual, ventasActual,
            ingresosAnterior, gastosAnterior, membresiasAnterior, ventasAnterior,
            sociosActivos, transaccionesVentas, transaccionesGastos,
            movimientosGastos, membresiasPeriodo
        ] = await Promise.all([
            // Sumamos todos los ingresos, excepto la apertura
            prisma.cajaMovimiento.aggregate({ 
                where: { 
                    tipo: 'ingreso', 
                    fecha: { gte: gteActual, lte: lteActual },
                    NOT: { concepto: { nombre: { contains: 'apertura', mode: 'insensitive' } } }
                }, 
                _sum: { monto: true } 
            }),
            prisma.cajaMovimiento.aggregate({ where: { tipo: 'gasto', fecha: { gte: gteActual, lte: lteActual } }, _sum: { monto: true } }),
            prisma.cajaMovimiento.aggregate({ where: { tipo: 'ingreso', referenciaTipo: 'membresia', fecha: { gte: gteActual, lte: lteActual } }, _sum: { monto: true } }),
            prisma.cajaMovimiento.aggregate({ where: { tipo: 'ingreso', referenciaTipo: 'venta', fecha: { gte: gteActual, lte: lteActual } }, _sum: { monto: true } }),
            
            prisma.cajaMovimiento.aggregate({ 
                where: { 
                    tipo: 'ingreso', 
                    fecha: { gte: gteAnterior, lte: lteAnterior },
                    NOT: { concepto: { nombre: { contains: 'apertura', mode: 'insensitive' } } }
                }, 
                _sum: { monto: true } 
            }),
            prisma.cajaMovimiento.aggregate({ where: { tipo: 'gasto', fecha: { gte: gteAnterior, lte: lteAnterior } }, _sum: { monto: true } }),
            prisma.cajaMovimiento.aggregate({ where: { tipo: 'ingreso', referenciaTipo: 'membresia', fecha: { gte: gteAnterior, lte: lteAnterior } }, _sum: { monto: true } }),
            prisma.cajaMovimiento.aggregate({ where: { tipo: 'ingreso', referenciaTipo: 'venta', fecha: { gte: gteAnterior, lte: lteAnterior } }, _sum: { monto: true } }),

            prisma.membresiaSocio.count({ where: { status: 'activa', fechaFin: { gte: new Date() } } }),
            prisma.cajaMovimiento.count({ where: { tipo: 'ingreso', referenciaTipo: 'venta', fecha: { gte: gteActual, lte: lteActual } } }),
            prisma.cajaMovimiento.count({ where: { tipo: 'gasto', fecha: { gte: gteActual, lte: lteActual } } }),

            prisma.cajaMovimiento.findMany({ where: { tipo: 'gasto', fecha: { gte: gteActual, lte: lteActual } }, include: { concepto: true } }),
            prisma.membresiaSocio.findMany({ where: { fechaInicio: { gte: gteActual, lte: lteActual } }, include: { plan: true } })
        ]);

        const parseTotal = (ag) => ag._sum.monto ? parseFloat(ag._sum.monto) : 0;
        const calcularPorcentaje = (actual, anterior) => {
            if (anterior === 0) return actual > 0 ? 100 : 0;
            return Number((((actual - anterior) / Math.abs(anterior)) * 100).toFixed(1));
        };

        const totIngresos = parseTotal(ingresosActual);
        const totGastos = parseTotal(gastosActual);
        const totUtilidad = totIngresos - totGastos;
        const totMembresias = parseTotal(membresiasActual);
        const totVentas = parseTotal(ventasActual); 

        const antIngresos = parseTotal(ingresosAnterior);
        const antGastos = parseTotal(gastosAnterior);
        const antUtilidad = antIngresos - antGastos;
        const antMembresias = parseTotal(membresiasAnterior);
        const antVentas = parseTotal(ventasAnterior);

        const kpis_superiores = {
            ingresos: { total: totIngresos, porcentaje: calcularPorcentaje(totIngresos, antIngresos) },
            gastos: { total: totGastos, porcentaje: calcularPorcentaje(totGastos, antGastos) },
            utilidad_neta: { total: totUtilidad, porcentaje: calcularPorcentaje(totUtilidad, antUtilidad) },
            membresias: { total: totMembresias, porcentaje: calcularPorcentaje(totMembresias, antMembresias), socios_activos: sociosActivos }
        };

        let pctVentas = totIngresos > 0 ? ((totVentas / totIngresos) * 100).toFixed(1) : 0;
        let pctMembresias = totIngresos > 0 ? ((totMembresias / totIngresos) * 100).toFixed(1) : 0;

        const desglose_ingresos = {
            mostrar: ['Reporte Completo', 'Ventas', 'Membresias'].includes(tipo_reporte),
            total_ingresos: totIngresos,
            saldo_neto: totUtilidad,
            grafica: {
                ventas: { total: totVentas, porcentaje_grafica: Number(pctVentas), porcentaje_vs_anterior: calcularPorcentaje(totVentas, antVentas) },
                membresias: { total: totMembresias, porcentaje_grafica: Number(pctMembresias), porcentaje_vs_anterior: calcularPorcentaje(totMembresias, antMembresias) }
            }
        };

        const margenUtilidad = totIngresos > 0 ? ((totUtilidad / totIngresos) * 100).toFixed(1) : 0;

        const tarjetas_detalle = {
            ventas: {
                mostrar: ['Reporte Completo', 'Ventas'].includes(tipo_reporte),
                total: totVentas, transacciones: transaccionesVentas,
                porcentaje_vs_anterior: calcularPorcentaje(totVentas, antVentas),
                anterior_texto: `$${antVentas.toLocaleString('en-US')}`
            },
            gastos: {
                mostrar: ['Reporte Completo', 'Gastos'].includes(tipo_reporte),
                total: totGastos, movimientos: transaccionesGastos,
                porcentaje_vs_anterior: calcularPorcentaje(totGastos, antGastos),
                anterior_texto: `$${antGastos.toLocaleString('en-US')}`
            },
            utilidad: {
                mostrar: ['Reporte Completo', 'Utilidad'].includes(tipo_reporte),
                total: totUtilidad, margen: Number(margenUtilidad),
                porcentaje_vs_anterior: calcularPorcentaje(totUtilidad, antUtilidad),
                anterior_texto: `$${antUtilidad.toLocaleString('en-US')}`
            },
            membresias: {
                mostrar: ['Reporte Completo', 'Membresias'].includes(tipo_reporte),
                total: totMembresias, socios_activos: sociosActivos,
                porcentaje_vs_anterior: calcularPorcentaje(totMembresias, antMembresias),
                anterior_texto: `$${antMembresias.toLocaleString('en-US')}`
            }
        };

        const gastosMap = new Map();
        movimientosGastos.forEach(mov => {
            const nombre = mov.concepto ? mov.concepto.nombre : 'Sin Categoría';
            gastosMap.set(nombre, (gastosMap.get(nombre) || 0) + parseFloat(mov.monto));
        });
        const top_gastos = Array.from(gastosMap, ([categoria, monto]) => ({ categoria, monto }))
                                .sort((a, b) => b.monto - a.monto)
                                .slice(0, 5); 

        const planesMap = new Map();
        membresiasPeriodo.forEach(mem => {
            if(mem.plan) {
                const nombrePlan = mem.plan.nombre;
                planesMap.set(nombrePlan, (planesMap.get(nombrePlan) || 0) + 1);
            }
        });
        const rendimiento_planes = Array.from(planesMap, ([plan, cantidad]) => ({ plan, cantidad }))
                                        .sort((a, b) => b.cantidad - a.cantidad);

        const insights = [];
        if (totUtilidad > 0) insights.push({ tipo: 'positivo', texto: `El margen de utilidad neta se mantiene saludable en un ${margenUtilidad}%.` });
        else if (totUtilidad < 0) insights.push({ tipo: 'negativo', texto: `Alerta: Tus gastos superaron a tus ingresos en este periodo.` });

        const pctCrecimiento = calcularPorcentaje(totIngresos, antIngresos);
        if (pctCrecimiento > 0) insights.push({ tipo: 'positivo', texto: `Tus ingresos globales crecieron un ${pctCrecimiento}% respecto al periodo anterior.` });
        else if (pctCrecimiento < 0) insights.push({ tipo: 'negativo', texto: `Tus ingresos cayeron un ${Math.abs(pctCrecimiento)}% frente al periodo pasado.` });

        if (top_gastos.length > 0) insights.push({ tipo: 'neutral', texto: `Tu mayor gasto fue en la categoría '${top_gastos[0].categoria}' con $${top_gastos[0].monto.toLocaleString('en-US')}.` });
        if (rendimiento_planes.length > 0) insights.push({ tipo: 'neutral', texto: `Tu plan más popular fue '${rendimiento_planes[0].plan}' con ${rendimiento_planes[0].cantidad} ventas nuevas.` });

        const formatoFechaRango = `${fechaUTCADiaStr(gteActual)} a ${fechaUTCADiaStr(lteActual)}`;
        const barra_inferior = {
            periodo_texto: periodo,
            rango_fechas: formatoFechaRango,
            ingresos_totales: totIngresos,
            utilidad_neta: totUtilidad
        };

        res.status(200).json({
            message: "Reporte Financiero generado",
            filtros_aplicados: { periodo, tipo_reporte },
            data: { kpis_superiores, desglose_ingresos, tarjetas_detalle, top_gastos, rendimiento_planes, insights, barra_inferior }
        });

    } catch (error) {
        console.error("Error al obtener Resumen Financiero:", error);
        res.status(500).json({ error: "Error interno al calcular el reporte financiero." });
    }
};


// OBTENER DATOS PARA LA PESTAÑA DE "GRÁFICAS"
export const obtenerGraficasFinancieras = async (req, res) => {
    try {
        let { periodo, tipo_reporte, fecha_inicio, fecha_fin } = req.query;

        // ESCUDO ANTI-TYPOS (CASE INSENSITIVE)
        periodo = (periodo && mapaPeriodos[periodo.toLowerCase()]) || 'Este Mes';
        tipo_reporte = (tipo_reporte && mapaVistas[tipo_reporte.toLowerCase()]) || 'Reporte Completo';

        // A. LÓGICA DE FECHAS
        const { year, month, day } = ahoraEnMerida();
        let gteActual = localAUTC(year, month, day, 0, 0, 0, 0);
        let lteActual = localAUTC(year, month, day, 23, 59, 59, 999);

        switch (periodo) {
            case 'Hoy': break;
            case 'Esta Semana': {
                const jsDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
                const diaSemana = jsDay === 0 ? 7 : jsDay;
                gteActual = localAUTC(year, month, day - diaSemana + 1, 0, 0, 0, 0);
                break;
            }
            case 'Este Trimestre': {
                const mesTriStart = Math.floor((month - 1) / 3) * 3 + 1;
                gteActual = localAUTC(year, mesTriStart, 1, 0, 0, 0, 0);
                break;
            }
            case 'Este Semestre': {
                const mesSemStart = month <= 6 ? 1 : 7;
                gteActual = localAUTC(year, mesSemStart, 1, 0, 0, 0, 0);
                break;
            }
            case 'Este Ano':
                gteActual = localAUTC(year, 1, 1, 0, 0, 0, 0);
                break;
            case 'Personalizado':
                if (fecha_inicio && fecha_fin) {
                    gteActual = fechaStrAInicio(fecha_inicio);
                    lteActual = fechaStrAFin(fecha_fin);
                }
                break;
            case 'Este Mes':
            default:
                gteActual = localAUTC(year, month, 1, 0, 0, 0, 0);
                break;
        }

        // B. CONSULTAS A LA BD 
        const [movimientos, membresias] = await Promise.all([
            // ESCUDO GRÁFICAS: Ignoramos la apertura para no inflar la tendencia visual
            prisma.cajaMovimiento.findMany({ 
                where: { 
                    fecha: { gte: gteActual, lte: lteActual },
                    NOT: { concepto: { nombre: { contains: 'apertura', mode: 'insensitive' } } }
                },
                include: { concepto: true }
            }),
            prisma.membresiaSocio.findMany({ 
                where: { fechaInicio: { gte: gteActual, lte: lteActual } },
                include: { plan: true }
            })
        ]);

        // C. GRÁFICA DE TENDENCIA FINANCIERA (Línea Principal)
        const agruparPorMes = ['Este Ano', 'Este Semestre'].includes(periodo);
        const tendenciaMap = new Map();
        
        let iterador = new Date(gteActual);
        const limite = new Date(lteActual);

        if (agruparPorMes) {
            while (iterador <= limite) {
                const mesStr = fechaUTCAMesStr(iterador);
                tendenciaMap.set(mesStr, { ventas: 0, gastos: 0, membresias: 0, utilidad: 0 });
                iterador.setUTCMonth(iterador.getUTCMonth() + 1);
            }
        } else {
            while (iterador <= limite) {
                const diaStr = fechaUTCADiaStr(iterador);
                tendenciaMap.set(diaStr, { ventas: 0, gastos: 0, membresias: 0, utilidad: 0 });
                iterador.setUTCDate(iterador.getUTCDate() + 1);
            }
        }

        movimientos.forEach(mov => {
            const fechaClave = agruparPorMes ? fechaUTCAMesStr(mov.fecha) : fechaUTCADiaStr(mov.fecha);
            const monto = parseFloat(mov.monto);

            if (tendenciaMap.has(fechaClave)) {
                const diaData = tendenciaMap.get(fechaClave);
                
                if (mov.tipo === 'ingreso' && mov.referenciaTipo === 'venta') diaData.ventas += monto;
                if (mov.tipo === 'ingreso' && mov.referenciaTipo === 'membresia') diaData.membresias += monto;
                if (mov.tipo === 'gasto') diaData.gastos += monto;
                
                diaData.utilidad = (diaData.ventas + diaData.membresias) - diaData.gastos;
            }
        });

        let tendencia_financiera = Array.from(tendenciaMap, ([fecha, datos]) => {
            let resultado = { fecha };
            if (['Reporte Completo', 'Ventas'].includes(tipo_reporte)) resultado.ventas = datos.ventas;
            if (['Reporte Completo', 'Gastos'].includes(tipo_reporte)) resultado.gastos = datos.gastos;
            if (['Reporte Completo', 'Utilidad'].includes(tipo_reporte)) resultado.utilidad = datos.utilidad;
            if (['Reporte Completo', 'Membresias'].includes(tipo_reporte)) resultado.membresias = datos.membresias;
            return resultado;
        }).sort((a, b) => a.fecha.localeCompare(b.fecha));

        // D. GASTOS POR CATEGORÍA
        const gastosMap = new Map();
        movimientos.filter(m => m.tipo === 'gasto').forEach(mov => {
            const nombre = mov.concepto ? mov.concepto.nombre : 'Sin Categoría';
            gastosMap.set(nombre, (gastosMap.get(nombre) || 0) + parseFloat(mov.monto));
        });
        
        const gastos_por_categoria = {
            mostrar: ['Reporte Completo', 'Gastos'].includes(tipo_reporte),
            datos: Array.from(gastosMap, ([categoria, monto]) => ({ categoria, monto })).sort((a, b) => b.monto - a.monto)
        };

        // E. MEMBRESÍAS POR PLAN
        const planesMap = new Map();
        membresias.forEach(mem => {
            if(mem.plan) {
                const nombrePlan = mem.plan.nombre;
                const monto = parseFloat(mem.precioCongelado || 0);
                
                if (!planesMap.has(nombrePlan)) {
                    planesMap.set(nombrePlan, { cantidad: 0, ingresos: 0 });
                }
                const planData = planesMap.get(nombrePlan);
                planData.cantidad += 1;
                planData.ingresos += monto;
            }
        });

        const membresias_por_plan = {
            mostrar: ['Reporte Completo', 'Membresias'].includes(tipo_reporte),
            datos: Array.from(planesMap, ([plan, data]) => ({ plan, cantidad: data.cantidad, ingresos_generados: data.ingresos })).sort((a, b) => b.cantidad - a.cantidad)
        };

        // F. VENTAS VS GASTOS POR MES
        const ventas_vs_gastos = {
            mostrar: tipo_reporte === 'Reporte Completo',
            datos: Array.from(tendenciaMap, ([fecha, datos]) => ({
                fecha,
                ventas: datos.ventas,
                gastos: datos.gastos
            })).sort((a, b) => a.fecha.localeCompare(b.fecha))
        };

        res.status(200).json({
            message: "Datos de gráficas financieras generados",
            filtros_aplicados: { periodo, tipo_reporte },
            data: { tendencia_financiera, gastos_por_categoria, membresias_por_plan, ventas_vs_gastos }
        });

    } catch (error) {
        console.error("Error al obtener Gráficas Financieras:", error);
        res.status(500).json({ error: "Error interno al calcular las gráficas." });
    }
};
