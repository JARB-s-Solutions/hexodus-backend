import prisma from "../config/prisma.js";
import { ahoraEnMerida, localAUTC, fechaUTCADiaStr, fechaUTCAMesStr } from "../utils/timezone.js";

// OBTENER DATOS PARA EL DASHBOARD DE ANÁLISIS
export const obtenerAnalisisVentas = async (req, res) => {
    try {
        const { periodo } = req.query; // 'Este Mes', 'Mes Pasado', 'Este Año', etc.

        // 1. Determinar las Fechas del "Periodo Actual" y el "Periodo Anterior"
        const { year, month, day } = ahoraEnMerida();

        let gteActual  = localAUTC(year, month, day, 0, 0, 0, 0);
        let lteActual  = localAUTC(year, month, day, 23, 59, 59, 999);
        let gteAnterior = localAUTC(year, month, day, 0, 0, 0, 0);
        let lteAnterior = localAUTC(year, month, day, 23, 59, 59, 999);

        // Lógica de fechas según el periodo seleccionado
        switch (periodo) {
            case 'Hoy':
                // Actual: Hoy | Anterior: Ayer
                gteAnterior = localAUTC(year, month, day - 1, 0, 0, 0, 0);
                lteAnterior = localAUTC(year, month, day - 1, 23, 59, 59, 999);
                break;

            case 'Ayer':
                // Actual: Ayer | Anterior: Antier (hace 2 días)
                gteActual   = localAUTC(year, month, day - 1, 0, 0, 0, 0);
                lteActual   = localAUTC(year, month, day - 1, 23, 59, 59, 999);
                gteAnterior = localAUTC(year, month, day - 2, 0, 0, 0, 0);
                lteAnterior = localAUTC(year, month, day - 2, 23, 59, 59, 999);
                break;

            case 'Esta Semana': {
                // Actual: Lunes a Domingo de esta semana | Anterior: Semana pasada
                const jsDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
                const offset = jsDay === 0 ? 6 : jsDay - 1; // días desde el lunes
                gteActual   = localAUTC(year, month, day - offset, 0, 0, 0, 0);
                gteAnterior = localAUTC(year, month, day - offset - 7, 0, 0, 0, 0);
                lteAnterior = localAUTC(year, month, day - offset - 1, 23, 59, 59, 999);
                break;
            }

            case 'Mes Pasado':
                // Actual: Mes anterior completo | Anterior: Hace 2 meses
                gteActual   = localAUTC(year, month - 1, 1, 0, 0, 0, 0);
                lteActual   = localAUTC(year, month, 0, 23, 59, 59, 999);  // día 0 = último del mes anterior
                gteAnterior = localAUTC(year, month - 2, 1, 0, 0, 0, 0);
                lteAnterior = localAUTC(year, month - 1, 0, 23, 59, 59, 999);
                break;

            case 'Este Trimestre': {
                // Actual: Inicio del trimestre actual | Anterior: Trimestre anterior
                const mesTriStart = Math.floor((month - 1) / 3) * 3 + 1;
                gteActual   = localAUTC(year, mesTriStart, 1, 0, 0, 0, 0);
                gteAnterior = localAUTC(year, mesTriStart - 3, 1, 0, 0, 0, 0);
                lteAnterior = localAUTC(year, mesTriStart, 0, 23, 59, 59, 999);
                break;
            }

            case 'Este Semestre': {
                // Actual: Semestre 1 o 2 | Anterior: Semestre anterior
                const mesSemStart = month <= 6 ? 1 : 7;
                gteActual   = localAUTC(year, mesSemStart, 1, 0, 0, 0, 0);
                gteAnterior = localAUTC(year, mesSemStart - 6, 1, 0, 0, 0, 0);
                lteAnterior = localAUTC(year, mesSemStart, 0, 23, 59, 59, 999);
                break;
            }

            case 'Este Año':
                // Actual: 1 Ene - 31 Dic | Anterior: Año pasado
                gteActual   = localAUTC(year, 1, 1, 0, 0, 0, 0);
                gteAnterior = localAUTC(year - 1, 1, 1, 0, 0, 0, 0);
                lteAnterior = localAUTC(year - 1, 12, 31, 23, 59, 59, 999);
                break;

            case 'Año Pasado':
                // Actual: Año pasado | Anterior: Hace 2 años
                gteActual   = localAUTC(year - 1, 1, 1, 0, 0, 0, 0);
                lteActual   = localAUTC(year - 1, 12, 31, 23, 59, 59, 999);
                gteAnterior = localAUTC(year - 2, 1, 1, 0, 0, 0, 0);
                lteAnterior = localAUTC(year - 2, 12, 31, 23, 59, 59, 999);
                break;

            case 'Este Mes':
            default:
                // Actual: Día 1 a hoy | Anterior: Mismos días pero del mes pasado
                gteActual   = localAUTC(year, month, 1, 0, 0, 0, 0);
                gteAnterior = localAUTC(year, month - 1, 1, 0, 0, 0, 0);
                lteAnterior = localAUTC(year, month, 0, 23, 59, 59, 999);
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
                const mesStr = fechaUTCAMesStr(fechaIterador); // Ej: "2026-01" en zona Mérida
                tendenciaMap.set(mesStr, 0);
                fechaIterador.setUTCMonth(fechaIterador.getUTCMonth() + 1);
            }
        } else {
            // Rellena día por día
            while (fechaIterador <= fechaLimite) {
                const diaStr = fechaUTCADiaStr(fechaIterador); // Ej: "2026-03-01" en zona Mérida
                tendenciaMap.set(diaStr, 0);
                fechaIterador.setUTCDate(fechaIterador.getUTCDate() + 1);
            }
        }

        // 2. Inyectar las ventas reales en el calendario
        ventasActuales.forEach(v => {
            let claveFecha = agruparPorMes
                ? fechaUTCAMesStr(v.fechaVenta)
                : fechaUTCADiaStr(v.fechaVenta);
            
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