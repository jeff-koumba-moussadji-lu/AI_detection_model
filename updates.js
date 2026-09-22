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

load();
