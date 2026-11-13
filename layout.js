import { languageMenu } from './i18n.js';
const spaces = [
  { slug:'estudiante', name:'Estudiante', summary:'Cursos, aprendizaje y progreso.', sections:[
    ['catalogo','Catálogo','Aquí podrás explorar los cursos publicados.'],
    ['aprendizaje','Mi aprendizaje','Aquí encontrarás los cursos en los que te matricules.'],
    ['progreso','Mi progreso','Aquí podrás consultar las lecciones y evaluaciones completadas.']] },
  { slug:'instructor', name:'Instructor', summary:'Creación, revisión y seguimiento de cursos.', sections:[
    ['cursos','Mis cursos','Aquí podrás organizar tus cursos, módulos y lecciones.'],
    ['revision','En revisión','Aquí podrás seguir los cursos enviados para aprobación.'],
    ['ingresos','Ingresos','Aquí podrás consultar ventas, comisiones y pagos.']] },
  { slug:'institucion', name:'Institución', summary:'Clases, equipo docente y alumnado.', sections:[
    ['clases','Clases','Aquí podrás organizar las clases de tu institución.'],
    ['docentes','Docentes','Aquí podrás consultar el equipo docente y sus asignaciones.'],
    ['alumnado','Alumnado','Aquí podrás gestionar las matrículas de tu institución.']] }
];

export function nav(items, current, label) {
  return `<nav aria-label="${label}">${items.map(([url,name]) =>
    `<a href="${url}"${url===current?' aria-current="page"':''}>${name}</a>`).join('')}</nav>`;
}

export function layout(title, content, current, admin=false, localNav='') {
  const links=admin ? [['/admin','Panel'],['/admin/cursos','Cursos'],['/admin/cuentas','Cuentas'],['/','Inicio público']] :
    [['/','Inicio'],...spaces.map(s=>['/espacios/'+s.slug,s.name])];
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${title} · GE E-Learning</title><link rel="stylesheet" href="/estilos.css"></head>
    <body><a class="skip" href="#contenido">Ir al contenido</a><header><div class="bar"><a class="brand" href="${admin?'/admin':'/'}">GE E-Learning</a>
    ${admin?'<form method="post" action="/logout"><button>Cerrar sesión</button></form>':'<a href="/login">Administración</a>'}</div></header>${languageMenu()}
    <div class="navwrap">${nav(links,current,'Principal')}</div><main id="contenido" tabindex="-1">${localNav}${content}</main></body></html>`;
}

export function workspace(path) {
  for(const space of spaces){
    const base='/espacios/'+space.slug;
    const tabs=[[base,'Resumen'],...space.sections.map(([slug,label])=>[base+'/'+slug,label])];
    const selected=tabs.find(([url])=>url===path);
    if(!selected)continue;
    const section=space.sections.find(([slug])=>base+'/'+slug===path);
    const content=section ? `<h2>${section[1]}</h2><p>${section[2]}</p>` :
      `<a class="action" href="/cuenta">Entrar en mi espacio</a><h2>Secciones</h2><ul>${tabs.slice(1).map(([url,label])=>`<li><a href="${url}">${label}</a></li>`).join('')}</ul>`;
    return layout(selected[1]+' · '+space.name,`<section>${content}</section>`,base,false,
      `<h1>Espacio de ${space.name.toLowerCase()}</h1><p>Vista previa pública · Funciones en desarrollo</p>${nav(tabs,path,'Secciones del espacio')}`);
  }
}

export function home(content) {
  return layout('Inicio', content+`<div class="cards">${spaces.map(s=>`<section><h2><a href="/espacios/${s.slug}">${s.name}</a></h2><p>${s.summary}</p></section>`).join('')}</div>`,'/');
}
