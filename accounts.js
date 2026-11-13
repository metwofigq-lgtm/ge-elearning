import { db, identity } from './student.js';
import { layout } from './layout.js';

db.exec(`CREATE TABLE IF NOT EXISTS profiles(
 user_id INTEGER PRIMARY KEY REFERENCES students, display_name TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS instructors(user_id INTEGER PRIMARY KEY REFERENCES students);
 CREATE TABLE IF NOT EXISTS institutions(id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, description TEXT NOT NULL DEFAULT '');
 CREATE TABLE IF NOT EXISTS memberships(
 institution_id INTEGER REFERENCES institutions, user_id INTEGER REFERENCES students, role TEXT NOT NULL,
 PRIMARY KEY(institution_id,user_id,role));`);

const roles=new Map([['director','Dirección'],['coordinador','Coordinación académica'],['docente','Docente'],['finanzas','Finanzas'],['estudiante','Estudiante']]);
function escape(value){
 return String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function form(action,fields,submit){
 return `<form method="post"><input type="hidden" name="accion" value="${action}">${fields}<button>${submit}</button></form>`;
}
export async function accounts(req,res,path,send){
 const admin=path==='/admin/cuentas'; // The server checks the separate administrator session before dispatch.
 const {id}=identity(req);
 const redirect=target=>send(res,303,'','text/plain',{Location:target});
 if(!admin&&!id)return redirect('/espacios/estudiante/acceso?destino=cuenta');
 const post=req.method==='POST';
 if(!post&&req.method!=='GET')return send(res,405,'Método no permitido');
 const fields=new URLSearchParams();
 if(post){
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>8192)return send(res,413,'Formulario demasiado grande');chunks.push(chunk);}
  for(const [key,value] of new URLSearchParams(Buffer.concat(chunks).toString()))fields.set(key,value.trim());
 }
 const action=fields.get('accion');
 const page=(title,body,status=200)=>send(res,status,layout(title,`<h1>${title}</h1>${body}`,admin?path:'/espacios/estudiante',admin,
  admin?'':'<nav aria-label="Cuenta"><a href="/cuenta">Mi perfil y espacios</a><a href="/espacios/estudiante/aprendizaje">Mi aprendizaje</a></nav>'));
 const denied=()=>page('Acceso denegado','<p>Tu cuenta no tiene acceso a esta función.</p>',403);
 if(admin){
  if(post){
   if(action==='institucion'){
    const name=fields.get('nombre')||'';
    if(!name||name.length>100)return page('Nombre no válido','<a href="/admin/cuentas">Volver</a>',422);
    db.prepare('INSERT OR IGNORE INTO institutions(name) VALUES(?)').run(name);
   }else{
    const user=db.prepare('SELECT id FROM students WHERE username=?').get((fields.get('usuario')||'').toLowerCase());
    if(!user)return page('Cuenta no encontrada','<p>La persona debe registrarse primero.</p><a href="/admin/cuentas">Volver</a>',422);
    const role=fields.get('rol'),tenant=fields.get('institucion');
    if(!['conceder','retirar'].includes(action))return denied();
    if(role==='instructor' && !tenant){
     if(action==='conceder')db.prepare('INSERT OR IGNORE INTO instructors VALUES(?)').run(user.id);
     else db.prepare('DELETE FROM instructors WHERE user_id=?').run(user.id);
    }else if(roles.has(role)&&db.prepare('SELECT id FROM institutions WHERE id=?').get(tenant)){
     if(action==='conceder')db.prepare('INSERT OR IGNORE INTO memberships VALUES(?,?,?)').run(tenant,user.id,role);
     else db.prepare('DELETE FROM memberships WHERE institution_id=? AND user_id=? AND role=?').run(tenant,user.id,role);
    }else return page('Asignación no válida','<p>Selecciona una institución para los roles institucionales. Para instructor independiente, elige «Sin institución».</p><a href="/admin/cuentas">Volver</a>',422);
   }
   return redirect(path);
  }
  const tenants=db.prepare('SELECT * FROM institutions ORDER BY name').all();
  const grants=db.prepare(`SELECT s.username,i.name,m.role FROM memberships m JOIN institutions i ON i.id=m.institution_id JOIN students s ON s.id=m.user_id
   UNION ALL SELECT s.username,'','instructor' FROM instructors r JOIN students s ON s.id=r.user_id ORDER BY 1,2,3`).all();
  return page('Cuentas y permisos',form('institucion','<label>Nueva institución<input name="nombre" maxlength="100" required></label>','Crear institución')+
   `<form method="post"><label>Usuario registrado<input name="usuario" required></label><label>Institución<select name="institucion"><option value="">Sin institución</option>${tenants.map(t=>`<option value="${t.id}">${escape(t.name)}</option>`).join('')}</select></label>
   <label>Rol<select name="rol"><option value="instructor">Instructor independiente</option>${[...roles].map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label>
   <button name="accion" value="conceder">Conceder acceso</button> <button name="accion" value="retirar">Retirar acceso</button></form>
   <section><h2>Permisos asignados</h2><ul>${grants.map(g=>`<li>${escape(g.username)} · ${roles.get(g.role)||'Instructor independiente'} ${escape(g.name)}</li>`).join('')}</ul></section>`);
 }
 if(path==='/cuenta'){
  if(post){
   const name=fields.get('nombre')||'';
   if(action!=='perfil'||!name||name.length>100)return page('Perfil no válido','<a href="/cuenta">Volver</a>',422);
   db.prepare('INSERT INTO profiles VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET display_name=excluded.display_name').run(id,name);
   return redirect(path);
  }
  const profile=db.prepare('SELECT username,display_name FROM students LEFT JOIN profiles ON user_id=students.id WHERE students.id=?').get(id);
  const spaces=db.prepare('SELECT i.id,i.name,m.role FROM memberships m JOIN institutions i ON i.id=m.institution_id WHERE m.user_id=? ORDER BY i.name,m.role').all(id);
  const instructor=db.prepare('SELECT 1 FROM instructors WHERE user_id=?').get(id);
  return page('Mi perfil y espacios',form('perfil',`<p>Usuario: ${escape(profile.username)}</p><label>Nombre visible<input name="nombre" value="${escape(profile.display_name||profile.username)}" maxlength="100" required></label>`,'Guardar perfil')+
   `<section><h2>Mis accesos</h2><ul><li><a href="/espacios/estudiante/aprendizaje">Estudiante</a></li>${instructor?'<li><a href="/cuenta/instructor">Instructor independiente</a></li>':''}
   ${spaces.map(s=>`<li><a href="/cuenta/instituciones/${s.id}">${escape(s.name)}</a> · ${roles.get(s.role)}</li>`).join('')}</ul></section>
   <form action="/espacios/estudiante/salir" method="post"><button>Cerrar sesión</button></form>`);
 }
 if(path==='/cuenta/instructor'){
  if(!db.prepare('SELECT 1 FROM instructors WHERE user_id=?').get(id))return denied();
  return post?denied():page('Espacio de instructor','<p><a class="action" href="/cuenta/instructor/estudio">Abrir estudio de cursos</a></p>');
 }
 const match=path.match(/^\/cuenta\/instituciones\/([1-9]\d*)$/);
 if(!match)return page('Página no encontrada','',404);
 const tenant=match[1];
 const assigned=db.prepare('SELECT role FROM memberships WHERE institution_id=? AND user_id=?').all(tenant,id).map(r=>r.role);
 if(!assigned.length)return denied();
 const org=db.prepare('SELECT * FROM institutions WHERE id=?').get(tenant);
 if(post){
  if(action!=='descripcion'||!assigned.includes('director'))return denied();
  const description=fields.get('descripcion')||'';
  if(description.length>1000)return page('Descripción demasiado larga','',422);
  db.prepare('UPDATE institutions SET description=? WHERE id=?').run(description,tenant);
  return redirect(path);
 }
 return page(escape(org.name),`<p>Tus roles: ${assigned.map(r=>roles.get(r)).join(', ')}</p><section><h2>Información de la institución</h2><p>${escape(org.description)}</p></section>`+
  (assigned.includes('director')?form('descripcion',`<label>Descripción privada<textarea name="descripcion" maxlength="1000">${escape(org.description)}</textarea></label>`,'Guardar descripción'):''));
}
