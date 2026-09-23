// Envía los avisos con la app cerrada. Lo corre GitHub Actions cada 10
// minutos (.github/workflows/avisos.yml).
//
// Necesita un solo secreto, FIREBASE_SA: la clave JSON de una cuenta de
// servicio del proyecto taskmanager-ebec9. Las claves de envío (VAPID)
// las crea este mismo script la primera vez y las guarda en Firestore,
// en sistema/vapid, que la app no puede leer. La mitad pública se copia
// a paneles/{uid}/push/_clave para que la app se suscriba.
import admin from 'firebase-admin';
import webpush from 'web-push';
import {parseICS} from './ics.mjs';
import {calcularAvisos, hoyISO} from './logica.mjs';

if(!process.env.FIREBASE_SA){
  console.log('Falta el secreto FIREBASE_SA: no se envía nada.');
  process.exit(0);
}
admin.initializeApp({credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SA))});
const db = admin.firestore();

async function clavesVapid(){
  const ref = db.doc('sistema/vapid');
  const s = await ref.get();
  if(s.exists) return s.data();
  const k = webpush.generateVAPIDKeys();
  const d = {publica: k.publicKey, privada: k.privateKey, creado: new Date().toISOString()};
  await ref.set(d);
  console.log('Claves de envío creadas.');
  return d;
}

async function externos(panel){
  let out = [];
  for(const c of (panel.ajustes && panel.ajustes.ics) || []){
    try{
      const r = await fetch(c.url, {signal: AbortSignal.timeout(20000)});
      if(r.ok) out = out.concat(parseICS(await r.text()).map(e => ({...e, src: c.nombre})));
    }catch(e){ console.log('Calendario sin leer:', c.nombre); }
  }
  return out;
}

const k = await clavesVapid();
webpush.setVapidDetails('https://costaneraelectro.github.io/taskmanager2/', k.publica, k.privada);

const ahora = new Date(), hoy = hoyISO(ahora);
for(const pref of await db.collection('paneles').listDocuments()){
  const push = pref.collection('push');
  await push.doc('_clave').set({publica: k.publica});
  const equipos = (await push.get()).docs.filter(d => !d.id.startsWith('_') && d.data().endpoint);
  if(!equipos.length) continue;

  const panel = (await pref.get()).data() || {};
  const envRef = push.doc('_enviados');
  const previos = ((await envRef.get()).data() || {}).claves || [];
  const enviados = new Set(previos.filter(c => c.startsWith(hoy + '|')));
  const avisos = calcularAvisos(panel, await externos(panel), ahora, enviados);

  for(const a of avisos){
    for(const eq of equipos){
      const {endpoint, keys} = eq.data();
      try{
        await webpush.sendNotification({endpoint, keys},
          JSON.stringify({title: a.titulo, body: a.cuerpo, tag: a.clave, url: './index.html'}), {TTL: 3600});
      }catch(e){
        /* 404/410: ese equipo se desuscribió o cambió; se olvida. */
        if(e.statusCode === 404 || e.statusCode === 410) await eq.ref.delete();
        else console.log('Fallo al enviar:', e.statusCode || e.message);
      }
    }
    enviados.add(a.clave);
  }
  await envRef.set({claves: [...enviados]});
  console.log('Panel ' + pref.id.slice(0, 5) + '…: ' + avisos.length + ' avisos a ' + equipos.length + ' equipos.');
}
