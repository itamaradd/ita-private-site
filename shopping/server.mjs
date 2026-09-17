import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,createHash,scrypt,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {mkdirSync,readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const derive=promisify(scrypt), root=dirname(fileURLToPath(import.meta.url));
const defaults=['🥦 פירות וירקות','🥛 חלב וביצים','🥖 לחם ומאפים','🍗 בשר ודגים','🥫 מזווה','🧊 קפואים','🥤 משקאות','🧽 ניקיון','🧴 טיפוח','🏠 לבית'];
const hash=s=>createHash('sha256').update(s).digest('hex');
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const str=(s,max=120)=>{if(typeof s!=='string'||!s.trim()||s.trim().length>max)fail(400,'יש לבדוק את השדות שמילאת');return s.trim();};

export function createApp({dbPath=process.env.DB_PATH||join(root,'data/shopping.sqlite'),origin=process.env.APP_ORIGIN||'http://localhost:3000',production=process.env.NODE_ENV==='production'}={}){
 if(production&&!origin.startsWith('https://'))throw new Error('Production requires APP_ORIGIN with HTTPS');
 if(dbPath!==':memory:')mkdirSync(dirname(dbPath),{recursive:true,mode:0o700});
 const db=new DatabaseSync(dbPath);db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,username TEXT UNIQUE NOT NULL,salt TEXT NOT NULL,password TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS categories(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,name TEXT NOT NULL,UNIQUE(user_id,name));
 CREATE TABLE IF NOT EXISTS items(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,category_id INTEGER NOT NULL REFERENCES categories(id),name TEXT NOT NULL,quantity REAL NOT NULL,unit TEXT NOT NULL,note TEXT NOT NULL DEFAULT '',done INTEGER NOT NULL DEFAULT 0);
 CREATE INDEX IF NOT EXISTS items_owner ON items(user_id); CREATE INDEX IF NOT EXISTS categories_owner ON categories(user_id);
 CREATE TABLE IF NOT EXISTS attempts(key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires INTEGER NOT NULL);`);
 const run=(q,...p)=>db.prepare(q).run(...p),get=(q,...p)=>db.prepare(q).get(...p),all=(q,...p)=>db.prepare(q).all(...p);
 const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}};
 const limiter=(key,max)=>{const now=Date.now();run('DELETE FROM attempts WHERE expires < ?',now);run('INSERT INTO attempts VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1',hash(key),now+900000);if(get('SELECT count FROM attempts WHERE key=?',hash(key)).count>max)fail(429,'יותר מדי ניסיונות. נסו שוב בעוד 15 דקות');};
 const snapshot=u=>({user:{username:u.username},categories:all('SELECT id,name FROM categories WHERE user_id=? ORDER BY id',u.id),items:all('SELECT id,category_id,name,quantity,unit,note,done FROM items WHERE user_id=? ORDER BY id DESC',u.id)});
 const passwordHash=(p,s)=>derive(p,s,64,{N:32768,r:8,p:1,maxmem:64*1024*1024});
 const files={'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8'],'/logo.svg':['logo.svg','image/svg+xml']};
 const server=createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  if(production)res.setHeader('Strict-Transport-Security','max-age=31536000');
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
  try{
   const path=new URL(req.url,'http://localhost').pathname,method=req.method;
   if(path==='/health'&&method==='GET')return send(200,{ok:true});
   if(!path.startsWith('/api/')){if(method!=='GET'||!files[path])return send(404,{error:'לא נמצא'});const [name,type]=files[path];res.writeHead(200,{'Content-Type':type});return res.end(readFileSync(join(root,'public',name)));}
   let body={};
   if(!['GET','HEAD'].includes(method)){
    if(req.headers.origin!==origin)fail(403,'הבקשה נחסמה. יש לפתוח את האתר בכתובת המוגדרת');
    if(req.headers['content-type']?.split(';')[0]!=='application/json')fail(415,'נדרש JSON');
    let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>16384)fail(413,'הבקשה גדולה מדי');}
    try{body=JSON.parse(raw||'{}');}catch{fail(400,'בקשה לא תקינה');}if(!body||Array.isArray(body)||typeof body!=='object')fail(400,'בקשה לא תקינה');
   }
   const token=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('sal_session='))?.slice(12)||'';
   const cookie=(value,age)=>res.setHeader('Set-Cookie',`sal_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${production?'; Secure':''}`);
   if(path==='/api/register'||path==='/api/login'){
    if(method!=='POST')fail(405,'פעולה לא נתמכת');
    limiter('ip:'+req.socket.remoteAddress,40);
    const username=str(body.username,32).normalize('NFKC').toLowerCase();if(!/^[\p{L}\p{N}_-]{3,32}$/u.test(username))fail(400,'שם משתמש: 3–32 אותיות, ספרות, מקף או קו תחתון');
    limiter('user:'+username,15);
    const p=body.password;if(typeof p!=='string'||p.length<10||p.length>128)fail(400,'הסיסמה צריכה להכיל 10–128 תווים');
    let u=get('SELECT * FROM users WHERE username=?',username);
    if(path==='/api/register'){
     const salt=randomBytes(16).toString('hex'),digest=(await passwordHash(p,salt)).toString('hex');
     if(u)fail(409,'לא ניתן ליצור חשבון בשם הזה');
     u=transaction(()=>{let id;try{id=Number(run('INSERT INTO users(username,salt,password) VALUES (?,?,?)',username,salt,digest).lastInsertRowid);}catch(e){if(e.code==='ERR_SQLITE_ERROR')fail(409,'לא ניתן ליצור חשבון בשם הזה');throw e;}for(const name of defaults)run('INSERT INTO categories(user_id,name) VALUES (?,?)',id,name);return {id,username};});
    }else{
     const digest=await passwordHash(p,u?.salt||'00000000000000000000000000000000');
     if(!u||!timingSafeEqual(digest,Buffer.from(u.password,'hex')))fail(401,'שם המשתמש או הסיסמה אינם נכונים');
    }
    run('DELETE FROM sessions WHERE expires < ?',Date.now());if(token)run('DELETE FROM sessions WHERE token=?',hash(token));
    const session=randomBytes(32).toString('hex');run('INSERT INTO sessions VALUES (?,?,?)',hash(session),u.id,Date.now()+7*86400000);cookie(session,7*86400);return send(200,snapshot(u));
   }
   const u=get('SELECT users.id,users.username FROM sessions JOIN users ON users.id=sessions.user_id WHERE token=? AND expires>?',hash(token),Date.now());
   if(!u)fail(401,'יש להתחבר כדי להמשיך');
   if(path==='/api/logout'&&method==='POST'){run('DELETE FROM sessions WHERE token=?',hash(token));cookie('',0);return send(200,{ok:true});}
   if(path==='/api/state'&&method==='GET')return send(200,snapshot(u));
   if(path==='/api/categories'&&method==='POST'){
    const name=str(body.name,40);if(get('SELECT COUNT(*) AS n FROM categories WHERE user_id=?',u.id).n>=50)fail(400,'אפשר ליצור עד 50 קטגוריות');
    if(get('SELECT id FROM categories WHERE user_id=? AND name=?',u.id,name))fail(409,'הקטגוריה כבר קיימת');run('INSERT INTO categories(user_id,name) VALUES (?,?)',u.id,name);return send(200,snapshot(u));
   }
   const category=path.match(/^\/api\/categories\/(\d+)$/);
   if(category&&['PATCH','DELETE'].includes(method)){
    const id=Number(category[1]);if(!get('SELECT id FROM categories WHERE id=? AND user_id=?',id,u.id))fail(404,'הקטגוריה לא נמצאה');
    if(method==='DELETE'){if(get('SELECT id FROM items WHERE category_id=? AND user_id=?',id,u.id))fail(409,'יש להעביר או למחוק את המוצרים בקטגוריה לפני הסרתה');run('DELETE FROM categories WHERE id=? AND user_id=?',id,u.id);}
    else{const name=str(body.name,40);if(get('SELECT id FROM categories WHERE name=? AND user_id=? AND id<>?',name,u.id,id))fail(409,'הקטגוריה כבר קיימת');run('UPDATE categories SET name=? WHERE id=? AND user_id=?',name,id,u.id);}return send(200,snapshot(u));
   }
   if(path==='/api/items/completed'&&method==='DELETE'){run('DELETE FROM items WHERE user_id=? AND done=1',u.id);return send(200,snapshot(u));}
   const item=path.match(/^\/api\/items\/(\d+)$/);
   if(path==='/api/items'&&method==='POST'||item&&method==='PATCH'){
    const old=item?get('SELECT * FROM items WHERE id=? AND user_id=?',Number(item[1]),u.id):null;if(item&&!old)fail(404,'המוצר לא נמצא');
    const v={quantity:1,unit:'יח׳',note:'',done:0,...old,...body};const name=str(v.name),cat=Number(v.category_id),qty=Number(v.quantity),unit=str(v.unit,16);
    if(!Number.isFinite(qty)||qty<=0||qty>9999||typeof v.note!=='string'||v.note.length>300||![0,1,true,false].includes(v.done))fail(400,'כמות או פרטי מוצר לא תקינים');
    if(!get('SELECT id FROM categories WHERE id=? AND user_id=?',cat,u.id))fail(400,'יש לבחור קטגוריה');
    if(item)run('UPDATE items SET name=?,category_id=?,quantity=?,unit=?,note=?,done=? WHERE id=? AND user_id=?',name,cat,qty,unit,v.note,Number(v.done),Number(item[1]),u.id);
    else{if(get('SELECT COUNT(*) AS n FROM items WHERE user_id=?',u.id).n>=1000)fail(400,'הרשימה מוגבלת ל־1,000 מוצרים');run('INSERT INTO items(user_id,name,category_id,quantity,unit,note,done) VALUES (?,?,?,?,?,?,?)',u.id,name,cat,qty,unit,v.note,Number(v.done));}return send(200,snapshot(u));
   }
   if(item&&method==='DELETE'){const result=run('DELETE FROM items WHERE id=? AND user_id=?',Number(item[1]),u.id);if(!result.changes)fail(404,'המוצר לא נמצא');return send(200,snapshot(u));}
   fail(404,'הפעולה לא נמצאה');
  }catch(e){if(!e.status)console.error('Request failed:',e.code||e.name);if(!res.headersSent)send(e.status||500,{error:e.status?e.message:'לא הצלחנו לשמור. נסו שוב'});else res.end();}
 });
 server.requestTimeout=15000;server.headersTimeout=10000;server.on('close',()=>db.close());return server;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const server=createApp();server.listen(Number(process.env.PORT||3000),process.env.HOST||'127.0.0.1',()=>console.log('Shopping server ready'));for(const s of ['SIGTERM','SIGINT'])process.on(s,()=>server.close(()=>process.exit(0)));}
