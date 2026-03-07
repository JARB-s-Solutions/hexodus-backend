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

const mapaVistas = {
    'reporte completo': 'Reporte Completo',
    'ventas': 'Ventas',
    'gastos': 'Gastos',
    'utilidad': 'Utilidad',
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
        const hoy = new Date();
        let gteActual = new Date(hoy), lteActual = new Date(hoy);
        let gteAnterior = new Date(hoy), lteAnterior = new Date(hoy);

        gteActual.setHours(0, 0, 0, 0); lteActual.setHours(23, 59, 59, 999);
        gteAnterior.setHours(0, 0, 0, 0); lteAnterior.setHours(23, 59, 59, 999);

        switch (periodo) {
            case 'Hoy':
                gteAnterior.setDate(gteAnterior.getDate() - 1); lteAnterior.setDate(lteAnterior.getDate() - 1);
                break;
            case 'Esta Semana':
                const diaSemana = gteActual.getDay() || 7;
                gteActual.setDate(gteActual.getDate() - diaSemana + 1);
                gteAnterior = new Date(gteActual); gteAnterior.setDate(gteAnterior.getDate() - 7);
                lteAnterior = new Date(gteActual); lteAnterior.setDate(lteAnterior.getDate() - 1);
                lteAnterior.setHours(23, 59, 59, 999);
                break;
            case 'Este Trimestre':
                const mesTrimestre = Math.floor(gteActual.getMonth() / 3) * 3;
                gteActual.setMonth(mesTrimestre, 1);
                gteAnterior.setMonth(mesTrimestre - 3, 1);
                lteAnterior = new Date(gteAnterior.getFullYear(), gteAnterior.getMonth() + 3, 0);
                lteAnterior.setHours(23, 59, 59, 999);
                break;
            case 'Este Semestre':
                const mesSemestre = gteActual.getMonth() < 6 ? 0 : 6;
                gteActual.setMonth(mesSemestre, 1);
                gteAnterior.setMonth(mesSemestre - 6, 1);
                lteAnterior = new Date(gteAnterior.getFullYear(), gteAnterior.getMonth() + 6, 0);
                lteAnterior.setHours(23, 59, 59, 999);
                break;
            case 'Este Ano': 
                gteActual.setMonth(0, 1);
                gteAnterior.setFullYear(gteAnterior.getFullYear() - 1, 0, 1);
                lteAnterior.setFullYear(lteAnterior.getFullYear() - 1, 11, 31);
                break;
            case 'Personalizado':
                if (fecha_inicio && fecha_fin) {
                    gteActual = new Date(`${fecha_inicio}T00:00:00.000Z`); lteActual = new Date(`${fecha_fin}T23:59:59.999Z`);
                    const diffTime = Math.abs(lteActual - gteActual);
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                    gteAnterior = new Date(gteActual); gteAnterior.setDate(gteAnterior.getDate() - diffDays);
                    lteAnterior = new Date(gteActual); lteAnterior.setDate(lteAnterior.getDate() - 1);
                    lteAnterior.setHours(23, 59, 59, 999);
                }
                break;
            case 'Este Mes':
            default:
                gteActual.setDate(1);
                gteAnterior.setMonth(gteAnterior.getMonth() - 1, 1);
                lteAnterior.setDate(0); 
                break;
        }

        // B. CONSULTAS A LA BD
        const [
            ingresosActual, gastosActual, membresiasActual, ventasActual,
            ingresosAnterior, gastosAnterior, membresiasAnterior,
            sociosActivos, transaccionesVentas, transaccionesGastos,
            movimientosGastos, membresiasPeriodo
        ] = await Promise.all([
            prisma.cajaMovimiento.aggregate({ where: { tipo: 'ingreso', fecha: { gte: gteActual, lte: lteActual } }, _sum: { monto: true } }),
            prisma.cajaMovimiento.aggregate({ where: { tipo: 'gasto', fecha: { gte: gteActual, lte: lteActual } }, _sum: { monto: true } }),
            prisma.cajaMovimiento.aggregate({ where: { tipo: 'ingreso', referenciaTipo: 'membresia', fecha: { gte: gteActual, lte: lteActual } }, _sum: { monto: true } }),
            prisma.cajaMovimiento.aggregate({ where: { tipo: 'ingreso', referenciaTipo: 'venta', fecha: { gte: gteActual, lte: lteActual } }, _sum: { monto: true } }),
            
            prisma.cajaMovimiento.aggregate({ where: { tipo: 'ingreso', fecha: { gte: gteAnterior, lte: lteAnterior } }, _sum: { monto: true } }),
            prisma.cajaMovimiento.aggregate({ where: { tipo: 'gasto', fecha: { gte: gteAnterior, lte: lteAnterior } }, _sum: { monto: true } }),
            prisma.cajaMovimiento.aggregate({ where: { tipo: 'ingreso', referenciaTipo: 'membresia', fecha: { gte: gteAnterior, lte: lteAnterior } }, _sum: { monto: true } }),

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
                ventas: { total: totVentas, porcentaje_grafica: Number(pctVentas), porcentaje_vs_anterior: calcularPorcentaje(totVentas, antIngresos - antMembresias) },
                membresias: { total: totMembresias, porcentaje_grafica: Number(pctMembresias), porcentaje_vs_anterior: calcularPorcentaje(totMembresias, antMembresias) }
            }
        };

        const margenUtilidad = totIngresos > 0 ? ((totUtilidad / totIngresos) * 100).toFixed(1) : 0;

        const tarjetas_detalle = {
            ventas: {
                mostrar: ['Reporte Completo', 'Ventas'].includes(tipo_reporte),
                total: totVentas, transacciones: transaccionesVentas,
                porcentaje_vs_anterior: calcularPorcentaje(totVentas, antIngresos - antMembresias),
                anterior_texto: `$${(antIngresos - antMembresias).toLocaleString('en-US')}`
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

        const formatoFechaRango = `${gteActual.toISOString().split('T')[0]} a ${lteActual.toISOString().split('T')[0]}`;
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
        const hoy = new Date();
        let gteActual = new Date(hoy), lteActual = new Date(hoy);

        gteActual.setHours(0, 0, 0, 0); lteActual.setHours(23, 59, 59, 999);

        switch (periodo) {
            case 'Hoy': break;
            case 'Esta Semana':
                const diaSemana = gteActual.getDay() || 7;
                gteActual.setDate(gteActual.getDate() - diaSemana + 1);
                break;
            case 'Este Trimestre':
                const mesTrimestre = Math.floor(gteActual.getMonth() / 3) * 3;
                gteActual.setMonth(mesTrimestre, 1);
                break;
            case 'Este Semestre':
                const mesSemestre = gteActual.getMonth() < 6 ? 0 : 6;
                gteActual.setMonth(mesSemestre, 1);
                break;
            case 'Este Ano': 
                gteActual.setMonth(0, 1);
                break;
            case 'Personalizado':
                if (fecha_inicio && fecha_fin) {
                    gteActual = new Date(`${fecha_inicio}T00:00:00.000Z`); 
                    lteActual = new Date(`${fecha_fin}T23:59:59.999Z`);
                }
                break;
            case 'Este Mes':
            default:
                gteActual.setDate(1);
                break;
        }

        // B. CONSULTAS A LA BD 
        const [movimientos, membresias] = await Promise.all([
            prisma.cajaMovimiento.findMany({ 
                where: { fecha: { gte: gteActual, lte: lteActual } },
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
                const mesStr = iterador.toISOString().slice(0, 7); 
                tendenciaMap.set(mesStr, { ventas: 0, gastos: 0, membresias: 0, utilidad: 0 });
                iterador.setMonth(iterador.getMonth() + 1);
            }
        } else {
            while (iterador <= limite) {
                const diaStr = iterador.toISOString().split('T')[0];
                tendenciaMap.set(diaStr, { ventas: 0, gastos: 0, membresias: 0, utilidad: 0 });
                iterador.setDate(iterador.getDate() + 1);
            }
        }

        movimientos.forEach(mov => {
            const fechaClave = agruparPorMes ? mov.fecha.toISOString().slice(0, 7) : mov.fecha.toISOString().split('T')[0];
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