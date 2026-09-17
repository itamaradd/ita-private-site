const $=id=>document.getElementById(id);
let state=null,mode='login',selected='all',editing=null,busy=false,toastTimer;
const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
function toast(message,error=false){$('toast').textContent=message;$('toast').className=error?'error':'';$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,5000);}
function signedOut(){state=null;selected='all';$('workspace').hidden=true;$('account').hidden=true;$('auth').hidden=false;$('items').replaceChildren();for(const d of document.querySelectorAll('dialog[open]'))d.close();}
async function api(path,method='GET',body){let r;try{r=await fetch('api/'+path,{method,headers:method==='GET'?{}:{'Content-Type':'application/json'},body:method==='GET'?undefined:JSON.stringify(body||{}),credentials:'same-origin'});}catch{throw new Error('אין חיבור לשרת. השינוי לא נשמר — נסו שוב');}if(!r.headers.get('content-type')?.includes('application/json'))throw new Error('שרת המערכת אינו זמין בכתובת הזו. יש להפעיל את שרת סל');const data=await r.json();if(!r.ok){if(r.status===401&&path!=='login')signedOut();throw new Error(data.error||'הפעולה נכשלה');}return data;}
function options(el,value){el.replaceChildren(...state.categories.map(c=>{const o=node('option',c.name);o.value=c.id;return o;}));if(value&&state.categories.some(c=>String(c.id)===String(value)))el.value=value;}
function render(){
 $('auth').hidden=true;$('loading').hidden=true;$('workspace').hidden=false;$('account').hidden=false;$('username').textContent=state.user.username;
 const completed=state.items.filter(i=>i.done).length,total=state.items.length;
 $('remaining').textContent=total-completed;$('bought').textContent=completed;$('progress').value=total?completed/total*100:0;$('progress-text').textContent=total?`${completed} מתוך ${total} מוצרים בסל`:'מתחילים רשימה חדשה';
 options($('item-category'),$('item-category').value);$('item-submit').disabled=!state.categories.length;$('clear-done').disabled=!completed;
 if(selected!=='all'&&!state.categories.some(c=>String(c.id)===selected))selected='all';
 const chips=[{id:'all',name:'הכול'},...state.categories.filter(c=>state.items.some(i=>i.category_id===c.id))];
 $('category-filters').replaceChildren(...chips.map(c=>{const b=node('button',c.name,String(c.id)===selected?'active':'');b.type='button';b.setAttribute('aria-pressed',String(String(c.id)===selected));b.onclick=()=>{selected=String(c.id);renderList();renderChips();};b.dataset.category=c.id;return b;}));
 renderList();renderCategories();
}
function renderChips(){for(const b of $('category-filters').children){const active=b.dataset.category===selected;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));}}
function renderList(){
 const q=$('search').value.trim().toLowerCase(),filter=$('filter').value;
 const items=state.items.filter(i=>(selected==='all'||String(i.category_id)===selected)&&(`${i.name} ${i.note}`).toLowerCase().includes(q)&&(filter==='all'||(filter==='done'?i.done:!i.done)));
 $('items').replaceChildren();
 if(!items.length){const empty=node('div',undefined,'empty');empty.append(node('b',state.items.length?'אין מוצרים מתאימים':'הרשימה שלך מתחילה כאן'),node('span',state.items.length?'אפשר לשנות את החיפוש או הסינון.':'מוסיפים את המוצר הראשון ומוכנים לקניות.'));$('items').append(empty);return;}
 for(const c of state.categories){const groupItems=items.filter(i=>i.category_id===c.id).sort((a,b)=>a.done-b.done);if(!groupItems.length)continue;const group=node('section',undefined,'group'),heading=node('h2',c.name,'group-heading');heading.append(node('span',`${groupItems.length} מוצרים`));group.append(heading);
  for(const i of groupItems){const row=node('div',undefined,'item'+(i.done?' done':'')),check=node('input',undefined,'item-check');check.type='checkbox';check.checked=!!i.done;check.setAttribute('aria-label',`סימון ${i.name} כ${i.done?'לא נקנה':'נקנה'}`);check.onchange=()=>mutate('items/'+i.id,'PATCH',{done:check.checked},'עודכן');const content=node('div',undefined,'item-content');content.append(node('strong',i.name,'item-name'));if(i.note)content.append(node('span',i.note,'item-note'));const buttons=node('div',undefined,'item-buttons'),edit=node('button','עריכה','quiet'),del=node('button','הסרה','quiet danger');edit.setAttribute('aria-label','עריכת '+i.name);del.setAttribute('aria-label','הסרת '+i.name);edit.onclick=()=>openEdit(i);del.onclick=()=>{if(confirm(`להסיר את ${i.name} מהרשימה?`))mutate('items/'+i.id,'DELETE',{},'המוצר הוסר');};buttons.append(edit,del);row.append(check,content,node('span',`${i.quantity} ${i.unit}`,'quantity'),buttons);group.append(row);}$('items').append(group);
 }
}
function renderCategories(){$('category-list').replaceChildren(...state.categories.map(c=>{const row=node('div',undefined,'category-row'),name=node('span',c.name),edit=node('button','שינוי שם','quiet'),del=node('button','הסרה','quiet danger');edit.onclick=()=>{const name=prompt('שם הקטגוריה',c.name);if(name?.trim())mutate('categories/'+c.id,'PATCH',{name},'הקטגוריה עודכנה');};del.onclick=()=>{if(confirm(`להסיר את הקטגוריה ${c.name}?`))mutate('categories/'+c.id,'DELETE',{},'הקטגוריה הוסרה');};row.append(name,edit,del);return row;}));}
async function mutate(path,method,body,message){if(busy){renderList();return false;}busy=true;$('save-status').textContent='שומרים…';try{state=await api(path,method,body);render();$('save-status').textContent='כל השינויים נשמרו';toast(message);return true;}catch(e){toast(e.message,true);if(state){renderList();$('save-status').textContent='השינוי לא נשמר. יש לנסות שוב';}return false;}finally{busy=false;}}
function setMode(next){mode=next;const register=mode==='register';$('auth-title').textContent=register?'נעים להכיר!':'טוב שחזרת!';$('auth-submit').textContent=register?'יצירת חשבון':'כניסה לרשימה';$('auth-password').autocomplete=register?'new-password':'current-password';$('confirm-label').hidden=!register;$('auth-confirm').required=register;$('auth-error').textContent='';for(const x of ['login','register']){$(x+'-tab').classList.toggle('selected',x===mode);$(x+'-tab').setAttribute('aria-pressed',String(x===mode));}}
function openEdit(i){editing=i.id;for(const key of ['name','quantity','unit','note'])$('edit-'+key).value=i[key];options($('edit-category'),i.category_id);$('edit-dialog').showModal();}
const readItem=prefix=>({name:$(prefix+'name').value,quantity:Number($(prefix+'quantity').value),unit:$(prefix+'unit').value,category_id:Number($(prefix+'category').value),note:$(prefix+'note').value});
$('login-tab').onclick=()=>setMode('login');$('register-tab').onclick=()=>setMode('register');
$('auth-form').onsubmit=async e=>{e.preventDefault();if(mode==='register'&&$('auth-password').value!==$('auth-confirm').value){$('auth-error').textContent='הסיסמאות אינן זהות';return;}$('auth-submit').disabled=true;$('auth-error').textContent='';try{state=await api(mode,'POST',{username:$('auth-user').value,password:$('auth-password').value});$('auth-form').reset();render();$('save-status').textContent='הרשימה מעודכנת';}catch(e){$('auth-error').textContent=e.message;}finally{$('auth-submit').disabled=false;}};
$('logout').onclick=async()=>{if(busy)return;try{await api('logout','POST');signedOut();}catch(e){toast(e.message,true);}};
$('item-form').onsubmit=async e=>{e.preventDefault();if(await mutate('items','POST',readItem('item-'),'המוצר נוסף לרשימה')){$('item-name').value='';$('item-note').value='';$('item-quantity').value=1;$('item-name').focus();}};
$('edit-form').onsubmit=async e=>{e.preventDefault();if(await mutate('items/'+editing,'PATCH',readItem('edit-'),'המוצר עודכן'))$('edit-dialog').close();};
$('category-form').onsubmit=async e=>{e.preventDefault();if(await mutate('categories','POST',{name:$('category-name').value},'הקטגוריה נוספה'))$('category-name').value='';};
$('manage-categories').onclick=()=>$('category-dialog').showModal();$('close-categories').onclick=()=>$('category-dialog').close();$('close-edit').onclick=()=>$('edit-dialog').close();
$('search').oninput=renderList;$('filter').onchange=renderList;
$('clear-done').onclick=()=>{if(confirm('למחוק את כל המוצרים שכבר נקנו?'))mutate('items/completed','DELETE',{},'המוצרים שנקנו הוסרו');};
async function refresh(){if(!state||busy||document.querySelector('dialog[open]'))return;try{state=await api('state');render();$('save-status').textContent='הרשימה מעודכנת';}catch(e){if(state)$('save-status').textContent='לא ניתן לרענן כרגע. בדקו את החיבור';}}
$('refresh').onclick=refresh;window.addEventListener('focus',refresh);setInterval(()=>{if(!document.hidden)refresh();},30000);
$('today').textContent=new Date().toLocaleDateString('he-IL',{weekday:'long',day:'numeric',month:'long'});
(async()=>{try{state=await api('state');render();}catch(e){signedOut();if(e.message!=='יש להתחבר כדי להמשיך')$('auth-error').textContent=e.message;}finally{$('loading').hidden=true;}})();
