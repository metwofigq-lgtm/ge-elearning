import { layout } from './layout.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const directory = process.env.GE_COURSE_DIR || join(process.env.HOME, '.local/share/ge-elearning');
mkdirSync(directory, { recursive: true, mode: 0o700 });
const db = new DatabaseSync(join(directory, 'courses.sqlite'));
db.exec(`CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, outline TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1
)`);

function escape(value) {
  return String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[ch]));
}

function page(content) {
  return layout('Estudio de cursos',content,'/admin/cursos',true);
}

function editor(course, message='') {
  return page(`<h1>${course.id ? 'Editar borrador' : 'Crear nuevo curso'}</h1>
  ${message ? '<p role="alert">'+escape(message)+'</p>' : ''}
  <form method="post"><input type="hidden" name="revision" value="${escape(course.revision || 0)}">
  <label for="title">Título del curso</label><input id="title" name="title" maxlength="160" required value="${escape(course.title)}">
  <label for="outline">Programa del curso</label><small id="hint">Escribe los módulos y sus lecciones, uno por línea.</small>
  <textarea id="outline" name="outline" aria-describedby="hint" maxlength="12000">${escape(course.outline)}</textarea>
  <button>Guardar borrador</button></form>`);
}

export async function courses(req,res,path,send) {
  const base='/admin/cursos';
  if(path===base && req.method==='GET'){
    const rows=db.prepare('SELECT id,title FROM courses ORDER BY id DESC').all();
    return send(res,200,page(`<h1>Estudio de cursos</h1><a class="action" href="${base}/nuevo">Crear nuevo curso</a><section><h2>Borradores (${rows.length})</h2>${rows.length ? '<ul>'+rows.map(row=>`<li><a href="${base}/${row.id}">${escape(row.title)}</a></li>`).join('')+'</ul>' : '<p>Todavía no hay borradores.</p>'}</section>`));
  }
  const match=path.match(/^\/admin\/cursos\/(nuevo|[1-9]\d*)$/);
  if(!match)return send(res,404,page('<h1>Curso no encontrado</h1>'));
  const create=match[1]==='nuevo';
  const course=create ? {title:'',outline:''} : db.prepare('SELECT * FROM courses WHERE id=?').get(match[1]);
  if(!course)return send(res,404,page('<h1>Curso no encontrado</h1>'));
  if(req.method==='GET'){
    const saved=new URL(req.url,'http://localhost').searchParams.get('guardado')==='1';
    return send(res,200,editor(course,saved ? 'Borrador guardado.' : ''));
  }
  if(req.method!=='POST')return send(res,405,'Método no permitido');
  const chunks=[];let size=0;
  for await(const chunk of req){
    size+=chunk.length;
    if(size>160000)return send(res,413,'Formulario demasiado grande');
    chunks.push(chunk);
  }
  const fields=new URLSearchParams(Buffer.concat(chunks).toString());
  const title=(fields.get('title') || '').trim(), outline=(fields.get('outline') || '').trim();
  const revision=Number(fields.get('revision'));
  if(!title || title.length>160 || outline.length>12000)return send(res,422,editor({...course,title,outline,revision},'Revisa el título y la longitud del programa.'));
  let id=course.id;
  if(create){
    id=db.prepare('INSERT INTO courses(title,outline) VALUES(?,?)').run(title,outline).lastInsertRowid;
  }else{
    const latest=db.prepare('SELECT title,outline FROM courses WHERE id=?').get(id);
    if(latest && latest.title===title && latest.outline===outline){
      return send(res,303,'','text/plain',{Location:base+'/'+id+'?guardado=1'});
    }
    const updated=db.prepare('UPDATE courses SET title=?,outline=?,revision=revision+1 WHERE id=? AND revision=?').run(title,outline,id,revision);
    if(!updated.changes)return send(res,409,editor({...course,title,outline,revision},'Otra sesión ha guardado cambios. Copia tu texto y vuelve a abrir el curso antes de continuar.'));
  }
  return send(res,303,'','text/plain',{Location:base+'/'+id+'?guardado=1'});
}
