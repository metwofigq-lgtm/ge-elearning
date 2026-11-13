import { db, escape } from './courses.js';
import { locale } from './i18n.js';

db.exec(`CREATE TABLE IF NOT EXISTS course_languages(course INTEGER NOT NULL, language TEXT NOT NULL,
 content TEXT NOT NULL, PRIMARY KEY(course,language));`);

export function translations(course){
 return Object.fromEntries(db.prepare('SELECT language,content FROM course_languages WHERE course=?').all(course)
  .map(row=>[row.language,JSON.parse(row.content)]));
}

function fields(course,modules){
 const entries=[['title','Título',course.title,160],['description','Programa del curso',course.outline||course.description,12000]];
 for(const m of modules){
  entries.push([m.id,'Título',m.title,160]);
  for(const l of m.lessons){
   entries.push([l.id,'Título',l.title,160],[l.id+'-text','Contenido',l.body,12000]);
   if(l.quiz){
    entries.push([l.id+'-quiz','Pregunta',l.quiz.prompt,500]);
    l.quiz.options.forEach((v,i)=>entries.push([l.id+'-opt'+i,'Opción '+(i+1),v,240]));
   }
  }
 }
 return entries;
}
export function translationForm(course,modules,language){
 const data=translations(course.id)[language]||{};
 return `<form method="post"><input type="hidden" name="action" value="translate"><input type="hidden" name="language" value="${language}"><input type="hidden" name="revision" value="${course.revision}">
 ${fields(course,modules).map(([key,label,original,max])=>`<label>${label} · ${escape(original||'')}<textarea name="tr-${key}" maxlength="${max}">${escape(data[key]||'')}</textarea></label>`).join('')}
 <button>Guardar traducción</button></form>`;
}
export function saveTranslation(course,modules,form){
 const language=form.get('language');
 if(!['es','en','fr'].includes(language))throw Object.assign(Error('Revisa los campos del formulario.'),{status:422});
 const data={};
 for(const [key,, ,max] of fields(course,modules)){
  const value=(form.get('tr-'+key)||'').trim();
  if(value.length>max)throw Object.assign(Error('Formulario demasiado grande'),{status:422});
  if(value)data[key]=value;
 }
 db.prepare('INSERT INTO course_languages VALUES(?,?,?) ON CONFLICT(course,language) DO UPDATE SET content=excluded.content').run(course.id,language,JSON.stringify(data));
}
export function localizedContent(snapshot,language=locale()){
 const tr=snapshot.translations?.[language]||{};
 return {...snapshot,title:tr.title||snapshot.title,description:tr.description||snapshot.description,
  modules:snapshot.modules.map(m=>({...m,title:tr[m.id]||m.title,lessons:m.lessons.map(l=>({...l,
   title:tr[l.id]||l.title,body:tr[l.id+'-text']||l.body,quiz:l.quiz&&{...l.quiz,
    prompt:tr[l.id+'-quiz']||l.quiz.prompt,options:l.quiz.options.map((v,i)=>tr[l.id+'-opt'+i]||v)}
  }))}))};
}
