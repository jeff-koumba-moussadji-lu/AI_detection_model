'use strict';
const $=id=>document.getElementById(id);
const state={data:null,family:'all',group:'all',scope:'all',query:'',expanded:new Set(),visible:[],selected:null};
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const statusNames={read:'Read',review:'Review',unreadable:'No reading',error:'Error',timeout:'Timed out',pending:'Not run',not_run:'Not run',model_required:'Model required',stale:'Previous result',needs_baseline:'Before image needed'};
const secs=v=>v==null?'—':Number(v).toFixed(2)+' s';
const timestamp=v=>v?new Date(v).toLocaleString([], {year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
const pct=v=>v==null?'Not measured':(100*v).toFixed(1)+'%';
function familyOf(f){return ['GRE','2GRE','gauge'].includes(f)?'gauge':['OCR','digital'].includes(f)?'digital':['TLR','level'].includes(f)?'level':['CD','CV','state'].includes(f)?'state':'extra'}
function readingText(row){const text=row.text??row.state??row.change??row.value??'—';const prefix=row.role==='setpoint'?'Setpoint ':row.value_kind==='upper_bound'?'At or below ':row.value_kind==='lower_bound'?'At or above ':'';return prefix&&/^[-+]?\d+(\.\d+)?$/.test(String(text))?prefix+text:String(text)}
function readings(result){if(!result||['not_run','model_required','stale'].includes(result.status))return [];return [...(result.readings||[]),...(result.lights||[]),...(result.changes||[])];}
function summary(im){const rows=readings(im.result);return rows.length?rows.map(r=>readingText(r)+((r.display_unit||r.unit)?' '+(r.display_unit||r.unit):'')).join(' · '):statusNames[im.result?.status]||'Not run';}
function filterImages(){return state.data.images.filter(im=>(state.scope==='all'||im.featured)&&(state.family==='all'||familyOf(im.family)===state.family)&&(state.group==='all'||im.group_id===state.group)&&(!state.query||[im.name,im.case_id,im.group_id,im.group_title].join(' ').toLowerCase().includes(state.query)));}
function render(){
 const filtered=filterImages();state.visible=[];
 const categories=[['gauge','Gauges'],['digital','Digital displays'],['level','Liquid levels'],['state','Presence & lights'],['extra','Additional cases']];
 $('groups').innerHTML=categories.map(([category,title])=>{
   const shown=filtered.filter(im=>familyOf(im.family)===category);if(!shown.length)return '';
   state.visible.push(...shown.map(im=>im.id));
   return `<section class="use-case"><div class="section-heading"><h2>${title}</h2><span>${shown.length} photos</span></div><div class="gallery">${shown.map(im=>`<button class="image-card" data-image="${esc(im.id)}" aria-label="${esc(im.name)}: ${esc(summary(im))}"><img class="photo" src="${esc(im.thumb||im.image)}" alt="${esc(im.name)}" loading="lazy"><span class="card-copy"><span class="card-case">${esc(im.case_id||im.group_title)}</span><span class="reading${readings(im.result).length?'':' pending'}">${esc(summary(im))}</span><span class="card-meta"><span class="status ${esc(im.result?.status||'pending')}">${esc(statusNames[im.result?.status]||'Not run')}</span><span>${im.result?.total_seconds==null?'':esc(secs(im.result.total_seconds))}</span></span></span></button>`).join('')}</div></section>`;
 }).join('');
 const count=new Set(filtered.map(im=>im.case_id).filter(Boolean)).size;
 $('collection-count').textContent=`${filtered.length} photos · ${count} use cases`;$('empty').hidden=Boolean(filtered.length);
 $('featured').setAttribute('aria-pressed',String(state.scope==='featured'));$('all-cases').setAttribute('aria-pressed',String(state.scope==='all'));
}
function chooseScope(scope){state.scope=scope;state.family='all';state.group='all';state.query='';$('family').value='all';$('case').value='all';$('search').value='';render()}
$('featured').onclick=()=>chooseScope('featured');$('all-cases').onclick=()=>chooseScope('all');
function openImage(id){
 const im=state.data.images.find(x=>x.id===id);if(!im)return;state.selected=id;
 $('detail-title').textContent=im.name;$('detail-case').textContent=im.group_title||im.case_id||'Additional case';
 $('large-image').src=im.image;$('large-image').alt=im.name;$('detail-photo').classList.remove('zoomed');$('zoom').setAttribute('aria-pressed','false');$('zoom').textContent='Zoom image';
 const r=im.result,rows=readings(r);drawMarks(rows);
 $('detail-time').textContent=r?`Reading ${secs(r.total_seconds)}`:'Not analyzed';
 $('detail-readings').innerHTML=rows.length?rows.map(x=>`<div class="detail-reading"><div class="detail-label">${esc(x.label||x.object||'Reading')}${x.position&&x.position!=='main'?' · '+esc(x.position):''}</div><div class="detail-value">${esc(readingText(x))}${x.unit?' <span class="detail-unit">'+esc(x.display_unit||x.unit)+'</span>':''}</div><span class="status ${esc(x.status||r.status)}">${esc(statusNames[x.status||r.status]||'Review')}</span>${x.method==='unit_conversion_from_primary'?'<span class="detail-label"> · Converted</span>':''}</div>`).join(''):`<div class="detail-reading"><div class="detail-value">${esc(statusNames[r?.status]||'Not run')}</div></div>`;
 $('detail-position').textContent=(state.visible.indexOf(id)+1)+' / '+state.visible.length;$('previous').disabled=state.visible.indexOf(id)<=0;$('next').disabled=state.visible.indexOf(id)>=state.visible.length-1;
 if(!$('detail').open)$('detail').showModal();$('detail').scrollTop=0;
}
async function load(){try{$('load-error').hidden=true;state.data=JSON.parse(JSON.stringify(window.ORBIT_GALLERY));$('case').innerHTML='<option value="all">All use cases</option>'+state.data.groups.map(g=>`<option value="${esc(g.id)}">${esc(g.title)}</option>`).join('');render();}catch(error){$('load-error').hidden=false;$('collection-count').textContent='';}}

$('family').onchange=()=>{state.family=$('family').value;state.group='all';$('case').value='all';render()};
$('case').onchange=()=>{state.group=$('case').value;if(state.group!=='all')state.scope='all';render()};let debounce;$('search').oninput=()=>{clearTimeout(debounce);debounce=setTimeout(()=>{state.query=$('search').value.trim().toLowerCase();render()},180)};
$('groups').onclick=e=>{const image=e.target.closest('[data-image]');if(image)return openImage(image.dataset.image);const group=e.target.closest('[data-group]');if(group){state.expanded.add(group.dataset.group);render();}};
$('close').onclick=()=>$('detail').close();$('detail').onclick=e=>{if(e.target===$('detail')){const rect=$('detail').getBoundingClientRect();if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)$('detail').close();}};
function move(delta){const index=state.visible.indexOf(state.selected)+delta;if(index>=0&&index<state.visible.length)openImage(state.visible[index]);}
$('previous').onclick=()=>move(-1);$('next').onclick=()=>move(1);$('detail').onkeydown=e=>{if(e.key==='ArrowLeft'){e.preventDefault();move(-1)}if(e.key==='ArrowRight'){e.preventDefault();move(1)}};
$('zoom').onclick=()=>{const zoomed=$('detail-photo').classList.toggle('zoomed');$('zoom').setAttribute('aria-pressed',String(zoomed));$('zoom').textContent=zoomed?'Fit image':'Zoom image'};
$('retry').onclick=load;
