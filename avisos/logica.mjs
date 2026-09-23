// Qué avisar ahora. Función pura: recibe el panel, los eventos de los
// calendarios externos, la hora y lo ya enviado, y devuelve la lista.
// Las claves son las mismas que usa la app (index.html, revisarAvisos),
// así un aviso que ya salió desde la app abierta no se repite.
import {hoyISO, hhmm} from './ics.mjs';

const minutos = h => { const m = /^(\d{1,2}):(\d{2})/.exec(h || ''); return m ? (+m[1]) * 60 + (+m[2]) : null; };
const diasDesde = iso => Math.floor((new Date(hoyISO() + 'T00:00:00') - new Date(iso + 'T00:00:00')) / 86400000);

/* El servidor corre cada 10 minutos y GitHub a veces se atrasa: las
   ventanas son más anchas que en la app para no perder ninguno. */
const ANTES_EVENTO = 20, DESPUES_TAREA = 30;

export function calcularAvisos(panel, externos, ahora, enviados){
  const hoy = hoyISO(ahora), min = ahora.getHours() * 60 + ahora.getMinutes();
  const out = [];
  const lanzar = (clave, titulo, cuerpo) => {
    clave = hoy + '|' + clave;
    if(enviados.has(clave) || out.some(a => a.clave === clave)) return;
    out.push({clave, titulo, cuerpo});
  };

  const eventos = (panel.agenda || []).filter(e => e.d === hoy).concat(externos.filter(e => e.d === hoy));
  for(const e of eventos){
    const m = minutos(e.hora);
    if(m != null && min >= m - ANTES_EVENTO && min < m) lanzar('ev|' + e.hora + '|' + e.t, e.t, 'A las ' + e.hora + (e.src ? ' · ' + e.src : ''));
  }
  for(const t of panel.tareas || []){
    if(t.done || !t.ini || (t.venc && t.venc > hoy)) continue;
    if(t.venc && t.venc < hoy) continue;
    const m = minutos(t.ini);
    if(m != null && min >= m && min < m + DESPUES_TAREA) lanzar('ta|' + t.tid, t.text, 'Ahora · ' + t.ini);
  }
  if(min >= 9 * 60){
    for(const c of panel.casos || []) if(c.seguir && c.seguir <= hoy) lanzar('seg|' + c.id, 'Revisar caso ' + c.id, c.desc || '');
  }
  if(min >= 8 * 60 && min < 12 * 60){
    const urg = (panel.tareas || []).filter(t => !t.done && t.cat === 'urgente').length;
    const frios = (panel.casos || []).filter(c => c.estado !== 'EN ESPERA' && c.act && diasDesde(c.act) >= 2).length;
    const partes = [];
    if(urg) partes.push(urg + (urg === 1 ? ' tarea urgente' : ' tareas urgentes'));
    if(frios) partes.push(frios + (frios === 1 ? ' caso quieto' : ' casos quietos'));
    if(partes.length) lanzar('resumen', 'Tu día', partes.join(' · '));
  }
  return out;
}
export {hoyISO, hhmm};
