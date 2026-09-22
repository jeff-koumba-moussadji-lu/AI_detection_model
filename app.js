'use strict';
const $=id=>document.getElementById(id);
const state={data:null,family:'all',group:'all',query:'',expanded:new Set(),visible:[],selected:null};
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const statusNames={read:'Read',review:'Review',unreadable:'No reading',error:'Error',timeout:'Timed out',pending:'Not run',not_run:'Not run',model_required:'Model required',stale:'Previous result',needs_baseline:'Before image needed'};
const secs=v=>v==null?'—':Number(v).toFixed(2)+' s';
const timestamp=v=>v?new Date(v).toLocaleString([], {year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
const pct=v=>v==null?'Not measured':(100*v).toFixed(1)+'%';
function familyOf(f){return ['GRE','2GRE','gauge'].includes(f)?'gauge':['OCR','digital'].includes(f)?'digital':['TLR','level'].includes(f)?'level':['CD','CV','state'].includes(f)?'state':'extra'}
function readingText(row){const text=row.text??row.state??row.change??row.value??'—';const prefix=row.value_kind==='upper_bound'?'At or below ':row.value_kind==='lower_bound'?'At or above ':'';return prefix&&/^[-+]?\d+(\.\d+)?$/.test(String(text))?prefix+text:String(text)}
function readings(result){if(!result||['not_run','model_required','stale'].includes(result.status))return [];return [...(result.readings||[]),...(result.lights||[]),...(result.changes||[])];}
function summary(im){const rows=readings(im.result);return rows.length?rows.map(r=>readingText(r)+(r.unit?' '+r.unit:'')).join(' · '):statusNames[im.result?.status]||'Not run';}
function filterImages(){return state.data.images.filter(im=>(state.family==='all'||familyOf(im.family)===state.family)&&(state.group==='all'||im.group_id===state.group)&&(!state.query||[im.name,im.case_id,im.group_id,im.group_title].join(' ').toLowerCase().includes(state.query)));}
function render(){
 const filtered=filterImages();state.visible=[];
 const map=new Map();filtered.forEach(im=>{if(!map.has(im.group_id))map.set(im.group_id,[]);map.get(im.group_id).push(im)});
 $('groups').innerHTML=state.data.groups.filter(g=>map.has(g.id)).map(g=>{
   const all=map.get(g.id),shown=all;
   if(!shown.length)shown.push(...all.slice(0,5));state.visible.push(...shown.map(im=>im.id));
   return `<section class="use-case" aria-labelledby="g-${esc(g.id)}"><div class="section-heading"><h2 id="g-${esc(g.id)}">${esc(g.title)}${g.subtitle?`<span class="case-name">${esc(g.subtitle)}</span>`:''}</h2><span>${shown.length} photos</span></div><div class="gallery">${shown.map(im=>`<button class="image-card" data-image="${esc(im.id)}" aria-label="${esc(im.name)}: ${esc(summary(im))}"><img class="photo" src="${esc(im.thumb||im.image)}" alt="${esc(im.name)}" loading="lazy" width="320" height="240"><span class="card-copy"><span class="reading${readings(im.result).length?'':' pending'}">${esc(summary(im))}</span><span class="card-meta"><span class="status ${esc(im.result?.status||'pending')}">${esc(statusNames[im.result?.status]||'Not run')}</span><span>${im.result?.total_seconds==null?'':esc(secs(im.result.total_seconds))}</span></span>${im.result?.scope==='saved_detection_replay'?'<span class="source-tag">Re-read with saved detection</span>':im.result?.scope==='previous_run'?'<span class="source-tag">Previous run</span>':im.latest_attempt?.status==='not_run'&&im.result?'<span class="source-tag">Earlier result · skipped in latest run</span>':im.result?.scope==='console_log'?'<span class="source-tag">From your run log</span>':''}</span></button>`).join('')}</div>${all.length>shown.length?`<button class="show-all" data-group="${esc(g.id)}">Show all ${all.length} images</button>`:''}</section>`;
 }).join('');
 $('collection-count').textContent=`${filtered.length.toLocaleString()} images · ${map.size} use cases`;$('empty').hidden=Boolean(filtered.length);
}
function renderMetrics(){
 const m=state.data.last_run||{},a=m.accuracy||{},t=m.timing||{};
 const total=state.data.images.length,attempted=state.data.images.filter(im=>im.result&&typeof im.result.total_seconds==='number'&&im.result.status!=='not_run').length;
 const cards=[{value:attempted+' / '+total,label:'Photos attempted',note:'Across imported runs'},
 {value:secs(t.mean_seconds),label:'Average reading time',note:(t.timed_attempts??m.attempted_images??0)+' timed attempts in latest run'},
 {value:secs(t.p95_seconds),label:'95th percentile time',note:'Latest run'},
 {value:a.reference_targets!=null?a.correct_targets+' / '+a.reference_targets:'Not measured',label:'Reference target checks',note:a.reference_targets!=null?(a.split||'Unspecified')+' references only; not overall image accuracy':''}];
 $('metric-values').innerHTML=cards.map(c=>`<div class="metric"><strong>${esc(c.value)}</strong><span>${esc(c.label)}</span><small>${esc(c.note)}</small></div>`).join('');
 $('metric-scope').textContent=m.label||'Latest imported run';
 const notes=[`The latest run attempted ${m.attempted_images??0} of ${m.selected_images??0} selected photos. ${m.not_run_images??0} were not attempted.`,
 'Overall accuracy on all selected photos is not measured. Read status is not an accuracy score.',
 a.reference_targets!=null?`${a.correct_targets} of ${a.reference_targets} reference targets passed${a.reference_images!=null?' in '+a.reference_images+' reference photos':''}. These checks do not verify every reading in the collection.`:'No matched reference targets in the latest run.',
 'Each photo keeps the time and source of its own result. Skipped photos do not inherit a new reading.'];
 if(m.source==='console_log')notes.push('Initial readings and rounded times were transcribed from your supplied console log. Import gallery_update.json for exact timings, complete reading metadata and boxes.');
 $('metric-details').innerHTML=notes.map(n=>`<p>${esc(n)}</p>`).join('');
 $('updated').textContent=state.data.generated_at?'Gallery updated '+timestamp(state.data.generated_at):'';
}
function openImage(id){
 const im=state.data.images.find(x=>x.id===id);if(!im)return;state.selected=id;
 $('detail-title').textContent=im.name;$('detail-case').textContent=im.group_title||im.case_id||'Additional case';
 $('large-image').src=im.image;$('large-image').alt=im.name;$('detail-photo').classList.remove('zoomed');$('zoom').setAttribute('aria-pressed','false');$('zoom').textContent='Zoom image';
 const r=im.result,rows=readings(r);drawMarks(rows);
 $('detail-time').textContent=r?`Total ${secs(r.total_seconds)} · Model ${secs(r.inference_seconds)}`:'Not analyzed';
 $('detail-readings').innerHTML=rows.length?rows.map(x=>`<div class="detail-reading"><div class="detail-label">${esc(x.label||x.object||'Reading')}${x.position&&x.position!=='main'?' · '+esc(x.position):''}</div><div class="detail-value">${esc(readingText(x))}${x.unit?' <span class="detail-unit">'+esc(x.unit)+'</span>':''}</div><span class="status ${esc(x.status||r.status)}">${esc(statusNames[x.status||r.status]||'Review')}</span>${x.method==='unit_conversion_from_primary'?'<span class="detail-label"> · Converted</span>':''}</div>`).join(''):`<div class="detail-reading"><div class="detail-value">${esc(statusNames[r?.status]||'Not run')}</div></div>`;
 const note=im.latest_attempt?.status==='not_run'&&r?'This photo was skipped by the latest import. The earlier result shown here keeps its original time and source.':r?.scope==='console_log'?'From your supplied console log. Import gallery_update.json from that run to see its reading boxes and full metadata.':r?.scope==='saved_detection_replay'?'The reading was recomputed from these pixels using detection regions saved in the supplied run.':r?.scope==='previous_run'?'This is an earlier supplied result, not a fresh reading.':r?.note||'';
 $('detail-note').textContent=note;$('detail-note').hidden=!note;
 const meta=[['Analyzed',timestamp(r?.created_at)],['Reader',r?.reader||'—'],['Pipeline',r?.engine_version||'—'],['Source',im.origin||'Supplied image'],['Grouping',im.mapping_label||'Use case mapping'],['Reference check',im.validation?.summary||'No reference for this image']];
 rows.forEach(x=>{if(x.uncertainty!=null&&!String(x.value_kind||'').endsWith('_bound'))meta.push([x.label||'Visual uncertainty',`± ${x.uncertainty} ${x.unit||''}`]);});
 if(r?.issues?.length)meta.push(['Notes',r.issues.map(x=>String(x).replaceAll('_',' ')).join(' · ')]);
 $('detail-evidence').innerHTML=meta.map(([k,v])=>`<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
 $('detail-position').textContent=(state.visible.indexOf(id)+1)+' / '+state.visible.length;$('previous').disabled=state.visible.indexOf(id)<=0;$('next').disabled=state.visible.indexOf(id)>=state.visible.length-1;
 if(!$('detail').open)$('detail').showModal();$('detail').scrollTop=0;
}
async function load(){try{$('load-error').hidden=true;state.data=JSON.parse(JSON.stringify(window.ORBIT_GALLERY));await loadUpdates();$('case').innerHTML='<option value="all">All use cases</option>'+state.data.groups.map(g=>`<option value="${esc(g.id)}">${esc(g.title)}</option>`).join('');render();renderMetrics();}catch(error){$('load-error').hidden=false;$('collection-count').textContent='';}}

$('family').onchange=()=>{state.family=$('family').value;state.group='all';$('case').value='all';render()};
$('case').onchange=()=>{state.group=$('case').value;render()};let debounce;$('search').oninput=()=>{clearTimeout(debounce);debounce=setTimeout(()=>{state.query=$('search').value.trim().toLowerCase();render()},180)};
$('groups').onclick=e=>{const image=e.target.closest('[data-image]');if(image)return openImage(image.dataset.image);const group=e.target.closest('[data-group]');if(group){state.expanded.add(group.dataset.group);render();}};
$('close').onclick=()=>$('detail').close();$('detail').onclick=e=>{if(e.target===$('detail')){const rect=$('detail').getBoundingClientRect();if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)$('detail').close();}};
function move(delta){const index=state.visible.indexOf(state.selected)+delta;if(index>=0&&index<state.visible.length)openImage(state.visible[index]);}
$('previous').onclick=()=>move(-1);$('next').onclick=()=>move(1);$('detail').onkeydown=e=>{if(e.key==='ArrowLeft'){e.preventDefault();move(-1)}if(e.key==='ArrowRight'){e.preventDefault();move(1)}};
$('zoom').onclick=()=>{const zoomed=$('detail-photo').classList.toggle('zoomed');$('zoom').setAttribute('aria-pressed',String(zoomed));$('zoom').textContent=zoomed?'Fit image':'Zoom image'};
$('retry').onclick=load;
