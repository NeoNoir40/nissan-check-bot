import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export async function runDeepAnalysis(context) {
  const res = await client.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `Eres un analista senior de Recursos Humanos especializado en ausentismo laboral.

CONTEXTO DEL SISTEMA:
- Sistema de control de asistencia con check-in diario
- Las faltas se registran cuando NO hay asistencia Y NO hay justificación aprobada
- Las justificaciones pueden ser: enfermedad, permiso_personal, cita_medica, etc.
- Estados de justificación: pendiente, aprobada, rechazada
- Solo las justificaciones aprobadas anulan una falta

TU MISIÓN:
Analizar el patrón de ausentismo del empleado en el ÚLTIMO MES (30 días) y determinar:
1. Nivel de riesgo (bajo, medio, alto, crítico)
2. Patrones preocupantes o normales en su comportamiento
3. Acción específica recomendada para RRHH

DATOS QUE RECIBIRÁS (TODOS DEL ÚLTIMO MES):
- Información del empleado (nombre, puesto, área)
- Faltas del mes (sin justificación aprobada)
- Justificaciones pendientes, aprobadas y rechazadas
- Clasificación de justificaciones (enfermedad vs permiso personal)
- Motivo por el cual se activó este análisis

RESPONDE EN JSON CON ESTA ESTRUCTURA EXACTA:
{
  "riesgo": "bajo|medio|alto|critico",
  "resumen": "Análisis conciso del patrón de ausentismo del mes (2-3 oraciones)",
  "patron_detectado": "Descripción del patrón identificado en el mes",
  "accion_sugerida": "Acción específica y práctica para el equipo de RRHH",
  "requiere_seguimiento": true|false
}`
      },
      {
        role: "user",
        content: JSON.stringify(context, null, 2)
      }
    ]
  });

  let content = res.choices[0].message.content.trim();
  console.log('🤖 Respuesta de OpenAI:', content);

  // Limpiar markdown si viene envuelto en ```json
  if (content.startsWith('```')) {
    content = content.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  return JSON.parse(content);
}
