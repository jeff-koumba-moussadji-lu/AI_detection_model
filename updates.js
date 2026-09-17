'use strict';
function drawMarks(rows){
 const node=$('reading-marks');node.innerHTML='';node.setAttribute('hidden','');$('marks').textContent='Show reading marks';$('marks').setAttribute('aria-pressed','false');
 const point=p=>Array.isArray(p)&&p.length===2&&p.every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1000);
 const svg=(tag,attrs)=>{const element=document.createElementNS('http://www.w3.org/2000/svg',tag);Object.entries(attrs).forEach(([k,v])=>element.setAttribute(k,String(v)));node.append(element);return element};
 rows.forEach(row=>{const color=row.status==='read'?'#15a77d':'#f2a037',b=row.box;
  if(Array.isArray(b)&&b.length===4&&point(b.slice(0,2))&&point(b.slice(2))){svg('rect',{x:b[0],y:b[1],width:Math.max(0,b[2]-b[0]),height:Math.max(0,b[3]-b[1]),fill:'none',stroke:color,'stroke-width':3});}
  const lines=row.lines||[{points:row.evidence?.pointer?.line},{points:row.evidence?.surface_line}];
  lines.forEach(l=>{const p=l.points;if(Array.isArray(p)&&p.length===2&&p.every(point)){svg('line',{x1:p[0][0],y1:p[0][1],x2:p[1][0],y2:p[1][1],stroke:color,'stroke-width':4});svg('circle',{cx:p[1][0],cy:p[1][1],r:5,fill:color});}});
 });$('marks').disabled=!node.children.length;
}
$('marks').onclick=()=>{const on=$('marks').getAttribute('aria-pressed')!=='true';$('marks').setAttribute('aria-pressed',String(on));$('marks').textContent=on?'Hide reading marks':'Show reading marks';$('reading-marks').toggleAttribute('hidden',!on)};
let localSession=null;
async function loadUpdates(){
 if(location.protocol==='file:')return;
 if(!['127.0.0.1','localhost'].includes(location.hostname)){$('update-results').hidden=true;return;}
 try{const response=await fetch('api/session',{cache:'no-store'});if(!response.ok)return;const session=await response.json();if(!session.local||!session.token)return;localSession=session;const data=await fetch('api/gallery',{cache:'no-store'});if(data.ok)state.data=await data.json();$('export-website').hidden=false;}catch{}
}
async function openUpload(){
 if(!$('upload-dialog').open)$('upload-dialog').showModal();$('upload-label').hidden=!localSession;
 $('upload-message').textContent=localSession?'':'Open OPEN_GALLERY.bat in the main folder, then choose Update results.';
}
$('update-results').onclick=openUpload;$('close-upload').onclick=()=>$('upload-dialog').close();
$('result-file').onchange=async event=>{const file=event.target.files[0];if(!file)return;if(file.size>8*1024*1024){$('upload-message').textContent='Choose a results file smaller than 8 MB.';event.target.value='';return;}
 $('upload-label').hidden=true;$('upload-message').textContent='Saving results in this gallery folder…';
 try{const source=await file.text();const payload=JSON.parse(source);if(payload.schema!=='orbit-gallery-update/1')throw Error('Choose gallery_update.json from your pipeline run.');
 const response=await fetch('api/results',{method:'POST',headers:{'content-type':'application/json','x-orbit-token':localSession.token},body:source});const info=await response.json();if(!response.ok)throw Error(info.error||'Results could not be saved.');
 await load();$('upload-message').textContent=info.updated+' photos saved locally.'+(info.skipped_not_run?' '+info.skipped_not_run+' unattempted photos skipped.':'')+(info.older?' '+info.older+' older results skipped.':'')+(info.unmatched?' '+info.unmatched+' photos are outside this collection.':'');
 }catch(error){$('upload-message').textContent=error.message||'Results could not be saved.'}finally{$('upload-label').hidden=false;event.target.value='';}
};
load();
