import prisma from "../config/prisma.js";

// OBTENER RESUMEN FINANCIERO (Dashboard)
export const obtenerResumenFinanciero = async (req, res) => {
    try {
        const { periodo, fecha_inicio, fecha_fin, tipo_reporte } = req.query;

        // A. LÓGICA DE FECHAS (Actual vs Anterior)
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

        // B. CONSULTAS A LA BASE DE DATOS (En Paralelo)
        const [
            ingresosActual, gastosActual, membresiasActual, ventasActual,
            ingresosAnterior, gastosAnterior, membresiasAnterior,
            sociosActivos, transaccionesVentas, transaccionesGastos
        ] = await Promise.all([
            // MONTOS ACTUALES
            prisma.cajaMovimiento.aggregate({ where: { tipo: 'ingreso', fecha: { gte: gteActual, lte: lteActual } }, _sum: { monto: true } }),
            prisma.cajaMovimiento.aggregate({ where: { tipo: 'gasto', fecha: { gte: gteActual, lte: lteActual } }, _sum: { monto: true } }),
            prisma.cajaMovimiento.aggregate({ where: { tipo: 'ingreso', referenciaTipo: 'membresia', fecha: { gte: gteActual, lte: lteActual } }, _sum: { monto: true } }),
            prisma.cajaMovimiento.aggregate({ where: { tipo: 'ingreso', referenciaTipo: 'venta', fecha: { gte: gteActual, lte: lteActual } }, _sum: { monto: true } }),
            
            // MONTOS ANTERIORES (Para % de variacion)
            prisma.cajaMovimiento.aggregate({ where: { tipo: 'ingreso', fecha: { gte: gteAnterior, lte: lteAnterior } }, _sum: { monto: true } }),
            prisma.cajaMovimiento.aggregate({ where: { tipo: 'gasto', fecha: { gte: gteAnterior, lte: lteAnterior } }, _sum: { monto: true } }),
            prisma.cajaMovimiento.aggregate({ where: { tipo: 'ingreso', referenciaTipo: 'membresia', fecha: { gte: gteAnterior, lte: lteAnterior } }, _sum: { monto: true } }),

            // CONTEOS EXTRA PARA LAS TARJETAS DE DETALLE
            prisma.membresiaSocio.count({ where: { status: 'activa', fechaFin: { gte: new Date() } } }),
            prisma.cajaMovimiento.count({ where: { tipo: 'ingreso', referenciaTipo: 'venta', fecha: { gte: gteActual, lte: lteActual } } }),
            prisma.cajaMovimiento.count({ where: { tipo: 'gasto', fecha: { gte: gteActual, lte: lteActual } } })
        ]);

        // C. MATEMÁTICAS Y LIMPIEZA DE DATOS
        const parseTotal = (ag) => ag._sum.monto ? parseFloat(ag._sum.monto) : 0;
        const calcularPorcentaje = (actual, anterior) => {
            if (anterior === 0) return actual > 0 ? 100 : 0;
            return Number((((actual - anterior) / Math.abs(anterior)) * 100).toFixed(1));
        };

        // Totales Período Actual
        const totIngresos = parseTotal(ingresosActual);
        const totGastos = parseTotal(gastosActual);
        const totUtilidad = totIngresos - totGastos;
        const totMembresias = parseTotal(membresiasActual);
        const totVentas = parseTotal(ventasActual); // OtotIngresos - totMembresias

        // Totales Período Anterior
        const antIngresos = parseTotal(ingresosAnterior);
        const antGastos = parseTotal(gastosAnterior);
        const antUtilidad = antIngresos - antGastos;
        const antMembresias = parseTotal(membresiasAnterior);

        // D. CONSTRUCCIÓN DEL JSON POR SECCIONES
        
        // SECCIÓN 1: KPIs SUPERIORES (Estáticos, nunca se filtran)
        const kpis_superiores = {
            ingresos: { total: totIngresos, porcentaje: calcularPorcentaje(totIngresos, antIngresos) },
            gastos: { total: totGastos, porcentaje: calcularPorcentaje(totGastos, antGastos) },
            utilidad_neta: { total: totUtilidad, porcentaje: calcularPorcentaje(totUtilidad, antUtilidad) },
            membresias: { total: totMembresias, porcentaje: calcularPorcentaje(totMembresias, antMembresias), socios_activos: sociosActivos }
        };

        // SECCIÓN 2: DESGLOSE DE INGRESOS (Gráfica de Dona)
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

        // SECCIÓN 3: TARJETAS DE DETALLE (Dinámicas según el filtro)
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

        // E. RESPUESTA FINAL
        res.status(200).json({
            message: "Reporte Financiero generado",
            filtros_aplicados: { periodo, tipo_reporte: tipo_reporte || 'Reporte Completo' },
            data: {
                kpis_superiores,
                desglose_ingresos,
                tarjetas_detalle
            }
        });

    } catch (error) {
        console.error("Error al obtener Resumen Financiero:", error);
        res.status(500).json({ error: "Error interno al calcular el reporte financiero." });
    }
};