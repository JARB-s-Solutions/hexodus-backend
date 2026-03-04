import prisma from "../config/prisma.js";

// ABRIR CAJA (Fondo inicial) 
export const abrirCaja = async (req, res) => {
    try {
        const { monto_inicial } = req.body;

        // Verificar si ya hay una caja abierta
        const cajaAbierta = await prisma.corteCaja.findFirst({
            where: { status: 'abierto' }
        });

        if (cajaAbierta) {
            return res.status(400).json({ error: "Ya existe un turno de caja abierto. Debes cerrarlo primero." });
        }

        // Verificar que el concepto base exista ANTES de mover nada
        const conceptoApertura = await prisma.concepto.findFirst({
            where: { nombre: { equals: 'Apertura / Fondo de Caja', mode: 'insensitive' } }
        });

        if (!conceptoApertura) {
            return res.status(400).json({ 
                error: "El concepto 'Apertura / Fondo de Caja' no existe en el catálogo. Pídele al administrador que lo cree antes de intentar abrir la caja." 
            });
        }

        // Transacción para crear el Corte y el Movimiento inicial
        const resultado = await prisma.$transaction(async (tx) => {
            
            // Crear la sesión de caja
            const nuevoCorte = await tx.corteCaja.create({
                data: {
                    usuarioId: req.user.id,
                    inicio: new Date(),
                    fin: new Date(), // Se actualizará al cerrar
                    status: 'abierto',
                    totalVentas: 0
                }
            });

            // Registrar el ingreso del "Fondo de Caja" (Si declararon dinero)
            if (monto_inicial && parseFloat(monto_inicial) > 0) {
                await tx.cajaMovimiento.create({
                    data: {
                        corteId: nuevoCorte.id,
                        usuarioId: req.user.id,
                        conceptoId: conceptoApertura.id, // Usamos el ID del concepto que ya confirmamos que existe
                        tipo: 'ingreso',
                        monto: parseFloat(monto_inicial),
                        referenciaTipo: 'otro',
                        nota: 'Fondo de caja inicial'
                    }
                });
            }

            return nuevoCorte;
        });

        res.status(201).json({
            message: "Caja abierta exitosamente.",
            data: { corte_id: resultado.id, fecha_apertura: resultado.inicio }
        });

    } catch (error) {
        console.error("Error al abrir caja:", error);
        res.status(500).json({ error: "Error interno al abrir la caja." });
    }
};

// CONSULTAR MOVIMIENTOS
export const consultarCorte = async (req, res) => {
    try {
        const { fecha_inicial, fecha_final } = req.body; 

        if (!fecha_inicial || !fecha_final) {
            return res.status(400).json({ error: "Debes enviar el rango de fechas." });
        }

        const inicio = new Date(fecha_inicial);
        const fin = new Date(fecha_final);

        // Buscar la caja abierta actual para sacar su fondo inicial
        const cajaAbierta = await prisma.corteCaja.findFirst({
            where: { status: 'abierto' },
            include: { movimientos: { include: { concepto: true } } }
        });

        // Buscar TODOS los movimientos en ese rango de fechas 
        // (Atrapamos los que hicimos en Ventas y Compras que aún no tienen corteId)
        const movimientos = await prisma.cajaMovimiento.findMany({
            where: {
                fecha: { gte: inicio, lte: fin },
                OR: [
                    { corteId: null }, // Movimientos huérfanos (ventas/compras)
                    { corteId: cajaAbierta ? cajaAbierta.id : -1 } // O los que ya son de esta caja
                ]
            },
            include: { concepto: true, usuario: { select: { nombreCompleto: true } } },
            orderBy: { fecha: 'asc' }
        });

        // Calcular la matemática para tus 4 tarjetas
        let totalIngresos = 0;
        let totalEgresos = 0;
        let efectivoInicial = 0;

        // Extraer el fondo inicial (si existe en la caja abierta)
        if (cajaAbierta) {
            const movApertura = cajaAbierta.movimientos.find(m => m.concepto.nombre === 'Apertura / Fondo de Caja');
            if (movApertura) efectivoInicial = parseFloat(movApertura.monto);
        }

        const desgloseMovimientos = movimientos.map(mov => {
            const monto = parseFloat(mov.monto);
            
            // Si no es el fondo de caja, lo sumamos a los ingresos o egresos "operativos"
            if (mov.concepto.nombre !== 'Apertura / Fondo de Caja') {
                if (mov.tipo === 'ingreso') totalIngresos += monto;
                if (mov.tipo === 'gasto') totalEgresos += monto;
            }

            return {
                id: mov.id,
                fecha: mov.fecha,
                concepto: mov.concepto.nombre,
                tipo: mov.tipo,
                monto: monto,
                usuario: mov.usuario.nombreCompleto
            };
        });

        const efectivoFinal = (efectivoInicial + totalIngresos) - totalEgresos;

        res.status(200).json({
            message: "Consulta generada correctamente",
            resumen: {
                total_ingresos: totalIngresos,
                total_egresos: totalEgresos,
                efectivo_inicial: efectivoInicial,
                efectivo_final: efectivoFinal
            },
            movimientos: desgloseMovimientos // Para llenar la tabla que pondrás abajo del buscador
        });

    } catch (error) {
        console.error("Error al consultar corte:", error);
        res.status(500).json({ error: "Error interno al consultar los movimientos." });
    }
};


// REALIZAR CORTE DE CAJA
export const realizarCorte = async (req, res) => {
    try {
        const { fecha_inicial, fecha_final, observacion } = req.body;

        const cajaAbierta = await prisma.corteCaja.findFirst({
            where: { status: 'abierto' }
        });

        if (!cajaAbierta) {
            return res.status(400).json({ error: "No hay ninguna caja abierta para cerrar." });
        }

        const inicio = new Date(fecha_inicial);
        const fin = new Date(fecha_final);

        // Transacción Maestra con tiempo extendido por si hay cientos de ventas
        const resultado = await prisma.$transaction(async (tx) => {
            
            // Obtener los movimientos flotantes solo para calcular la suma matemática
            const movimientosFlotantes = await tx.cajaMovimiento.findMany({
                where: {
                    fecha: { gte: inicio, lte: fin },
                    corteId: null
                }
            });

            let sumaVentas = 0;
            movimientosFlotantes.forEach(mov => {
                if (mov.tipo === 'ingreso') {
                    sumaVentas += parseFloat(mov.monto);
                }
            });

            // ACTUALIZACIÓN MASIVA (Súper rápida): Amarrar todos los movimientos de golpe
            await tx.cajaMovimiento.updateMany({
                where: {
                    fecha: { gte: inicio, lte: fin },
                    corteId: null
                },
                data: { corteId: cajaAbierta.id }
            });

            // Cerrar el Corte Oficialmente
            const corteCerrado = await tx.corteCaja.update({
                where: { id: cajaAbierta.id },
                data: {
                    fin: new Date(), // Se sella con la hora actual exacta
                    status: 'cerrado',
                    totalVentas: sumaVentas,
                    observaciones: observacion || null
                }
            });

            return corteCerrado;
        }, {
            maxWait: 5000,   // Tiempo para conectarse
            timeout: 20000   // Le damos 20 segundos para procesar en lugar de los 5 por defecto
        });

        res.status(200).json({
            message: "Corte de caja realizado y cerrado exitosamente.",
            data: {
                corte_id: resultado.id,
                total_ingresos_amarrados: resultado.totalVentas
            }
        });

    } catch (error) {
        console.error("Error al realizar corte:", error);
        res.status(500).json({ error: "Error interno al procesar el cierre de caja." });
    }
};


// 4. LISTAR HISTORIAL DE CORTES (Con Filtros y KPIs)
export const listarCortes = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const { fecha_inicio, fecha_fin } = req.query;

        // Filtro de Fechas 
        let whereClause = {};
        if (fecha_inicio && fecha_fin) {
            whereClause.inicio = {
                gte: new Date(`${fecha_inicio}T00:00:00.000Z`),
                lte: new Date(`${fecha_fin}T23:59:59.999Z`)
            };
        }

        // Ejecutar consultas en paralelo para máxima velocidad
        const hoyInicio = new Date(); hoyInicio.setHours(0, 0, 0, 0);
        const hoyFin = new Date(hoyInicio); hoyFin.setHours(23, 59, 59, 999);

        const [totalRecords, cortesPaginados, cajaAbierta, movimientosHoy, ultimoCorteCerrado, totalCortesCerrados] = await Promise.all([
            prisma.corteCaja.count({ where: whereClause }),
            
            prisma.corteCaja.findMany({
                where: whereClause,
                skip: skip,
                take: limit,
                orderBy: { inicio: 'desc' },
                include: {
                    cajero: { select: { username: true, nombreCompleto: true } },
                    movimientos: { include: { concepto: true } } 
                }
            }),

            prisma.corteCaja.findFirst({
                where: { status: 'abierto' },
                include: { movimientos: { include: { concepto: true } } }
            }),

            prisma.cajaMovimiento.findMany({
                where: { fecha: { gte: hoyInicio, lte: hoyFin } },
                include: { concepto: true }
            }),

            prisma.corteCaja.findFirst({
                where: { status: 'cerrado' },
                orderBy: { fin: 'desc' }
            }),

            prisma.corteCaja.count({ where: { status: 'cerrado' } })
        ]);

        // Calcular KPIs 
        let efectivoFondoActual = 0, efectivoIngresosActual = 0, efectivoEgresosActual = 0;
        if (cajaAbierta) {
            cajaAbierta.movimientos.forEach(mov => {
                const monto = parseFloat(mov.monto);
                if (mov.concepto.nombre === 'Apertura / Fondo de Caja') efectivoFondoActual += monto;
                else if (mov.tipo === 'ingreso') efectivoIngresosActual += monto;
                else if (mov.tipo === 'gasto') efectivoEgresosActual += monto;
            });
        }
        const efectivoTotalActual = efectivoFondoActual + efectivoIngresosActual - efectivoEgresosActual;
        const gananciaNetaActual = efectivoIngresosActual - efectivoEgresosActual;

        let ingresosHoy = 0, transaccionesHoy = 0;
        movimientosHoy.forEach(mov => {
            if (mov.tipo === 'ingreso' && mov.concepto.nombre !== 'Apertura / Fondo de Caja') {
                ingresosHoy += parseFloat(mov.monto);
                transaccionesHoy++;
            }
        });

        const dashboard_stats = {
            efectivo_caja: { total: efectivoTotalActual, fondo: efectivoFondoActual, variacion: gananciaNetaActual },
            total_hoy: { total: ingresosHoy, transacciones: transaccionesHoy },
            cortes_realizados: { total: totalCortesCerrados, ultimo: ultimoCorteCerrado ? ultimoCorteCerrado.fin : null }
        };

        // Formatear la Tabla
        const dataFormateada = cortesPaginados.map(corte => {
            let cajaInicial = 0, ingresos = 0, egresos = 0;

            corte.movimientos.forEach(mov => {
                const monto = parseFloat(mov.monto);
                if (mov.concepto.nombre === 'Apertura / Fondo de Caja') cajaInicial += monto;
                else if (mov.tipo === 'ingreso') ingresos += monto;
                else if (mov.tipo === 'gasto') egresos += monto;
            });

            return {
                id: corte.id,
                folio: `CC-${corte.id.toString().padStart(4, '0')}`, // Ej: CC-0001
                fecha_inicio: corte.inicio,
                fecha_fin: corte.status === 'abierto' ? null : corte.fin,
                ingresos: ingresos,
                egresos: egresos,
                caja_inicial: cajaInicial,
                caja_final: cajaInicial + ingresos - egresos,
                usuario: corte.cajero.username,
                fecha_creacion: corte.inicio,
                observacion: corte.observaciones || '-',
                status: corte.status
            };
        });

        res.status(200).json({
            message: "Historial de cortes obtenido",
            dashboard_stats,
            data: dataFormateada,
            pagination: { current_page: page, limit, total_records: totalRecords, total_pages: Math.ceil(totalRecords / limit) }
        });

    } catch (error) {
        console.error("Error al listar cortes:", error);
        res.status(500).json({ error: "Error interno al obtener el historial de caja." });
    }
};


// OBTENER DETALLE DE UN CORTE ESPECÍFICO
export const obtenerCorteDetalle = async (req, res) => {
    try {
        const { id } = req.params;

        if (isNaN(id)) {
            return res.status(400).json({ error: "ID de corte inválido." });
        }

        const corte = await prisma.corteCaja.findUnique({
            where: { id: parseInt(id) },
            include: {
                cajero: { select: { nombreCompleto: true, username: true } },
                movimientos: {
                    include: { concepto: true, usuario: { select: { nombreCompleto: true } } },
                    orderBy: { fecha: 'asc' }
                }
            }
        });

        if (!corte) {
            return res.status(404).json({ error: "Corte de caja no encontrado." });
        }

        let cajaInicial = 0, ingresos = 0, egresos = 0;

        const movimientosFormateados = corte.movimientos.map(mov => {
            const monto = parseFloat(mov.monto);
            
            if (mov.concepto.nombre === 'Apertura / Fondo de Caja') cajaInicial += monto;
            else if (mov.tipo === 'ingreso') ingresos += monto;
            else if (mov.tipo === 'gasto') egresos += monto;

            return {
                id: mov.id,
                folio_movimiento: `MOV-${mov.id.toString().padStart(4, '0')}`,
                fecha: mov.fecha,
                concepto: mov.concepto.nombre,
                tipo: mov.tipo,
                monto: monto,
                usuario: mov.usuario.nombreCompleto
            };
        });

        // Estructura exacta para las 8 tarjetas de tu modal
        const dataFormateada = {
            id_corte: corte.id,
            folio: `CC-${corte.id.toString().padStart(4, '0')}`,
            estado: corte.status,
            
            // Tarjetas Superiores
            fecha_inicio: corte.inicio,
            fecha_fin: corte.status === 'abierto' ? 'Caja Abierta' : corte.fin,
            usuario: corte.cajero.username,
            creado: corte.inicio,
            
            // Tarjetas Inferiores
            total_ingresos: ingresos,
            total_egresos: egresos,
            caja_inicial: cajaInicial,
            caja_final: cajaInicial + ingresos - egresos,
            
            observaciones: corte.observaciones || 'Sin observaciones',
            movimientos: movimientosFormateados
        };

        res.status(200).json({
            message: "Detalle del corte obtenido",
            data: dataFormateada
        });

    } catch (error) {
        console.error("Error al obtener detalle del corte:", error);
        res.status(500).json({ error: "Error interno al obtener el detalle." });
    }
};