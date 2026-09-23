// Lectura de calendarios ICS: copia de la misma lógica que usa la app
// (index.html), para que servidor y app entiendan igual los eventos.
// Si cambias una, cambia la otra.
const dosCifras = n => String(n).padStart(2, '0');

export function hoyISO(d){
  d = d || new Date();
  return d.getFullYear() + '-' + dosCifras(d.getMonth()+1) + '-' + dosCifras(d.getDate());
}

export function hhmm(d){ d = d || new Date(); return dosCifras(d.getHours()) + ':' + dosCifras(d.getMinutes()); }
function minutosDe(h){ const m = /^(\d{1,2}):(\d{2})/.exec(h||''); return m ? (+m[1])*60 + (+m[2]) : null; }

function diasDesde(iso){
  if(!iso) return null;
  const a = new Date(iso + 'T00:00:00');
  if(isNaN(a)) return null;
  return Math.floor((new Date(hoyISO()+'T00:00:00') - a) / 86400000);
}

export function sumarDias(iso, n){ const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return hoyISO(d); }

function desescapar(v){ return v.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim(); }
/* Hora de una zona con nombre (America/Santiago) a hora local. Outlook
   usa nombres de Windows que el navegador no conoce; ahí se toma la
   hora tal cual, que para un calendario de Chile es lo correcto. */
/* Los nombres de zona que usa Outlook (de Windows) y su equivalente. */
const ZONAS_WIN = {
  'Pacific SA Standard Time':'America/Santiago', 'Argentina Standard Time':'America/Argentina/Buenos_Aires',
  'SA Pacific Standard Time':'America/Bogota', 'SA Western Standard Time':'America/La_Paz',
  'SA Eastern Standard Time':'America/Cayenne', 'E. South America Standard Time':'America/Sao_Paulo',
  'Pacific Standard Time':'America/Los_Angeles', 'Mountain Standard Time':'America/Denver',
  'Central Standard Time':'America/Chicago', 'Eastern Standard Time':'America/New_York',
  'Central Standard Time (Mexico)':'America/Mexico_City', 'Romance Standard Time':'Europe/Paris',
  'W. Europe Standard Time':'Europe/Berlin', 'GMT Standard Time':'Europe/London', 'UTC':'UTC'
};
function desdeZona(y, mo, d, h, mi, tz){
  tz = ZONAS_WIN[tz] || tz;
  const guess = Date.UTC(y, mo, d, h, mi);
  try{
    const f = new Intl.DateTimeFormat('en-US', {timeZone:tz, hourCycle:'h23', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit'});
    const p = {};
    f.formatToParts(new Date(guess)).forEach(x => { p[x.type] = x.value; });
    const comoZona = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
    return new Date(guess - (comoZona - guess));
  }catch(e){ return new Date(y, mo, d, h, mi); }
}
function fechaICS(v, p){
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/.exec(v || '');
  if(!m) return null;
  if(!m[4]) return {d:m[1] + '-' + m[2] + '-' + m[3], hora:'', ms:Date.UTC(+m[1], m[2]-1, +m[3])};
  let d;
  if(m[7]) d = new Date(Date.UTC(+m[1], m[2]-1, +m[3], +m[4], +m[5]));
  else if(p && p.TZID) d = desdeZona(+m[1], m[2]-1, +m[3], +m[4], +m[5], p.TZID.replace(/^"|"$/g, ''));
  else d = new Date(+m[1], m[2]-1, +m[3], +m[4], +m[5]);
  return {d:hoyISO(d), hora:hhmm(d), ms:d.getTime()};
}
const DIA_ICS = {SU:0, MO:1, TU:2, WE:3, TH:4, FR:5, SA:6};

function repeticiones(ev, desde, hasta){
  const r = {};
  ev.rrule.split(';').forEach(x => { const [k, v] = x.split('='); r[k] = v; });
  const inter = +r.INTERVAL || 1, cuenta = r.COUNT ? +r.COUNT : Infinity;
  const fin = r.UNTIL ? (fechaICS(r.UNTIL, {}) || {}).d || hasta : hasta;
  const tope = fin < hasta ? fin : hasta;
  const base = ev.ini.d, out = [];
  let n = 0, guarda = 0;
  if(r.FREQ === 'WEEKLY'){
    const dias = (r.BYDAY ? r.BYDAY.split(',').map(x => DIA_ICS[x.slice(-2)]) : [new Date(base + 'T00:00:00').getDay()])
      .filter(x => x != null).sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
    let semana = sumarDias(base, -((new Date(base + 'T00:00:00').getDay() + 6) % 7));
    while(semana <= tope && n < cuenta && guarda++ < 800){
      for(const wd of dias){
        const d = sumarDias(semana, (wd + 6) % 7);
        if(d < base || d > tope) continue;
        if(++n > cuenta) break;
        if(d >= desde) out.push(d);
      }
      semana = sumarDias(semana, 7 * inter);
    }
  }else{
    let d = base;
    while(d <= tope && n < cuenta && guarda++ < 2000){
      n++;
      if(d >= desde) out.push(d);
      const x = new Date(d + 'T00:00:00');
      if(r.FREQ === 'DAILY') x.setDate(x.getDate() + inter);
      else if(r.FREQ === 'MONTHLY') x.setMonth(x.getMonth() + inter);
      else if(r.FREQ === 'YEARLY') x.setFullYear(x.getFullYear() + inter);
      else break;
      d = hoyISO(x);
    }
  }
  return out;
}

export function parseICS(txt){
  const lineas = txt.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const crudos = [];
  let ev = null;
  for(const l of lineas){
    if(l === 'BEGIN:VEVENT'){ ev = {ex:[]}; continue; }
    if(l === 'END:VEVENT'){ if(ev) crudos.push(ev); ev = null; continue; }
    if(!ev) continue;
    const i = l.indexOf(':'); if(i < 0) continue;
    const [nombre, ...params] = l.slice(0, i).split(';');
    const val = l.slice(i + 1), p = {};
    params.forEach(x => { const j = x.indexOf('='); if(j > 0) p[x.slice(0, j)] = x.slice(j + 1); });
    if(nombre === 'SUMMARY') ev.t = desescapar(val);
    else if(nombre === 'DTSTART') ev.ini = fechaICS(val, p);
    else if(nombre === 'DTEND') ev.fin = fechaICS(val, p);
    else if(nombre === 'RRULE') ev.rrule = val;
    else if(nombre === 'EXDATE') val.split(',').forEach(v => { const f = fechaICS(v, p); if(f) ev.ex.push(f.d); });
    else if(nombre === 'RECURRENCE-ID') ev.recId = fechaICS(val, p);
    else if(nombre === 'STATUS') ev.estado = val;
    else if(nombre === 'UID') ev.uid = val;
  }
  const desde = sumarDias(hoyISO(), -40), hasta = sumarDias(hoyISO(), 150);
  const cambiados = new Set(crudos.filter(e => e.recId).map(e => e.uid + '|' + e.recId.d));
  const out = [];
  for(const e of crudos){
    if(!e.ini || e.estado === 'CANCELLED') continue;
    const hora = e.ini.hora, fin = e.fin && e.fin.hora ? e.fin.hora : '';
    const t = e.t || '(sin título)';
    if(e.rrule && !e.recId){
      for(const d of repeticiones(e, desde, hasta)){
        if(e.ex.includes(d) || cambiados.has(e.uid + '|' + d)) continue;
        out.push({d, hora, fin, t});
      }
    }else if(e.ini.d >= desde && e.ini.d <= hasta){
      out.push({d:e.ini.d, hora, fin, t});
    }
  }
  return out;
}
