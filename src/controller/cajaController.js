import prisma from "../config/prisma.js";
import { registrarLog } from "../services/auditoriaService.js";
import { rangoDiaHoy, fechaStrAInicio, fechaStrAFin } from "../utils/timezone.js";

// Detector Inteligente de Método de Pago
const analizarMetodoPago = (nota, metodosCatalogo) => {
    let esEfectivo = true; // Por defecto asumimos efectivo físico
    let metodoNombre = "Efectivo";
    if (!nota) return { esEfectivo, metodoNombre };
    
    const match = nota.match(/\[Pago: ID (\d+)\]/);
    if (match) {
        const metodoObj = metodosCatalogo.find(m => m.id === parseInt(match[1]));
        if (metodoObj) {
            metodoNombre = metodoObj.nombre;
            // Si el nombre no incluye la palabra 'efectivo', es dinero digital
            if (!metodoObj.nombre.toLowerCase().includes('efectivo')) esEfectivo = false;
        }
    }
    return { esEfectivo, metodoNombre };
};

// ABRIR CAJA (Fondo inicial) 
export const abrirCaja = async (req, res) => {
    try {
        const { monto_inicial } = req.body;

        const cajaAbierta = await prisma.corteCaja.findFirst({
            where: { status: 'abierto' }
        });

        if (cajaAbierta) {
            return res.status(400).json({ error: "Ya existe un turno de caja abierto. Debes cerrarlo primero." });
        }

        const resultado = await prisma.$transaction(async (tx) => {
            
            let conceptoApertura = await tx.concepto.findFirst({
                where: { nombre: { equals: 'Apertura / Fondo de Caja', mode: 'insensitive' } }
            });

            if (!conceptoApertura) {
                conceptoApertura = await tx.concepto.create({
                    data: {
                        nombre: 'Apertura / Fondo de Caja',
                        tipo: 'ingreso'
                    }
                });
            }
            
            const nuevoCorte = await tx.corteCaja.create({
                data: {
                    usuarioId: req.user.id,
                    inicio: new Date(),
                    fin: new Date(), 
                    status: 'abierto',
                    totalVentas: 0
                }
            });

            if (monto_inicial && parseFloat(monto_inicial) > 0) {
                await tx.cajaMovimiento.create({
                    data: {
                        corteId: nuevoCorte.id,
                        usuarioId: req.user.id,
                        conceptoId: conceptoApertura.id,
                        tipo: 'ingreso',
                        monto: parseFloat(monto_inicial),
                        referenciaTipo: 'otro',
                        nota: 'Fondo de caja inicial'
                    }
                });
            }

            return nuevoCorte;
        });

        await registrarLog({
            req,
            accion: 'abrir_caja',
            modulo: 'ventas',
            registroId: resultado.id,
            detalles: `Caja abierta con un fondo inicial de $${monto_inicial || 0}`
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

        const cajaAbierta = await prisma.corteCaja.findFirst({
            where: { status: 'abierto' },
            include: { movimientos: { include: { concepto: true } } }
        });

        const movimientos = await prisma.cajaMovimiento.findMany({
            where: {
                fecha: { gte: inicio, lte: fin },
                OR: [
                    { corteId: null },
                    { corteId: cajaAbierta ? cajaAbierta.id : -1 } 
                ]
            },
            include: { concepto: true, usuario: { select: { nombreCompleto: true } } },
            orderBy: { fecha: 'asc' }
        });

        // Calcular la matemática para tus 4 tarjetas
        const metodosCatalogo = await prisma.metodoPago.findMany(); // Traemos el catálogo

        let totalIngresos = 0;
        let totalEgresos = 0;
        let efectivoInicial = 0;
        let ingresosEfectivoFisico = 0; // Solo billetes
        let egresosEfectivoFisico = 0;

        // Extraer el fondo inicial
        if (cajaAbierta) {
            const movApertura = cajaAbierta.movimientos.find(m => m.concepto.nombre.toLowerCase().includes('apertura'));
            if (movApertura) efectivoInicial = parseFloat(movApertura.monto);
        }

        const desgloseMovimientos = movimientos.map(mov => {
            const monto = parseFloat(mov.monto);
            const esApertura = mov.concepto.nombre.toLowerCase().includes('apertura');
            
            // Analizamos el método de pago
            const { esEfectivo, metodoNombre } = analizarMetodoPago(mov.nota, metodosCatalogo);

            // Limpiamos la etiqueta secreta para que no se vea fea en el frontend
            let notaLimpia = mov.nota || mov.concepto.nombre;
            if (notaLimpia.includes('[Pago: ID')) {
                notaLimpia = notaLimpia.replace(/\[Pago: ID \d+\]\s*-?\s*/, '').trim();
            }

            // Matemática separada
            if (!esApertura) {
                if (mov.tipo === 'ingreso') {
                    totalIngresos += monto;
                    if (esEfectivo) ingresosEfectivoFisico += monto;
                }
                if (mov.tipo === 'gasto') {
                    totalEgresos += monto;
                    if (esEfectivo) egresosEfectivoFisico += monto;
                }
            }

            return {
                id: mov.id,
                fecha: mov.fecha,
                concepto: mov.concepto.nombre,
                tipo: mov.tipo,
                monto: monto,
                metodo: metodoNombre, // Ya viaja con "Transferencia", "Tarjeta", etc.
                nota_movimiento: notaLimpia,
                usuario: mov.usuario.nombreCompleto
            };
        });

        // El cajón físico SOLO suma los billetes.
        const efectivoFinal = (efectivoInicial + ingresosEfectivoFisico) - egresosEfectivoFisico;

        res.status(200).json({
            message: "Consulta generada correctamente",
            resumen: {
                total_ingresos: totalIngresos,
                total_egresos: totalEgresos,
                efectivo_inicial: efectivoInicial,
                efectivo_final: efectivoFinal
            },
            movimientos: desgloseMovimientos 
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

        const resultado = await prisma.$transaction(async (tx) => {
            
            const movimientosFlotantes = await tx.cajaMovimiento.findMany({
                where: {
                    fecha: { gte: inicio, lte: fin },
                    corteId: null
                }
            });

            await tx.cajaMovimiento.updateMany({
                where: { fecha: { gte: inicio, lte: fin }, corteId: null },
                data: { corteId: cajaAbierta.id }
            });

            const todosLosMovimientos = await tx.cajaMovimiento.findMany({
                where: { corteId: cajaAbierta.id },
                include: { concepto: true }
            });
            
            let sumaVentas = 0;
            todosLosMovimientos.forEach(mov => {
                const esApertura = mov.concepto.nombre.toLowerCase().includes('apertura');
                if (mov.tipo === 'ingreso' && !esApertura) {
                    sumaVentas += parseFloat(mov.monto);
                }
            });

            const corteCerrado = await tx.corteCaja.update({
                where: { id: cajaAbierta.id },
                data: {
                    fin: new Date(), 
                    status: 'cerrado',
                    totalVentas: sumaVentas,
                    observaciones: observacion || null
                }
            });

            return corteCerrado;
        }, {
            maxWait: 5000,   
            timeout: 20000   
        });

        await registrarLog({
            req,
            accion: 'cierre_caja',
            modulo: 'ventas',
            registroId: resultado.id,
            detalles: `Corte de caja realizado. Total ventas amarradas: $${resultado.totalVentas}. Observación: ${observacion || 'Ninguna'}`
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

        let whereClause = {};
        if (fecha_inicio && fecha_fin) {
            whereClause.inicio = {
                gte: fechaStrAInicio(fecha_inicio),
                lte: fechaStrAFin(fecha_fin)
            };
        }

        const { inicio: hoyInicio, fin: hoyFin } = rangoDiaHoy();

        const [totalRecords, cortesPaginados, cajaAbierta, movimientosHoy, ultimoCorteCerrado, totalCortesCerrados, metodosCatalogo] = await Promise.all([
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

            prisma.corteCaja.count({ where: { status: 'cerrado' } }),
            
            prisma.metodoPago.findMany() // Traemos catálogo para el KPI de caja
        ]);

        let efectivoFondoActual = 0, efectivoIngresosActual = 0, efectivoEgresosActual = 0;
        let gananciaNetaActual = 0;
        
        if (cajaAbierta) {
            cajaAbierta.movimientos.forEach(mov => {
                const monto = parseFloat(mov.monto);
                const { esEfectivo } = analizarMetodoPago(mov.nota, metodosCatalogo);
                const esApertura = mov.concepto.nombre.toLowerCase().includes('apertura');

                if (esApertura) efectivoFondoActual += monto;
                else if (mov.tipo === 'ingreso') {
                    gananciaNetaActual += monto; // Para el KPI general suma todo
                    if(esEfectivo) efectivoIngresosActual += monto; // Para el cajón, solo físico
                }
                else if (mov.tipo === 'gasto') {
                    gananciaNetaActual -= monto;
                    if(esEfectivo) efectivoEgresosActual += monto;
                }
            });
        }
        const efectivoTotalActual = efectivoFondoActual + efectivoIngresosActual - efectivoEgresosActual;

        let ingresosHoy = 0, transaccionesHoy = 0;
        movimientosHoy.forEach(mov => {
            const esApertura = mov.concepto.nombre.toLowerCase().includes('apertura');
            if (mov.tipo === 'ingreso' && !esApertura) {
                ingresosHoy += parseFloat(mov.monto);
                transaccionesHoy++;
            }
        });

        const dashboard_stats = {
            efectivo_caja: { total: efectivoTotalActual, fondo: efectivoFondoActual, variacion: gananciaNetaActual },
            total_hoy: { total: ingresosHoy, transacciones: transaccionesHoy },
            cortes_realizados: { total: totalCortesCerrados, ultimo: ultimoCorteCerrado ? ultimoCorteCerrado.fin : null }
        };

        const dataFormateada = cortesPaginados.map(corte => {
            let cajaInicial = 0, ingresosFisico = 0, egresosFisico = 0, ingresosGlobal = 0, egresosGlobal = 0;

            corte.movimientos.forEach(mov => {
                const monto = parseFloat(mov.monto);
                const esApertura = mov.concepto.nombre.toLowerCase().includes('apertura');
                const { esEfectivo } = analizarMetodoPago(mov.nota, metodosCatalogo);
                
                if (esApertura) cajaInicial += monto;
                else if (mov.tipo === 'ingreso') {
                    ingresosGlobal += monto;
                    if(esEfectivo) ingresosFisico += monto;
                }
                else if (mov.tipo === 'gasto') {
                    egresosGlobal += monto;
                    if(esEfectivo) egresosFisico += monto;
                }
            });

            return {
                id: corte.id,
                folio: `CC-${corte.id.toString().padStart(4, '0')}`,
                fecha_inicio: corte.inicio,
                fecha_fin: corte.status === 'abierto' ? null : corte.fin,
                ingresos: ingresosGlobal, // La tabla muestra lo contable total
                egresos: egresosGlobal,
                caja_inicial: cajaInicial,
                caja_final: cajaInicial + ingresosFisico - egresosFisico, 
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

        const metodosCatalogo = await prisma.metodoPago.findMany();
        let cajaInicial = 0, totalIngresos = 0, totalEgresos = 0;
        let ingresosEfectivoFisico = 0, egresosEfectivoFisico = 0;

        const movimientosFormateados = corte.movimientos.map(mov => {
            const monto = parseFloat(mov.monto);
            const esApertura = mov.concepto.nombre.toLowerCase().includes('apertura');
            const { esEfectivo, metodoNombre } = analizarMetodoPago(mov.nota, metodosCatalogo);
            
            if (esApertura) cajaInicial += monto;
            else if (mov.tipo === 'ingreso') {
                totalIngresos += monto;
                if (esEfectivo) ingresosEfectivoFisico += monto;
            }
            else if (mov.tipo === 'gasto') {
                totalEgresos += monto;
                if (esEfectivo) egresosEfectivoFisico += monto;
            }

            return {
                id: mov.id,
                folio_movimiento: `MOV-${mov.id.toString().padStart(4, '0')}`,
                fecha: mov.fecha,
                concepto: mov.concepto.nombre,
                tipo: mov.tipo,
                monto: monto,
                metodo: metodoNombre, // Mostrará el medio de pago real
                usuario: mov.usuario.nombreCompleto
            };
        });

        // Estructura exacta para las 8 tarjetas de tu modal
        const dataFormateada = {
            id_corte: corte.id,
            folio: `CC-${corte.id.toString().padStart(4, '0')}`,
            estado: corte.status,
            
            fecha_inicio: corte.inicio,
            fecha_fin: corte.status === 'abierto' ? 'Caja Abierta' : corte.fin,
            usuario: corte.cajero.username,
            creado: corte.inicio,
            
            total_ingresos: totalIngresos, 
            total_egresos: totalEgresos,
            caja_inicial: cajaInicial,
            caja_final: cajaInicial + ingresosEfectivoFisico - egresosEfectivoFisico, 
            
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