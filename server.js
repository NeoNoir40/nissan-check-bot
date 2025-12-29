import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import morgan from "morgan";
import "./env.js";

import { pool } from "./db.js";
import { evaluateAbsenceRisk } from "./basicAbsenceModel.js";
import { runDeepAnalysis } from "./openaiService.js";


const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(morgan('dev'));
app.use(express.json());

// WebSocket connection handler
io.on('connection', (socket) => {
  console.log('📡 Cliente WebSocket conectado:', socket.id);

  socket.on('disconnect', () => {
    console.log('📡 Cliente WebSocket desconectado:', socket.id);
  });
});

app.post("/analytics/ws-trigger", async (req, res) => {
  const { event, payload } = req.body;
  if (event !== "ATTENDANCE_RECORDED") {
    return res.json({ ignored: true });
  }

  const { empleado_id, area_id, fecha } = payload;

  /* =====================================================
     1️⃣ DATOS DEL EMPLEADO
  ===================================================== */
  const empleadoQuery = `
    SELECT
      e.nombre,
      e.apellido,
      e.numero_empleado,
      a.id as area_id,
      a.nombre as area_nombre,
      ag.id as agencia_id,
      ag.nombre as agencia_nombre,
      u.puesto
    FROM empleados e
    LEFT JOIN areas a ON e.area_id = a.id
    LEFT JOIN agencias ag ON e.agencia_id = ag.id
    LEFT JOIN users u ON u.empleado_id = e.id
    WHERE e.id = $1
  `;

  const { rows: [empleado] } = await pool.query(empleadoQuery, [empleado_id]);

  /* =====================================================
     2️⃣ HISTORIAL DE ASISTENCIA DEL EMPLEADO (MES ACTUAL)
  ===================================================== */
  const asistenciaQuery = `
    SELECT
      COUNT(*) AS faltas_mes
    FROM (
      SELECT d::date AS fecha
      FROM generate_series(
        DATE_TRUNC('month', CURRENT_DATE),
        CURRENT_DATE,
        '1 day'
      ) d
    ) f
    LEFT JOIN empleados_asistencias ea
      ON ea.empleado_id = $1 AND ea.fecha = f.fecha
    LEFT JOIN empleados_asistencias_justificacions j
      ON j.empleado_id = $1
      AND j.fecha = f.fecha
      AND j.estado = 'aprobada'
    WHERE ea.id IS NULL AND j.id IS NULL
  `;

  const { rows: [asistencia] } = await pool.query(asistenciaQuery, [empleado_id]);

  /* =====================================================
     3️⃣ JUSTIFICACIONES DEL MES
  ===================================================== */
  const justificacionesQuery = `
    SELECT
      COUNT(*) FILTER (WHERE estado = 'pendiente') as pendientes,
      COUNT(*) FILTER (WHERE estado = 'aprobada') as aprobadas,
      COUNT(*) FILTER (WHERE estado = 'rechazada') as rechazadas,
      COUNT(*) FILTER (WHERE tipo = 'enfermedad') as por_enfermedad,
      COUNT(*) FILTER (WHERE tipo = 'permiso_personal') as por_permiso
    FROM empleados_asistencias_justificacions
    WHERE empleado_id = $1
      AND fecha >= DATE_TRUNC('month', CURRENT_DATE)
  `;

  const { rows: [justificaciones] } = await pool.query(justificacionesQuery, [empleado_id]);

  /* =====================================================
     4️⃣ MÉTRICAS CONSOLIDADAS
  ===================================================== */
  const metrics = {
    faltas_30d: Number(asistencia.faltas_mes),
    justificaciones_pendientes: Number(justificaciones.pendientes),
    justificaciones_aprobadas: Number(justificaciones.aprobadas),
    justificaciones_rechazadas: Number(justificaciones.rechazadas),
    justificaciones_por_enfermedad: Number(justificaciones.por_enfermedad),
    justificaciones_por_permiso: Number(justificaciones.por_permiso)
  };

  /* =====================================================
     5️⃣ MODELO BÁSICO
  ===================================================== */
  const decision = evaluateAbsenceRisk(metrics);

  if (!decision.triggerAI) {
    return res.json({
      analyzed_by: "basic-model",
      metrics,
      decision
    });
  }

  /* =====================================================
     6️⃣ ANÁLISIS PROFUNDO (OpenAI)
  ===================================================== */
  console.log('👤 Empleado:', {
    id: empleado_id,
    nombre: `${empleado.nombre} ${empleado.apellido}`,
    puesto: empleado.puesto || 'Sin puesto',
    area: empleado.area_nombre || 'Sin área',
    agencia: empleado.agencia_nombre || 'Sin agencia'
  });

  const aiResult = await runDeepAnalysis({
    empleado: {
      id: empleado_id,
      nombre: empleado.nombre,
      apellido: empleado.apellido,
      puesto: empleado.puesto,
      area: {
        id: empleado.area_id,
        nombre: empleado.area_nombre
      },
      agencia: {
        id: empleado.agencia_id,
        nombre: empleado.agencia_nombre
      }
    },
    fecha,
    metrics,
    motivo: decision.reason
  });

  /* =====================================================
     7️⃣ GUARDAR ANÁLISIS EN BASE DE DATOS
  ===================================================== */
  const insertAnalisisQuery = `
    INSERT INTO analisis_asistencias (
      empleado_id,
      empleado_nombre,
      puesto,
      area,
      agencia,
      riesgo,
      resumen,
      patron_detectado,
      accion_sugerida,
      requiere_seguimiento,
      analizado_en,
      created_at,
      updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW(), NOW())
    RETURNING id
  `;

  const { rows: [analisisGuardado] } = await pool.query(insertAnalisisQuery, [
    empleado_id,
    `${empleado.nombre} ${empleado.apellido}`,
    empleado.puesto || null,
    empleado.area_nombre || null,
    empleado.agencia_nombre || null,
    aiResult.riesgo,
    aiResult.resumen,
    aiResult.patron_detectado,
    aiResult.accion_sugerida,
    aiResult.requiere_seguimiento
  ]);

  console.log(`💾 Análisis guardado con ID: ${analisisGuardado.id}`);

  /* =====================================================
     8️⃣ ENVIAR NOTIFICACIÓN POR WEBSOCKET
  ===================================================== */
  const notificacion = {
    analisis_id: analisisGuardado.id,
    empleado: {
      id: empleado_id,
      nombre: empleado.nombre,
      apellido: empleado.apellido,
      puesto: empleado.puesto,
      area: {
        id: empleado.area_id,
        nombre: empleado.area_nombre
      },
      agencia: {
        id: empleado.agencia_id,
        nombre: empleado.agencia_nombre
      }
    },
    riesgo: aiResult.riesgo,
    resumen: aiResult.resumen,
    patron_detectado: aiResult.patron_detectado,
    accion_sugerida: aiResult.accion_sugerida,
    requiere_seguimiento: aiResult.requiere_seguimiento,
    metrics,
    fecha: new Date().toISOString()
  };

  io.emit('nuevo-analisis', notificacion);
  console.log('📤 Notificación WebSocket enviada:', notificacion.analisis_id);

  return res.json({
    analyzed_by: "ai-model",
    analisis_id: analisisGuardado.id,
    empleado: {
      id: empleado_id,
      nombre: empleado.nombre,
      apellido: empleado.apellido,
      puesto: empleado.puesto,
      area: {
        id: empleado.area_id,
        nombre: empleado.area_nombre
      },
      agencia: {
        id: empleado.agencia_id,
        nombre: empleado.agencia_nombre
      }
    },
    metrics,
    decision,
    aiResult
  });
});

httpServer.listen(process.env.PORT || 3001, () => {
  console.log(`🚀 Analytics AI listo en http://127.0.0.1:${process.env.PORT || 3001}`);
  console.log(`📡 WebSocket listo en ws://127.0.0.1:${process.env.PORT || 3001}`);
});
