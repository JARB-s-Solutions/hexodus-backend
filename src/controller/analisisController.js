import prisma from "../config/prisma.js";

// OBTENER DATOS PARA EL DASHBOARD DE ANÁLISIS
export const obtenerAnalisisVentas = async (req, res) => {
    try {
        const { periodo } = req.query; // 'Este Mes', 'Mes Pasado', 'Este Año', etc.

        // 1. Determinar las Fechas del "Periodo Actual" y el "Periodo Anterior"
        const hoy = new Date();
        let gteActual = new Date(hoy);
        let lteActual = new Date(hoy);
        let gteAnterior = new Date(hoy);
        let lteAnterior = new Date(hoy);

        // Inicializamos todo al día de hoy desde las 00:00 hasta las 23:59
        gteActual.setHours(0, 0, 0, 0);
        lteActual.setHours(23, 59, 59, 999);
        gteAnterior.setHours(0, 0, 0, 0);
        lteAnterior.setHours(23, 59, 59, 999);

        // Lógica de fechas según el periodo seleccionado
        switch (periodo) {
            case 'Hoy':
                // Actual: Hoy | Anterior: Ayer
                gteAnterior.setDate(gteAnterior.getDate() - 1);
                lteAnterior.setDate(lteAnterior.getDate() - 1);
                break;

            case 'Ayer':
                // Actual: Ayer | Anterior: Antier (hace 2 días)
                gteActual.setDate(gteActual.getDate() - 1);
                lteActual.setDate(lteActual.getDate() - 1);

                gteAnterior.setDate(gteAnterior.getDate() - 2);
                lteAnterior.setDate(lteAnterior.getDate() - 2);
                break;

            case 'Esta Semana':
                // Actual: Lunes a Domingo de esta semana | Anterior: Semana pasada
                const diaSemana = gteActual.getDay() || 7; // 1-Lunes, 7-Domingo
                gteActual.setDate(gteActual.getDate() - diaSemana + 1);
                
                gteAnterior = new Date(gteActual);
                gteAnterior.setDate(gteAnterior.getDate() - 7);
                lteAnterior = new Date(gteAnterior);
                lteAnterior.setDate(lteAnterior.getDate() + 6);
                lteAnterior.setHours(23, 59, 59, 999);
                break;

            case 'Mes Pasado':
                // Actual: Mes anterior completo | Anterior: Hace 2 meses
                gteActual.setMonth(gteActual.getMonth() - 1, 1);
                lteActual = new Date(gteActual.getFullYear(), gteActual.getMonth() + 1, 0);
                lteActual.setHours(23, 59, 59, 999);

                gteAnterior.setMonth(gteAnterior.getMonth() - 2, 1);
                lteAnterior = new Date(gteAnterior.getFullYear(), gteAnterior.getMonth() + 1, 0);
                lteAnterior.setHours(23, 59, 59, 999);
                break;

            case 'Este Trimestre':
                // Actual: Inicio del trimestre actual | Anterior: Trimestre anterior
                const mesTrimestre = Math.floor(gteActual.getMonth() / 3) * 3;
                gteActual.setMonth(mesTrimestre, 1);

                gteAnterior.setMonth(mesTrimestre - 3, 1);
                lteAnterior = new Date(gteAnterior.getFullYear(), gteAnterior.getMonth() + 3, 0);
                lteAnterior.setHours(23, 59, 59, 999);
                break;

            case 'Este Semestre':
                // Actual: Semestre 1 o 2 | Anterior: Semestre anterior
                const mesSemestre = gteActual.getMonth() < 6 ? 0 : 6;
                gteActual.setMonth(mesSemestre, 1);

                gteAnterior.setMonth(mesSemestre - 6, 1);
                lteAnterior = new Date(gteAnterior.getFullYear(), gteAnterior.getMonth() + 6, 0);
                lteAnterior.setHours(23, 59, 59, 999);
                break;

            case 'Este Año':
                // Actual: 1 Ene - 31 Dic | Anterior: Año pasado
                gteActual.setMonth(0, 1);
                
                gteAnterior.setFullYear(gteAnterior.getFullYear() - 1, 0, 1);
                lteAnterior.setFullYear(lteAnterior.getFullYear(), 11, 31);
                lteAnterior.setHours(23, 59, 59, 999);
                break;

            case 'Año Pasado':
                // Actual: Año pasado | Anterior: Hace 2 años
                gteActual.setFullYear(gteActual.getFullYear() - 1, 0, 1);
                lteActual.setFullYear(lteActual.getFullYear(), 11, 31);
                lteActual.setHours(23, 59, 59, 999);

                gteAnterior.setFullYear(gteAnterior.getFullYear() - 2, 0, 1);
                lteAnterior.setFullYear(lteAnterior.getFullYear(), 11, 31);
                lteAnterior.setHours(23, 59, 59, 999);
                break;

            case 'Este Mes':
            default:
                // Actual: Día 1 a hoy | Anterior: Mismos días pero del mes pasado
                gteActual.setDate(1); 
                
                gteAnterior.setMonth(gteAnterior.getMonth() - 1, 1); 
                lteAnterior.setDate(0); 
                lteAnterior.setHours(23, 59, 59, 999);
                break;
        }

        // EJECUCIÓN PARALELA (Consultas pesadas al mismo tiempo)
        const [ventasActuales, ventasAnteriores, topProductos, metodosPagoRaw] = await Promise.all([
            // Ventas del periodo actual
            prisma.venta.findMany({
                where: { isDeleted: false, status: 'exitosa', fechaVenta: { gte: gteActual, lte: lteActual } },
                include: { detalles: true }
            }),
            
            // Ventas del periodo anterior (Para la comparación)
            prisma.venta.findMany({
                where: { isDeleted: false, status: 'exitosa', fechaVenta: { gte: gteAnterior, lte: lteAnterior } }
            }),

            // Top Productos Vendidos (Agrupación por ID de producto)
            prisma.ventaDetalle.groupBy({
                by: ['productoId', 'nombreProducto'],
                where: {
                    venta: { isDeleted: false, status: 'exitosa', fechaVenta: { gte: gteActual, lte: lteActual } }
                },
                _sum: { cantidad: true, subtotalLinea: true },
                orderBy: { _sum: { cantidad: 'desc' } },
                take: 5 // Solo queremos el Top 5
            }),

            // Métodos de Pago más usados
            prisma.ventaPago.groupBy({
                by: ['metodoPagoId'],
                where: {
                    venta: { isDeleted: false, status: 'exitosa', fechaVenta: { gte: gteActual, lte: lteActual } }
                },
                _count: { _all: true },
                _sum: { monto: true }
            })
        ]);

        // PROCESAMIENTO MATEMÁTICO (Armando la Respuesta)

        // Bloque 1: Comparación Actual
        const totalActual = ventasActuales.reduce((acc, v) => acc + parseFloat(v.total), 0);
        const txnsActuales = ventasActuales.length;
        
        const totalAnterior = ventasAnteriores.reduce((acc, v) => acc + parseFloat(v.total), 0);
        const txnsAnteriores = ventasAnteriores.length;

        let pctVariacion = 0;
        if (totalAnterior > 0) {
            pctVariacion = ((totalActual - totalAnterior) / totalAnterior) * 100;
        } else if (totalActual > 0) {
            pctVariacion = 100; // Crecimiento infinito desde 0
        }

        const comparacion_actual = {
            actual: { total: totalActual, transacciones: txnsActuales },
            anterior: { total: totalAnterior, transacciones: txnsAnteriores },
            variacion_porcentaje: Number(pctVariacion.toFixed(1))
        };

        // Bloque 2: Tendencia de Ventas (Relleno de Serie Temporal para gráficas continuas)
        const tendenciaMap = new Map();
        
        // Determinar si agrupamos por Mes (para periodos anuales) o por Día
        const agruparPorMes = ['Este Año', 'Año Pasado'].includes(periodo);

        // 1. Crear el calendario vacío (Padding) desde el inicio hasta el fin del periodo
        let fechaIterador = new Date(gteActual);
        const fechaLimite = new Date(lteActual);

        if (agruparPorMes) {
            // Rellena los 12 meses
            while (fechaIterador <= fechaLimite) {
                const mesStr = fechaIterador.toISOString().slice(0, 7); // Ej: "2026-01"
                tendenciaMap.set(mesStr, 0);
                fechaIterador.setMonth(fechaIterador.getMonth() + 1);
            }
        } else {
            // Rellena día por día
            while (fechaIterador <= fechaLimite) {
                const diaStr = fechaIterador.toISOString().split('T')[0]; // Ej: "2026-03-01"
                tendenciaMap.set(diaStr, 0);
                fechaIterador.setDate(fechaIterador.getDate() + 1);
            }
        }

        // 2. Inyectar las ventas reales en el calendario
        ventasActuales.forEach(v => {
            let claveFecha = "";
            if (agruparPorMes) {
                claveFecha = v.fechaVenta.toISOString().slice(0, 7); 
            } else {
                claveFecha = v.fechaVenta.toISOString().split('T')[0];
            }
            
            // Si la fecha existe en el mapa, le sumamos la venta; si no, la creamos (por seguridad de zona horaria)
            if (tendenciaMap.has(claveFecha)) {
                tendenciaMap.set(claveFecha, tendenciaMap.get(claveFecha) + parseFloat(v.total));
            } else {
                tendenciaMap.set(claveFecha, parseFloat(v.total));
            }
        });
        
        // 3. Convertir el mapa a un arreglo ordenado que el Frontend pueda graficar
        const tendencia_ventas = Array.from(tendenciaMap, ([fecha, total]) => ({ fecha, total }))
                                      .sort((a, b) => a.fecha.localeCompare(b.fecha));

        // Bloque 3: Top Productos
        // Buscamos el producto más vendido para los Insights
        let productoMasVendidoNombre = "Ninguno";
        let productoMasVendidoCantidad = 0;

        const top_productos = topProductos.map(tp => {
            const cant = tp._sum.cantidad || 0;
            if (cant > productoMasVendidoCantidad) {
                productoMasVendidoCantidad = cant;
                productoMasVendidoNombre = tp.nombreProducto;
            }
            return {
                nombre: tp.nombreProducto,
                cantidad_vendida: cant,
                ingreso_generado: parseFloat(tp._sum.subtotalLinea || 0)
            };
        });

        // Bloque 4: Métodos de Pago (Gráfico de Dona) 
        // Como Prisma devuelve IDs, necesitamos cruzarlo con el catálogo real
        const metodosCatalogo = await prisma.metodoPago.findMany();
        let metodoPagoMasUsadoNombre = "Ninguno";
        let metodoPagoMasUsadoTxns = 0;

        const metodos_pago = metodosPagoRaw.map(mp => {
            const nombre = metodosCatalogo.find(c => c.id === mp.metodoPagoId)?.nombre || 'Desconocido';
            const txns = mp._count._all;
            
            if (txns > metodoPagoMasUsadoTxns) {
                metodoPagoMasUsadoTxns = txns;
                metodoPagoMasUsadoNombre = nombre;
            }

            return {
                nombre: nombre,
                transacciones: txns,
                monto_total: parseFloat(mp._sum.monto || 0)
            };
        });

        // Bloque 5: Insights de Ventas (Textos Inteligentes)
        const ticketPromedio = txnsActuales > 0 ? (totalActual / txnsActuales) : 0;
        
        const insights = [
            `El producto mas vendido es "${productoMasVendidoNombre}" con ${productoMasVendidoCantidad} unidades.`,
            `El metodo de pago mas usado es ${metodoPagoMasUsadoNombre} con ${metodoPagoMasUsadoTxns} transacciones.`,
            `Ticket promedio: $${ticketPromedio.toFixed(2)}.`
        ];

        // RETORNAR EL SUPER JSON 
        res.status(200).json({
            message: "Datos de análisis obtenidos",
            data: {
                comparacion_actual,
                tendencia_ventas,
                top_productos,
                metodos_pago,
                insights
            }
        });

    } catch (error) {
        console.error("Error al obtener análisis:", error);
        res.status(500).json({ error: "Error interno al procesar los datos analíticos." });
    }
};