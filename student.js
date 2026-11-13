import { t, locale } from './i18n.js';
import { releasedCourses } from './releases.js';
import { escape } from './courses.js';
import { serveAsset } from './assets.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { layout, nav } from './layout.js';

const hashPassword=promisify(scrypt);
const base='/espacios/estudiante';
const catalog=base+'/catalogo';
const directory=process.env.GE_COURSE_DIR || join(process.env.HOME,'.local/share/ge-elearning');
mkdirSync(directory,{recursive:true,mode:0o700});
export const db=new DatabaseSync(join(directory,'students.sqlite'));
db.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS students(id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL,salt TEXT NOT NULL,hash TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, student INTEGER NOT NULL REFERENCES students, expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS enrollment(student INTEGER REFERENCES students,course TEXT,PRIMARY KEY(student,course));
 CREATE TABLE IF NOT EXISTS completion(student INTEGER,course TEXT,lesson TEXT,PRIMARY KEY(student,course,lesson),
 FOREIGN KEY(student,course) REFERENCES enrollment(student,course));`);

// Only reviewed, publicly released content belongs here. Drafts have separate storage.
const pilot=[{
 id:'primeros-pasos-en-soporte',title:'Primeros pasos en soporte técnico',category:'Tecnología',
 description:'Aprende a documentar una incidencia para que otra persona pueda continuar el diagnóstico.',
 lessons:[
  {id:'observar',title:'Observar el problema',text:'Una impresora deja de responder. Antes de cambiar su configuración, identifica el equipo afectado y comprueba qué ve el usuario. Anota el mensaje exacto que aparece en pantalla.',exercise:'Escribe una observación que otra persona pueda comprobar. Por ejemplo, «El documento sigue en la cola después de dos minutos».'},
  {id:'registrar',title:'Registrar una incidencia',video:true,text:'Registra el equipo afectado, el síntoma observado y la hora de inicio. Por ejemplo, «Recepción, impresora 2. El trabajo sigue en la cola desde las 10:15». Si se desconoce la hora, indícalo.',exercise:'Redacta un registro con esos tres datos para un ordenador que ha perdido la conexión.'},
  {id:'entregar',title:'Entregar el caso',text:'Al pasar el caso a otra persona, incluye las comprobaciones realizadas y el resultado de cada una. Identifica qué queda pendiente. Así tu compañero podrá retomar el trabajo desde el último paso comprobado.',exercise:'Añade dos líneas a tu registro: una comprobación que ya hiciste y una pregunta que sigue abierta.'}
 ]}];
const pilotVideos=Object.fromEntries(['es','en','fr'].map(code=>[code,readFileSync(new URL('./media/incidencia'+(code==='es'?'':'-'+code)+'.mp4',import.meta.url))]));
const tabs=[[base,'Resumen'],[catalog,'Catálogo'],[base+'/aprendizaje','Mi aprendizaje'],[base+'/progreso','Mi progreso']];
const digest=value=>createHash('sha256').update(value).digest('hex');
const cookie=(token,age)=>'ge_student='+token+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age='+age;
const courseUrl=c=>catalog+'/'+c.id;
const lessonUrl=(c,l)=>courseUrl(c)+'/lecciones/'+l.id;
const button=(url,label)=>`<form method="post" action="${url}"><button>${label}</button></form>`;
const attempts=new Map();

export function identity(req){
 const token=(req.headers.cookie||'').split(';').map(c=>c.trim()).find(c=>c.startsWith('ge_student='))?.slice(11);
 const account=token && db.prepare('SELECT student FROM sessions WHERE token=? AND expires>?').get(digest(token),Date.now());
 const id=account?.student;
 return {token,id};
}

export async function student(req,res,path,send){
 const url=new URL(req.url,'https://edu.senosl.com');
 const {token,id}=identity(req);
 const current=tabs.find(([u])=>u===path)?.[0] || (path.startsWith(catalog+'/')?catalog:base);
 const render=(title,html,status=200)=>send(res,status,layout(title,'<h1>'+title+'</h1>'+html,base,false,
   nav(tabs,current,'Estudiante')+(id?'<a href="/cuenta">Mi perfil y espacios</a>'+button(base+'/salir','Cerrar sesión de estudiante'):`<a href="${base}/acceso">Acceso de estudiante</a>`)));
 const redirect=(target,extra={})=>send(res,303,'','text/plain',{Location:target,...extra});
 const missing=()=>render('Página no encontrada',`<a href="${catalog}">Volver al catálogo</a>`,404);
 const get=req.method==='GET';
 if(!get && req.method!=='POST')return send(res,405,'Método no permitido');
 const fields=new URLSearchParams();
 if(!get){
  let size=0;const chunks=[];
  for await(const chunk of req){size+=chunk.length;if(size>8192)return send(res,413,'Formulario demasiado grande');chunks.push(chunk);}
  for(const [key,value] of new URLSearchParams(Buffer.concat(chunks).toString()))fields.set(key,value);
 }
 const next=fields.get('curso')||url.searchParams.get('curso');
 const published=[...pilot,...releasedCourses()];
 const selected=published.find(c=>c.id===next);
 const profileLogin=(fields.get('destino')||url.searchParams.get('destino'))==='cuenta';
 const afterLogin=selected?courseUrl(selected):profileLogin?'/cuenta':base+'/aprendizaje';
 function authForm(register,message='',status=200){
  const action=base+(register?'/registro':'/acceso'),other=base+(register?'/acceso':'/registro');
  return render(register?'Crear cuenta':'Acceso a tu cuenta',`
   ${message?'<p role="alert">'+message+'</p>':''}
   <form action="${action}" method="post"><input type="hidden" name="destino" value="${profileLogin?'cuenta':''}"><input type="hidden" name="curso" value="${selected?.id||''}">
   <label>Usuario<input name="usuario" autocomplete="username" minlength="3" maxlength="40" pattern="[a-zA-Z0-9._\\-]{3,40}" required></label>
   <small>De 3 a 40 letras, números, puntos, guiones o guiones bajos.</small>
   <label>Contraseña<input type="password" name="clave" autocomplete="${register?'new-password':'current-password'}" ${register?'minlength="12"':''} maxlength="128" required></label>
   ${register?'<small>Usa al menos 12 caracteres.</small>':''}<p><button>${register?'Crear cuenta':'Iniciar sesión'}</button></p></form>
   <a href="${other}${selected?'?curso='+selected.id:profileLogin?'?destino=cuenta':''}">${register?'Ya tengo cuenta':'Crear cuenta'}</a>`,status);
 }
 if(path===base+'/registro'||path===base+'/acceso'){
  if(id)return redirect(afterLogin);
  const register=path.endsWith('/registro');
  if(get)return authForm(register);
  const username=(fields.get('usuario')||'').trim().toLowerCase(),password=fields.get('clave')||'';
  const now=Date.now(),ip=req.headers['x-real-ip']||req.socket.remoteAddress;
  for(const [key,state] of attempts)if(state.until<=now)attempts.delete(key);
  const state=attempts.get(ip)||{count:0,until:now+600000};
  if(state.count>=15)return authForm(register,'Demasiados intentos. Vuelve a probar en diez minutos.',429);
  state.count++;attempts.set(ip,state);
  if(!/^[a-z0-9._-]{3,40}$/.test(username)||!password||password.length>128||(register&&password.length<12))
   return authForm(register,'Revisa el usuario y la contraseña.',422);
  let user=db.prepare('SELECT * FROM students WHERE username=?').get(username);
  const salt=register||!user?randomBytes(16).toString('hex'):user.salt;
  const hash=await hashPassword(password,salt,64);
  if(register){
   const result=db.prepare('INSERT OR IGNORE INTO students(username,salt,hash) VALUES(?,?,?)').run(username,salt,hash.toString('hex'));
   if(!result.changes)return authForm(true,'Ese usuario ya existe. Elige otro o inicia sesión.',409);
   user={id:result.lastInsertRowid};
  }else if(!user||!timingSafeEqual(hash,Buffer.from(user.hash,'hex')))return authForm(false,'Usuario o contraseña incorrectos.',401);
  const secret=randomBytes(32).toString('hex'),age=8*3600;
  db.prepare('DELETE FROM sessions WHERE expires<=?').run(now);
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(secret),user.id,now+age*1000);
  return redirect(afterLogin,{'Set-Cookie':cookie(secret,age)});
 }
 if(path===base+'/salir'&&!get){
  if(token)db.prepare('DELETE FROM sessions WHERE token=?').run(digest(token));
  return redirect(base,{'Set-Cookie':cookie('',0)});
 }
 const enrolled=c=>Boolean(id&&db.prepare('SELECT 1 FROM enrollment WHERE student=? AND course=?').get(id,c.id));
 const finished=c=>new Set(db.prepare('SELECT lesson FROM completion WHERE student=? AND course=?').all(id,c.id).map(row=>row.lesson));
 function progressCard(c){
  const done=finished(c),nextLesson=c.lessons.find(l=>!done.has(l.id));
  return `<section><h2>${c.title}</h2><p>${done.size} de ${c.lessons.length} lecciones completadas</p>
   <progress aria-label="Progreso del curso" value="${done.size}" max="${c.lessons.length}"></progress><p><a href="${nextLesson?lessonUrl(c,nextLesson):courseUrl(c)}">${nextLesson?'Continuar curso':'Repasar curso completado'}</a></p></section>`;
 }
 if(get&&(path===base||path===catalog)){
  const q=(url.searchParams.get('q')||'').trim().toLocaleLowerCase('es');
  const seen=new Set();
  const latest=published.filter(c=>{if(!c.series)return true;if(seen.has(c.series))return false;seen.add(c.series);return true;});
  const matches=latest.filter(c=>((c.searchText||'')+' '+c.title+' '+c.category+' '+c.description+' '+t(c.title)+' '+t(c.category)+' '+t(c.description)).toLocaleLowerCase().includes(q));
  return render(path===catalog?'Catálogo de cursos':'Espacio de estudiante',
   (path===catalog?`<form action="${catalog}"><label>Buscar por tema o curso<input type="search" name="q"></label><button>Buscar</button></form>`:'')+
   (matches.map(c=>`<section><small>${c.category} · ${c.price?c.price+' XAF':'Gratuito'}</small><h2><a href="${courseUrl(c)}">${c.title}</a></h2><p>${c.description}</p><p>${c.lessons.length} lecciones</p></section>`).join('')||`<p>No hay cursos con esa búsqueda. <a href="${catalog}">Ver todos</a></p>`));
 }
 if(get&&[base+'/aprendizaje',base+'/progreso'].includes(path)){
  if(!id)return redirect(base+'/acceso');
  return render(path.endsWith('progreso')?'Mi progreso':'Mi aprendizaje',published.filter(enrolled).map(progressCard).join('')||`<p>Aún no te has matriculado en ningún curso. <a href="${catalog}">Explorar catálogo</a></p>`);
 }
 const parts=path.slice(catalog.length+1).split('/');
 const course=published.find(c=>courseUrl(c)===path||path.startsWith(courseUrl(c)+'/'));
 if(!course)return missing();
 const link=courseUrl(course);
 const latest=course.series?published.find(c=>c.series===course.series):course;
 const previous=course.series&&id?published.find(c=>c.series===course.series&&enrolled(c)):null;
 if(latest.id!==course.id&&!enrolled(course))return redirect(courseUrl(latest));

 if(get&&path===link){
  const active=enrolled(course);
  return render(course.title,`<p>${course.description}</p><small>${course.price?course.price+' XAF':'Gratuito'} ${course.version?'· Versión '+course.version:''} · ${course.lessons.length} lecciones</small>
   <ol>${course.lessons.map(l=>`<li>${active?'<a href="'+lessonUrl(course,l)+'">'+l.title+'</a>':l.title}</li>`).join('')}</ol>`+
   (active?progressCard(course):previous?progressCard(previous):course.price?(id?`<form method="post" action="/cuenta/pedidos"><input type="hidden" name="action" value="order"><input type="hidden" name="course" value="${course.id}"><button>Crear pedido de prueba · ${course.price} XAF</button></form>`:`<a href="${base}/acceso?curso=${course.id}">Acceder para comprar</a>`):id?button(link+'/matricula','Matricularme gratis'):`<a class="action" href="${base}/acceso?curso=${course.id}">Acceder para matricularme</a>`));
 }
 if(!id)return redirect(base+'/acceso?curso='+course.id);
 if(!get&&path===link+'/matricula'){
  if(previous)return redirect(courseUrl(previous));
  if(course.series&&db.prepare("SELECT 1 FROM orders WHERE student=? AND series=? AND state='pending'").get(id,course.series))
   return render('Pedido pendiente','<p>Completa o cancela tu pedido antes de matricularte en otra versión.</p><a href="/cuenta/pedidos">Mis pedidos</a>',409);
  if(course.price)return render('Curso de pago','<p>Crea el pedido desde la ficha del curso.</p>',403);
  db.prepare('INSERT OR IGNORE INTO enrollment VALUES(?,?)').run(id,course.id);
  return redirect(link);
 }
 if(!enrolled(course))return render('Matrícula necesaria',`<a href="${link}">Ver curso y matricularme</a>`,403);
 const lesson=course.lessons.find(l=>l.id===parts[2]);
 if(parts[1]!=='lecciones'||!lesson)return missing();
 const player=lessonUrl(course,lesson);
 if(get&&course.series){
  if(lesson.video&&path===player+'/video.mp4')return serveAsset(req,res,lesson.video);
  if(lesson.pdf&&path===player+'/documento.pdf')return serveAsset(req,res,lesson.pdf);
 }
 if(get&&lesson.video&&path===player+'/video.mp4'){
  const video=pilotVideos[locale()];
  const range=req.headers.range;
  if(!range)return send(res,200,video,'video/mp4',{'Accept-Ranges':'bytes'});
  const match=/^bytes=(\d+)-(\d*)$/.exec(range);
  const start=Number(match?.[1]),end=match?.[2]?Math.min(Number(match[2]),video.length-1):video.length-1;
  if(!match||start>end)return send(res,416,'','text/plain',{'Content-Range':'bytes */'+video.length});
  return send(res,206,video.subarray(start,end+1),'video/mp4',{'Accept-Ranges':'bytes','Content-Range':`bytes ${start}-${end}/${video.length}`});
 }
 if(!get&&path===player+'/completar'){
  db.prepare('INSERT OR IGNORE INTO completion VALUES(?,?,?)').run(id,course.id,lesson.id);
  const done=finished(course),nextLesson=course.lessons.find(l=>!done.has(l.id));
  return redirect(nextLesson?lessonUrl(course,nextLesson):base+'/progreso');
 }
 if(!get||path!==player)return missing();
 const index=course.lessons.indexOf(lesson);
 return render(lesson.title,`<a href="${link}">${course.title}</a><p>Lección ${index+1} de ${course.lessons.length}</p>
  ${lesson.video?'<video width="640" height="360" controls playsinline preload="none" aria-label="Vídeo de la lección"><source src="'+player+'/video.mp4" type="video/mp4"></video>':''}
  <section>${lesson.module?'<small>'+lesson.module+'</small>':''}<p class="lesson-text">${lesson.text}</p>${lesson.exercise?'<h2>Practica</h2><p>'+lesson.exercise+'</p>':''}
  ${lesson.pdf?'<a href="'+player+'/documento.pdf">Descargar PDF</a>':''}
  ${lesson.quiz?`<form method="get"><fieldset><legend>${escape(lesson.quiz.prompt)}</legend>${lesson.quiz.options.map((v,i)=>`<label><input required type="radio" name="respuesta" value="${i}">${escape(v)}</label>`).join('')}</fieldset><button>Comprobar respuesta</button></form>
  ${url.searchParams.has('respuesta')?(url.searchParams.get('respuesta')===String(lesson.quiz.correct)?'Respuesta correcta.':'Inténtalo de nuevo.'):''}`:''}</section>
  ${finished(course).has(lesson.id)?'<p>Lección completada</p>':button(player+'/completar','Marcar como completada')}
  <nav aria-label="Lecciones">${index?'<a href="'+lessonUrl(course,course.lessons[index-1])+'">Anterior</a>':''}
  ${index+1<course.lessons.length?'<a href="'+lessonUrl(course,course.lessons[index+1])+'">Siguiente</a>':''}</nav>`);
}
