import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server.mjs';

test('registration, account isolation, CRUD, CSRF, logout and durable restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'sal-test-')),dbPath=join(dir,'test.sqlite'),origin='http://localhost:3000';
 let server,base;
 async function start(){server=createApp({dbPath,origin});await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;}
 async function stop(){await new Promise(r=>server.close(r));}
 async function call(path,method='GET',body,cookie='',headers={}){const r=await fetch(base+'/api/'+path,{method,headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie,...headers},body:method==='GET'?undefined:JSON.stringify(body||{})});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 try{
  await start();assert.equal((await call('state')).status,401);
  const a=await call('register','POST',{username:'alice',password:'LongPassword-0123'});assert.equal(a.status,200);assert.equal(a.data.categories.length,10);assert.ok(a.cookie);const ca=a.cookie;
  assert.equal((await call('register','POST',{username:'alice',password:'LongPassword-0123'})).status,409);
  const b=await call('register','POST',{username:'bob',password:'Different-Password-456'});assert.equal(b.status,200);const cb=b.cookie;
  let r=await call('items','POST',{name:'עגבניות',category_id:a.data.categories[0].id,quantity:2,unit:'ק״ג',note:'בשלות'},ca);assert.equal(r.status,200);const id=r.data.items[0].id;
  assert.equal((await call('state','GET',null,cb)).data.items.length,0);
  assert.equal((await call('items/'+id,'PATCH',{name:'Hacked'},cb)).status,404);
  assert.equal((await call('items/'+id,'DELETE',{},cb)).status,404);
  assert.equal((await call('items','POST',{name:'bad',category_id:a.data.categories[0].id},cb)).status,400);
  assert.equal((await call('items/'+id,'PATCH',{quantity:0},ca)).status,400);
  assert.equal((await call('items/'+id,'PATCH',{done:true},ca,{Origin:'https://evil.example'})).status,403);
  assert.equal((await call('items/'+id,'PATCH',{done:true},ca)).data.items[0].done,1);
  assert.equal((await call('categories/'+a.data.categories[0].id,'DELETE',{},ca)).status,409);
  r=await call('categories','POST',{name:'חיות מחמד'},ca);const cat=r.data.categories.at(-1).id;
  assert.equal((await call('categories/'+cat,'PATCH',{name:'לחיות'},ca)).status,200);
  assert.equal((await call('categories/'+cat,'DELETE',{},cb)).status,404);
  assert.equal((await call('categories/'+cat,'DELETE',{},ca)).status,200);
  await stop();await start();r=await call('state','GET',null,ca);assert.equal(r.data.items[0].name,'עגבניות');assert.equal(r.data.items[0].quantity,2);
  assert.equal((await call('logout','POST',{},ca)).status,200);assert.equal((await call('state','GET',null,ca)).status,401);
  assert.equal((await call('login','POST',{username:'alice',password:'wrong-password-00'})).status,401);
  const logged=await call('login','POST',{username:'alice',password:'LongPassword-0123'});assert.equal(logged.data.items.length,1);
  r=await call('items/completed','DELETE',{},logged.cookie);assert.equal(r.data.items.length,0);
  assert.equal((await fetch(base+'/data/shopping.sqlite')).status,404);assert.equal((await fetch(base+'/server.mjs')).status,404);
  assert.equal((await fetch(base+'/')).status,200);
  for(let i=0;i<16;i++)r=await call('login','POST',{username:'unknown',password:'LongPassword-9999'});assert.equal(r.status,429);
  await stop();server=null;assert.ok(!readFileSync(dbPath).includes(Buffer.from('LongPassword-0123')));
 }finally{if(server)await stop();rmSync(dir,{recursive:true,force:true});}
});
test('production refuses insecure origin',()=>assert.throws(()=>createApp({production:true,origin:'http://example.com',dbPath:':memory:'}),/HTTPS/));
