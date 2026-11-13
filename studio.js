import { translations, localizedContent, translationForm, saveTranslation } from './content-locales.js';
import { recordDecision } from './releases.js';
import { randomUUID, randomBytes, createHmac } from 'node:crypto';
import { mkdirSync, openSync, closeSync, writeSync, fstatSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { files, serveAsset } from './assets.js';
import { layout } from './layout.js';
import { db, escape as e } from './courses.js';
import { db as users, identity } from './student.js';

mkdirSync(files,{recursive:true,mode:0o700});
const signingKey=randomBytes(32);
const categories=['Tecnología','Negocios','Idiomas','Agricultura','Oficios','Otras competencias'];
db.exec(`CREATE TABLE IF NOT EXISTS studio(course INTEGER PRIMARY KEY, owner INTEGER, category TEXT DEFAULT 'Tecnología',price INTEGER DEFAULT 0,
 status TEXT DEFAULT 'draft', modules TEXT DEFAULT '[]');
 CREATE TABLE IF NOT EXISTS studio_upload(id TEXT PRIMARY KEY,course INTEGER,lesson TEXT,kind TEXT,size INTEGER,revision INTEGER,expires INTEGER);
 CREATE TABLE IF NOT EXISTS studio_events(id INTEGER PRIMARY KEY,course INTEGER,actor TEXT,action TEXT,created TEXT DEFAULT CURRENT_TIMESTAMP);`);
const meta=db.prepare('SELECT c.*,s.owner,s.category,s.price,s.status,s.modules FROM courses c LEFT JOIN studio s ON s.course=c.id WHERE c.id=?');
const error=(status,message)=>{throw Object.assign(new Error(message),{status});};
const bad=()=>error(422,'Revisa los campos del formulario.');
const stale=()=>error(409,'El curso ha cambiado. Vuelve a abrirlo antes de guardar.');
function field(f,key,max,optional=false){
 const value=(f.get(key)||'').trim();
 if(value.length>max||(!optional&&!value))bad();
 return value;
}
async function readBody(req,limit){
 const chunks=[];let size=0;
 for await(const chunk of req){size+=chunk.length;if(size>limit)error(413,'Archivo o formulario demasiado grande.');chunks.push(chunk);}
 return Buffer.concat(chunks);
}
function transaction(fn){
 db.exec('BEGIN IMMEDIATE');
 try{const result=fn();db.exec('COMMIT');return result;}catch(err){db.exec('ROLLBACK');throw err;}
}
function input(label,key,value='',max=160){
 return `<label>${label}<input name="${key}" maxlength="${max}" value="${e(value)}" required></label>`;
}
function area(label,key,value='',max=12000){
 return `<label>${label}<textarea name="${key}" maxlength="${max}">${e(value)}</textarea></label>`;
}
const hidden=(key,value)=>`<input type="hidden" name="${key}" value="${e(value)}">`;
function form(action,revision,body,label,ids={}){
 return `<form method="post">${hidden('action',action)}${hidden('revision',revision)}${Object.entries(ids).map(([k,v])=>hidden(k,v)).join('')}${body}<button>${label}</button></form>`;
}
function move(list,id,step){
 const from=list.findIndex(x=>x.id===id),to=from+Number(step);
 if(from<0||!['-1','1'].includes(step)||to<0||to>=list.length)bad();
 [list[from],list[to]]=[list[to],list[from]];
}
function ordering(rev,action,list,item,ids){
 const i=list.indexOf(item);
 return [-1,1].filter(step=>i+step>=0&&i+step<list.length).map(step=>form(action,rev,'',step<0?'Subir':'Bajar',{...ids,step})).join('');
}
function signature(course,asset,actor,until){
 return createHmac('sha256',signingKey).update([course,asset,actor,until].join('|')).digest('hex');
}
function mediaLink(base,course,asset,actor){
 const until=Date.now()+2*3600000;
 return `${base}/${course}/media/${asset.id}?hasta=${until}&amp;firma=${signature(course,asset.id,actor,until)}`;
}
function materials(ctx,lesson){
 return ['video','pdf'].map(kind=>{
  const asset=lesson[kind];if(!asset)return '';
  const url=mediaLink(ctx.base,ctx.course.id,asset,ctx.actor);
  return kind==='video'?`<video controls playsinline preload="metadata" aria-label="Vídeo de la lección" src="${url}"></video>`:`<p><a href="${url}">Descargar PDF de la lección</a></p>`;
 }).join('');
}
function quizForm(rev,l,ids){
 const q=l.quiz||{prompt:'',options:['','',''],correct:0};
 return form('quiz',rev,input('Pregunta','prompt',q.prompt,500)+q.options.map((v,i)=>input('Opción '+(i+1),'opt'+i,v,240)).join('')+
 `<label>Respuesta correcta<select name="correct">${q.options.map((_,i)=>`<option value="${i}" ${q.correct===i?'selected':''}>${i+1}</option>`).join('')}</select></label>`,'Guardar pregunta',ids);
}
function editModule(ctx,m){
 const {course:c,modules,base}=ctx,rev=c.revision,mid={module:m.id};
 return `<section><h2>${e(m.title)}</h2><details><summary>Editar módulo</summary>${form('module-edit',rev,input('Título','title',m.title),'Guardar módulo',mid)}${ordering(rev,'module-move',modules,m,mid)}</details>
 ${m.lessons.map(l=>{
 const ids={...mid,lesson:l.id};
 return `<details><summary>${e(l.title)}</summary>${form('lesson-edit',rev,input('Título','title',l.title)+area('Contenido','body',l.body),'Guardar lección',ids)}
 ${ordering(rev,'lesson-move',m.lessons,l,ids)}${materials(ctx,l)}
 ${['video','pdf'].map(k=>`<form data-upload method="post" action="${base}/${c.id}/subir/${l.id}/${k}">${hidden('revision',rev)}<label>${k==='video'?'Vídeo MP4':'Documento PDF'} (hasta 100 MB)<input type="file" name="archivo" accept="${k==='video'?'video/mp4':'application/pdf'}" required></label><button>Subir archivo</button> <output aria-live="polite"></output></form>`).join('')}
 <details><summary>Pregunta de repaso</summary>${quizForm(rev,l,ids)}</details></details>`;
 }).join('')}${form('lesson-add',rev,input('Nueva lección','title')+area('Contenido','body'),'Añadir lección',mid)}</section>`;
}
function preview(ctx,answers){
 return ctx.modules.map(m=>`<section><h2>${e(m.title)}</h2>${m.lessons.map(l=>{
 const q=l.quiz;
 return `<article><h3>${e(l.title)}</h3><div class="lesson-text">${e(l.body)}</div>${materials(ctx,l)}
 ${q?`<form method="get"><fieldset><legend>${e(q.prompt)}</legend>${q.options.map((v,i)=>`<label><input type="radio" name="r_${l.id}" value="${i}" required>${e(v)}</label>`).join('')}</fieldset><button>Comprobar respuesta</button></form>
 ${answers.has('r_'+l.id)?'<p role="status">'+(answers.get('r_'+l.id)===String(q.correct)?'Respuesta correcta.':'Inténtalo de nuevo.')+'</p>':''}`:''}</article>`;
 }).join('')}</section>`).join('');
}
function removeFile(id){try{unlinkSync(join(files,id));}catch(err){if(err.code!=='ENOENT')throw err;}}
function bump(c){if(!db.prepare('UPDATE courses SET revision=revision+1 WHERE id=? AND revision=?').run(c.id,c.revision).changes)stale();}
function audit(c,actor,action){db.prepare('INSERT INTO studio_events(course,actor,action) VALUES(?,?,?)').run(c.id,actor,action);}
function persist(ctx){db.prepare('UPDATE studio SET modules=? WHERE course=?').run(JSON.stringify(ctx.modules),ctx.course.id);}
function assertDraft(c,revision){
 if(c.status==='review')error(409,'Retira el envío antes de editar.');
 if(String(c.revision)!==String(revision))stale();
}
function findLesson(modules,id){return modules.flatMap(m=>m.lessons).find(l=>l.id===id);}
function publicMedia(req,res,ctx,id){
 const u=new URL(req.url,'http://localhost'),until=Number(u.searchParams.get('hasta'));
 if(!Number.isSafeInteger(until)||until<Date.now()||u.searchParams.get('firma')!==signature(ctx.course.id,id,ctx.actor,until))error(403,'Enlace caducado. Abre la vista previa de nuevo.');
 const asset=ctx.modules.flatMap(m=>m.lessons).flatMap(l=>[l.video,l.pdf]).find(a=>a?.id===id);
 if(!asset)error(404,'Archivo no encontrado.');
 return serveAsset(req,res,asset);
}
async function upload(req,res,ctx,parts,send){
 const {course:c,modules,base}=ctx;
 if(parts[1]==='subir'){
  const f=new URLSearchParams((await readBody(req,4096)).toString()),size=Number(f.get('size')),kind=parts[3];
  assertDraft(c,f.get('revision'));
  if(!findLesson(modules,parts[2])||!['pdf','video'].includes(kind)||!Number.isSafeInteger(size)||size<12||size>100*1024*1024)bad();
  for(const row of db.prepare('SELECT id FROM studio_upload WHERE expires<?').all(Date.now())){removeFile(row.id);db.prepare('DELETE FROM studio_upload WHERE id=?').run(row.id);}
  if(db.prepare('SELECT count(*) AS n FROM studio_upload WHERE course=?').get(c.id).n>=8)error(429,'Hay varias cargas pendientes. Espera a que finalicen.');
  const id=randomUUID();closeSync(openSync(join(files,id),'wx',0o600));
  db.prepare('INSERT INTO studio_upload VALUES(?,?,?,?,?,?,?)').run(id,c.id,parts[2],kind,size,c.revision,Date.now()+3600000);
  return send(res,200,JSON.stringify({url:base+'/'+c.id+'/carga/'+id}),'application/json');
 }
 const chunk=await readBody(req,512*1024),u=db.prepare('SELECT * FROM studio_upload WHERE id=? AND course=? AND expires>?').get(parts[2],c.id,Date.now());
 if(!u)error(404,'Carga no encontrada.');
 const user=identity(req).id;
 if(ctx.actor!=='admin' && (!user || meta.get(c.id)?.owner!==user || !users.prepare('SELECT 1 FROM instructors WHERE user_id=?').get(user)))error(403,'Acceso denegado.');
 assertDraft(meta.get(c.id),u.revision);
 const fd=openSync(join(files,u.id),'r+');
 try{
  const offset=fstatSync(fd).size;
  if(offset!==Number(parts[3])||!chunk.length||offset+chunk.length>u.size)error(409,'Bloque de archivo no válido.');
  if(!offset && !(u.kind==='pdf'?chunk.subarray(0,5).toString()==='%PDF-':chunk.subarray(4,8).toString()==='ftyp')){
   db.prepare('DELETE FROM studio_upload WHERE id=?').run(u.id);removeFile(u.id);bad();
  }
  let written=0;
  while(written<chunk.length)written+=writeSync(fd,chunk,written,chunk.length-written,offset+written);
  if(offset+written===u.size){
   const lesson=findLesson(modules,u.lesson),old=lesson[u.kind];
   transaction(()=>{bump(c);lesson[u.kind]={id:u.id,type:u.kind==='pdf'?'application/pdf':'video/mp4'};persist(ctx);
    audit(c,ctx.actor,'upload-'+u.kind);db.prepare('DELETE FROM studio_upload WHERE id=?').run(u.id);});
   if(old&&!db.prepare('SELECT 1 FROM release_assets WHERE asset=?').get(old.id))removeFile(old.id);
  }
 }finally{closeSync(fd);}
 return send(res,204,'','text/plain');
}
function applyEdit(ctx,f,admin){
 const {course:c,modules,actor}=ctx,action=f.get('action');
 if(['approve','changes','reject'].includes(action)){
  if(!admin)error(403,'Solo administración puede emitir una decisión.');
  if(c.status!=='review'||String(c.revision)!==f.get('revision'))stale();
  if(action==='approve'&&(!c.owner||!users.prepare('SELECT 1 FROM instructors WHERE user_id=?').get(c.owner)))
   error(422,'Asigna el curso a un instructor verificado antes de publicarlo.');
  const feedback=field(f,'feedback',2000,action==='approve');
  recordDecision(c,action,feedback);
  db.prepare("UPDATE studio SET status='draft' WHERE course=?").run(c.id);
  bump(c);audit(c,actor,action);return;
 }
 if(action==='withdraw'){
  if(c.status!=='review'||String(c.revision)!==f.get('revision'))stale();
  db.prepare("UPDATE studio SET status='draft' WHERE course=?").run(c.id);
 }else{
  assertDraft(c,f.get('revision'));
  const mod=modules.find(m=>m.id===f.get('module'));
  const lesson=mod?.lessons.find(l=>l.id===f.get('lesson'));
  switch(action){
   case 'translate':saveTranslation(c,modules,f);break;
   case 'details':{
    const title=field(f,'title',160),outline=field(f,'outline',12000,true),category=f.get('category'),price=Number(f.get('price'));
    if(!categories.includes(category)||!f.get('price')||!Number.isSafeInteger(price)||price<0||price>100000000)bad();
    db.prepare('UPDATE courses SET title=?,outline=? WHERE id=?').run(title,outline,c.id);
    db.prepare('UPDATE studio SET category=?,price=? WHERE course=?').run(category,price,c.id);break;
   }
   case 'assign':{
    if(!admin)error(403,'Acceso denegado.');
    const owner=users.prepare('SELECT user_id FROM instructors JOIN students ON students.id=user_id WHERE username=?').get(field(f,'usuario',40).toLowerCase());
    if(!owner)error(422,'El usuario debe tener el rol de instructor.');
    db.prepare('UPDATE studio SET owner=? WHERE course=?').run(owner.user_id,c.id);break;
   }
   case 'module-add':modules.push({id:randomUUID(),title:field(f,'title',160),lessons:[]});break;
   case 'module-edit':if(!mod)bad();mod.title=field(f,'title',160);break;
   case 'module-move':move(modules,f.get('module'),f.get('step'));break;
   case 'lesson-add':if(!mod)bad();mod.lessons.push({id:randomUUID(),title:field(f,'title',160),body:field(f,'body',12000,true)});break;
   case 'lesson-edit':if(!lesson)bad();lesson.title=field(f,'title',160);lesson.body=field(f,'body',12000,true);break;
   case 'lesson-move':if(!mod)bad();move(mod.lessons,f.get('lesson'),f.get('step'));break;
   case 'quiz':{
    if(!lesson||!['0','1','2'].includes(f.get('correct')))bad();
    lesson.quiz={prompt:field(f,'prompt',500),options:[0,1,2].map(i=>field(f,'opt'+i,240)),correct:Number(f.get('correct'))};break;
   }
   case 'submit':
    if(!modules.length||modules.some(m=>!m.lessons.length||m.lessons.some(l=>!l.body&&!l.video&&!l.pdf)))error(422,'Cada módulo necesita una lección con texto, vídeo o PDF.');
    db.prepare("UPDATE studio SET status='review' WHERE course=?").run(c.id);break;
   default:bad();
  }
 }
 persist(ctx);bump(c);audit(c,actor,action);
}
export async function studio(req,res,path,send,admin){
 const base=admin?'/admin/estudio':'/cuenta/instructor/estudio',user=identity(req).id;
 if(!admin&&(!user||!users.prepare('SELECT 1 FROM instructors WHERE user_id=?').get(user)))error(403,'Se necesita una cuenta de instructor.');
 const actor=admin?'admin':'instructor-'+user;
 const redirect=url=>send(res,303,'','text/plain',{Location:url});
 const get=req.method==='GET';if(!get&&req.method!=='POST')error(405,'Método no permitido.');
 const page=(title,body,script=false)=>send(res,200,layout(title,`<h1>${title}</h1>${body}${script?'<script src="/estudio-upload.js" defer></script>':''}`,admin?'/admin/cursos':'/espacios/instructor',admin,
  `<nav aria-label="Estudio"><a href="${admin?'/admin':'/cuenta'}">${admin?'Administración':'Mi cuenta'}</a><a href="${base}">Mis cursos</a></nav>`),'text/html; charset=utf-8',script?{'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"}:{});
 if(admin&&path===base+'/revision'&&get){
  const rows=db.prepare("SELECT c.id,c.title,s.price FROM courses c JOIN studio s ON s.course=c.id WHERE s.status='review' ORDER BY c.id").all();
  return page('Cola de revisión','<a href="/admin/cuentas">Verificar instructores</a>'+ (rows.length?'<ul>'+rows.map(r=>`<li><a href="${base}/${r.id}">${e(r.title)}</a> · ${r.price} XAF</li>`).join('')+'</ul>':'<p>No hay cursos pendientes de revisión.</p>'));
 }
 if(path===base){
  if(get){
   const rows=admin?db.prepare('SELECT c.id,title,status FROM courses c LEFT JOIN studio s ON s.course=c.id ORDER BY c.id DESC').all():
    db.prepare('SELECT c.id,title,status FROM courses c JOIN studio s ON s.course=c.id WHERE owner=? ORDER BY c.id DESC').all(user);
   return page('Estudio de cursos',form('create',0,input('Título del curso','title'),'Crear borrador')+
    `<section><h2>Cursos</h2><ul>${rows.map(r=>`<li><a href="${base}/${r.id}">${e(r.title)}</a> · ${r.status==='review'?'En revisión':'Borrador'}</li>`).join('')}</ul></section>`);
  }
  const f=new URLSearchParams((await readBody(req,8192)).toString());
  if(f.get('action')!=='create')bad();
  const id=transaction(()=>{const id=db.prepare("INSERT INTO courses(title,outline) VALUES(?,'')").run(field(f,'title',160)).lastInsertRowid;
   db.prepare('INSERT INTO studio(course,owner) VALUES(?,?)').run(id,admin?null:user);audit({id},actor,'create');return id;});
  return redirect(base+'/'+id);
 }
 const parts=path.slice(base.length+1).split('/');
 if(!/^[1-9]\d*$/.test(parts[0]))error(404,'Curso no encontrado.');
 const c=meta.get(parts[0]);
 if(!c||(!admin&&c.owner!==user))error(404,'Curso no encontrado.');
 const ctx={course:c,modules:JSON.parse(c.modules||'[]'),base,actor},url=base+'/'+c.id;
 if(get&&parts.length===3&&parts[1]==='media')return publicMedia(req,res,ctx,parts[2]);
 if(!get&&parts.length===4&&['subir','carga'].includes(parts[1]))return upload(req,res,ctx,parts,send);
 if(get&&parts.length===2&&parts[1]==='vista'){
  const local=localizedContent({title:c.title,description:c.outline,modules:ctx.modules,translations:translations(c.id)});
  return page('Vista previa · '+e(local.title),`<p><a href="${url}">Volver al curso</a></p><p class="lesson-text">${e(local.description)}</p>`+preview({...ctx,modules:local.modules},new URL(req.url,'http://localhost').searchParams));
 }
 if(get&&parts.length===3&&parts[1]==='idioma'&&['es','en','fr'].includes(parts[2])){
  if(c.status==='review')error(409,'Retira el envío antes de editar.');
  const name={es:'Español',en:'English',fr:'Français'}[parts[2]];
  return page('Traducciones del curso · '+name,'<p><a href="'+url+'">Volver al curso</a></p>'+translationForm(c,ctx.modules,parts[2]).replace('<form method="post">','<form method="post" action="'+url+'">'));
 }
 if(parts.length!==1)error(404,'Página no encontrada.');
 if(!get){
  const f=new URLSearchParams((await readBody(req,900000)).toString());
  transaction(()=>{
   if(!admin && (meta.get(c.id)?.owner!==user || !users.prepare('SELECT 1 FROM instructors WHERE user_id=?').get(user)))error(403,'Acceso denegado.');
   db.prepare('INSERT OR IGNORE INTO studio(course) VALUES(?)').run(c.id);
   applyEdit(ctx,f,admin);
  });
  return redirect(url);
 }
 const rev=c.revision;
 const decisions=db.prepare('SELECT * FROM review_log WHERE course=? ORDER BY id DESC').all(c.id);
 const labels={approve:'Publicación aprobada',changes:'Cambios solicitados',reject:'Publicación rechazada'};
 const history=decisions.length?`<details><summary>Historial de revisión y precios</summary><ul>${decisions.map(d=>`<li>${d.created} UTC · ${labels[d.decision]} · ${d.price} XAF · ${e(d.feedback)}</li>`).join('')}</ul></details>`:'';
 const versions=db.prepare('SELECT version,price FROM releases WHERE course=? ORDER BY version DESC').all(c.id);
 const releases=versions.length?`<p>Versión publicada: ${versions[0].version} · ${versions[0].price} XAF · <a href="/espacios/estudiante/catalogo/curso-${c.id}-v${versions[0].version}">Abrir en el catálogo</a></p>`:'';
 const common=history+releases+`<p>${c.status==='review'?'En revisión':'Borrador'} · <a href="${url}/vista">Vista previa del alumno</a></p>`;
 if(c.status==='review')return page(e(c.title),common+`<p>Precio propuesto: ${c.price} XAF · Instructor: ${e(c.owner?users.prepare('SELECT username FROM students WHERE id=?').get(c.owner)?.username||'Sin asignar':'Sin asignar')}</p>`+
  (admin?`<form method="post">${hidden('revision',rev)}${area('Comentarios para el instructor','feedback','',2000)}
  <button name="action" value="approve">Aprobar contenido y precio y publicar</button>
  <button name="action" value="changes">Solicitar cambios</button> <button name="action" value="reject">Rechazar</button></form>`:'')+form('withdraw',rev,'','Retirar envío para editar'));
 const details=input('Título','title',c.title)+area('Programa original o resumen','outline',c.outline)+
 `<label>Categoría<select name="category">${categories.map(k=>`<option ${k===c.category?'selected':''} value="${k}">${k}</option>`).join('')}</select></label>
 <label>Precio propuesto (XAF)<input name="price" type="number" min="0" max="100000000" value="${c.price||0}" required></label>`;
 return page(e(c.title),common+`<section><h2>Traducciones del curso</h2><nav><a href="${url}/idioma/es">Español</a><a href="${url}/idioma/en">English</a><a href="${url}/idioma/fr">Français</a></nav></section>`+form('details',rev,details,'Guardar datos del curso')+
 (admin?form('assign',rev,input('Usuario instructor','usuario',c.owner?users.prepare('SELECT username FROM students WHERE id=?').get(c.owner)?.username||'':'',40),'Asignar curso'):'')+
 ctx.modules.map(m=>editModule(ctx,m)).join('')+form('module-add',rev,input('Nuevo módulo','title'),'Añadir módulo')+
 form('submit',rev,'','Enviar a revisión'),true);
}
