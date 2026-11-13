import { translations, localizedContent } from './content-locales.js';
import { db, escape } from './courses.js';

db.exec(`CREATE TABLE IF NOT EXISTS releases(
 course INTEGER NOT NULL, version INTEGER NOT NULL, price INTEGER NOT NULL,
 snapshot TEXT NOT NULL, created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(course,version));
 CREATE TABLE IF NOT EXISTS review_log(id INTEGER PRIMARY KEY, course INTEGER NOT NULL, revision INTEGER NOT NULL,
 decision TEXT NOT NULL, feedback TEXT NOT NULL, price INTEGER NOT NULL, created TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS release_assets(asset TEXT PRIMARY KEY);`);

export function recordDecision(course,decision,feedback) {
 db.prepare('INSERT INTO review_log(course,revision,decision,feedback,price) VALUES(?,?,?,?,?)')
   .run(course.id,course.revision,decision,feedback,course.price);
 if(decision!=='approve')return;
 const modules=JSON.parse(course.modules);
 const version=db.prepare('SELECT COALESCE(MAX(version),0)+1 AS n FROM releases WHERE course=?').get(course.id).n;
 const snapshot={title:course.title,description:course.outline,category:course.category,modules,translations:translations(course.id),owner:course.owner};
 db.prepare('INSERT INTO releases(course,version,price,snapshot) VALUES(?,?,?,?)')
   .run(course.id,version,course.price,JSON.stringify(snapshot));
 const retain=db.prepare('INSERT OR IGNORE INTO release_assets VALUES(?)');
 for(const m of modules)for(const l of m.lessons)for(const asset of [l.video,l.pdf])if(asset)retain.run(asset.id);
}

export function releasedCourses(){
 return db.prepare('SELECT * FROM releases ORDER BY course,version DESC').all().map(row=>{
  const snapshot=localizedContent(JSON.parse(row.snapshot));
  return {id:'curso-'+row.course+'-v'+row.version,series:row.course,version:row.version,price:row.price,
   searchText:[snapshot.title,snapshot.category,snapshot.description].join(' '),title:escape(snapshot.title),category:snapshot.category,description:escape(snapshot.description),
   lessons:snapshot.modules.flatMap(m=>m.lessons.map(l=>({...l,title:escape(l.title),text:escape(l.body),
    module:escape(m.title)})))};
 });
}
