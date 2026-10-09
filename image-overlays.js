import { fitBounds, finiteBounds, pixelAtWorld, worldAtPixel } from "./warp-core.js";

const $=id=>document.getElementById(id);
const imageControls={
  functions:{
    input:$("function-image-upload"),before:$("function-image-before"),
    after:$("function-image-after"),status:$("function-image-status"),
    mode:$("functions-mode"),
  },
  linear:{
    input:$("linear-image-upload"),before:$("linear-image-before"),
    after:$("linear-image-after"),status:$("linear-image-status"),
    mode:$("linear-mode"),
  },
};
let texture=null;
let filename="";
let selectedMatrix=null;
let fnMath=null;
let drawPending=false;
let fnCompiled=null;
let fnError="";
let lastLoad=0;
const SOURCE_MAX_SIDE=2048;

function number(v){return Number(v);}
function fmt(n){return Number(n.toFixed(3)).toString();}
function sourceBounds(){
  const controls=["warp-image-xmin","warp-image-xmax","warp-image-ymin","warp-image-ymax"];
  const values=controls.map(id=>{
    const s=$(id).value.trim();
    return s===""?NaN:Number(s);
  });
  const b={xmin:values[0],xmax:values[1],ymin:values[2],ymax:values[3]};
  if(!finiteBounds(b))return null;
  return b;
}
function niceStep(range){
  const raw=Math.max(range/7,1e-7),power=10**Math.floor(Math.log10(raw)),fraction=raw/power;
  return (fraction<=1?1:fraction<=2?2:fraction<=5?5:10)*power;
}
function setupCanvas(ctx,view){
  const W=ctx.canvas.width,H=ctx.canvas.height;
  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle="#0b111f";ctx.fillRect(0,0,W,H);
  const grid=document.getElementById("warp-grid").checked;
  if(!grid)return;
  ctx.strokeStyle="#344158";ctx.lineWidth=0.8;
  for(const coordinate of ["x","y"]){
    const step=niceStep(coordinate==="x"?view.xmax-view.xmin:view.ymax-view.ymin);
    const lo=coordinate==="x"?view.xmin:view.ymin;
    const hi=coordinate==="x"?view.xmax:view.ymax;
    for(let k=Math.ceil(lo/step);k*step<=hi+step*1e-8;k++){
      const value=k*step;
      const [px,py]=pixelAtWorld(coordinate==="x"?value:0,coordinate==="y"?value:0,W,H,view);
      ctx.beginPath();
      if(coordinate==="x"){ctx.moveTo(px,0);ctx.lineTo(px,H);}
      else {ctx.moveTo(0,py);ctx.lineTo(W,py);}
      ctx.stroke();
    }
  }
  ctx.strokeStyle="#a1b0c7";ctx.lineWidth=1.3;
  if(view.xmin<=0 && view.xmax>=0){
    const [x]=pixelAtWorld(0,0,W,H,view);
    ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();
  }
  if(view.ymin<=0 && view.ymax>=0){
    const [,y]=pixelAtWorld(0,0,W,H,view);
    ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();
  }
}
function emptyCanvas(ctx,message){
  const W=ctx.canvas.width,H=ctx.canvas.height;
  ctx.fillStyle="#d8e1f0";ctx.font="15px system-ui";ctx.textAlign="center";
  ctx.fillText(message,W/2,H/2);
}
function projectPoint(vector,dim){
  if(dim===3)return [(vector[0]-vector[2])*0.8660254038,
    -0.5*vector[0]-vector[1]-0.5*vector[2]];
  return [vector[0],-vector[1]];
}
function matVec(A,v){return A.map(row=>row.reduce((acc,a,j)=>acc+a*v[j],0));}
function imageCorners(bounds){
  return [[bounds.xmin,bounds.ymax,0],[bounds.xmax,bounds.ymax,0],
    [bounds.xmin,bounds.ymin,0],[bounds.xmax,bounds.ymin,0]];
}
function projectedView(before,after,W,H){
  const all=before.concat(after);
  let minX=Math.min(...all.map(p=>p[0])),maxX=Math.max(...all.map(p=>p[0]));
  let minY=Math.min(...all.map(p=>p[1])),maxY=Math.max(...all.map(p=>p[1]));
  return fitBounds([{xmin:minX,xmax:maxX,ymin:-maxY,ymax:-minY}],W/H,0.17);
}
function drawAffineImage(ctx,points,view){
  const W=ctx.canvas.width,H=ctx.canvas.height;
  const pixel=points.map(p=>pixelAtWorld(p[0],-p[1],W,H,view));
  const [p0,p1,p2]=pixel;
  const sw=texture.width,sh=texture.height;
  ctx.save();
  ctx.setTransform((p1[0]-p0[0])/sw,(p1[1]-p0[1])/sw,
    (p2[0]-p0[0])/sh,(p2[1]-p0[1])/sh,p0[0],p0[1]);
  ctx.imageSmoothingEnabled=true;
  ctx.imageSmoothingQuality="high";
  ctx.drawImage(texture,0,0);
  ctx.restore();
}
function linearImageRender(){
  const c=imageControls.linear;
  if(c.mode.classList.contains("hidden"))return;
  const a=c.before.getContext("2d"),b=c.after.getContext("2d");
  const bounds=sourceBounds();
  if(!bounds||!texture||!selectedMatrix){
    const view={xmin:-3,xmax:3,ymin:-2,ymax:2};
    setupCanvas(a,view);setupCanvas(b,view);
    emptyCanvas(a,!texture?"Sube una imagen":"Matriz no disponible");
    c.status.textContent=!bounds?"Corrige los límites en Imagen / Warp":!texture?
      "Sube una imagen aquí o en Imagen / Warp":"Selecciona una matriz válida";
    return;
  }
  const A=selectedMatrix;
  const dim=A.length;
  const corners=imageCorners(bounds);
  const transform=(v)=>dim===1?[A[0][0]*v[0],v[1]]:dim===2?
    matVec(A,v.slice(0,2)):matVec(A,v);
  const before=corners.map(v=>projectPoint(v,dim));
  const after=corners.map(v=>projectPoint(transform(v),dim));
  if(after.some(p=>p.some(x=>!Number.isFinite(x)))){c.status.textContent="Imagen transformada fuera de escala.";return;}
  const view=projectedView(before,after,c.before.width,c.before.height);
  setupCanvas(a,view);setupCanvas(b,view);
  drawAffineImage(a,before,view);drawAffineImage(b,after,view);
  c.status.textContent=dim===3?
    "Imagen situada en el plano z=0, proyectada isométricamente en R³":
    dim===1?"La matriz transforma la coordenada x; y permanece fija":
      "Warp afín exacto: p′=Ap · "+filename;
}
function scalarExpression(value){
  return value.replace(/\bln\s*\(/gi,"log(").replace(/π/g,"pi").replace(/−/g,"-");
}
function composedScalar(x){
  if(!fnCompiled)return NaN;
  let value=x;
  for(const compiled of fnCompiled){
    if(!Number.isFinite(value))return NaN;
    try {
      const result=compiled.evaluate({x:value});
      value=typeof result==="number"?result:Number(result);
    } catch(_) {return NaN;}
  }
  return Number.isFinite(value)?value:NaN;
}
function refreshCompiledFunctions(){
  if(!fnMath)return;
  const inputs=Array.from(document.querySelectorAll("#function-list .function-input"));
  try{
    fnCompiled=inputs.map(input=>fnMath.compile(scalarExpression(input.value)));
    fnError="";
  }catch(error){
    fnCompiled=null;
    fnError="Hay una expresión inválida en la composición.";
  }
}
function renderFunctionImage(){
  const c=imageControls.functions;
  if(c.mode.classList.contains("hidden"))return;
  const a=c.before.getContext("2d"),b=c.after.getContext("2d");
  const bounds=sourceBounds();
  const fallback={xmin:-3,xmax:3,ymin:-2,ymax:2};
  if(!bounds||!texture||!fnCompiled){
    setupCanvas(a,fallback);setupCanvas(b,fallback);
    emptyCanvas(a,!texture?"Sube una imagen":"Función no disponible");
    c.status.textContent=!bounds?"Edita los límites de la imagen en Imagen / Warp":
      !texture?"Sube una imagen aquí o en Imagen / Warp":
        fnError||"Cargando evaluador matemático…";
    return;
  }
  const sampled=[];
  const N=160;
  for(let i=0;i<=N;i++){
    const x=bounds.xmin+(bounds.xmax-bounds.xmin)*i/N;
    sampled.push(composedScalar(x));
  }
  const finite=sampled.filter(Number.isFinite);
  if(!finite.length){
    setupCanvas(a,fallback);setupCanvas(b,fallback);
    c.status.textContent="La composición no tiene imágenes reales finitas sobre este intervalo.";
    return;
  }
  const sourceView={xmin:bounds.xmin,xmax:bounds.xmax,ymin:bounds.ymin,ymax:bounds.ymax};
  const afterMin=Math.min(...finite),afterMax=Math.max(...finite);
  const first={xmin:Math.min(bounds.xmin,afterMin),xmax:Math.max(bounds.xmax,afterMax),
    ymin:bounds.ymin,ymax:bounds.ymax};
  if(first.xmax-first.xmin<0.01){first.xmin-=0.1;first.xmax+=0.1;}
  const view=fitBounds([first],c.before.width/c.before.height,0.17);
  setupCanvas(a,view);setupCanvas(b,view);
  const topLeft=pixelAtWorld(bounds.xmin,bounds.ymax,a.canvas.width,a.canvas.height,view);
  const bottomRight=pixelAtWorld(bounds.xmax,bounds.ymin,a.canvas.width,a.canvas.height,view);
  a.drawImage(texture,topLeft[0],topLeft[1],bottomRight[0]-topLeft[0],bottomRight[1]-topLeft[1]);

  // General non-injective maps require a forward mesh, not a global inverse.
  // Paint narrow source strips; folded branches can overlap at the destination.
  const strips=Math.min(texture.width,640);
  const slice=texture.width/strips;
  for(let i=0;i<strips;i++){
    const x0=bounds.xmin+(bounds.xmax-bounds.xmin)*i/strips;
    const x1=bounds.xmin+(bounds.xmax-bounds.xmin)*(i+1)/strips;
    const u0=composedScalar(x0),u1=composedScalar(x1);
    if(!Number.isFinite(u0)||!Number.isFinite(u1)||Math.abs(u1-u0)>1e5)continue;
    const p0=pixelAtWorld(u0,bounds.ymax,b.canvas.width,b.canvas.height,view);
    const p1=pixelAtWorld(u1,bounds.ymin,b.canvas.width,b.canvas.height,view);
    const dx=p1[0]-p0[0],dy=p1[1]-p0[1];
    if(Math.abs(dx)<0.05)continue;
    b.save();
    b.setTransform(dx/slice,0,0,dy/texture.height,p0[0],p0[1]);
    b.imageSmoothingEnabled=true;
    b.drawImage(texture,i*slice,0,slice,texture.height,0,0,slice,texture.height);
    b.restore();
  }
  let turns=0,sign=0;
  for(let i=1;i<sampled.length;i++){
    const a=sampled[i-1],z=sampled[i];
    if(!Number.isFinite(a)||!Number.isFinite(z)||Math.abs(z-a)<1e-10)continue;
    const s=Math.sign(z-a);
    if(sign!==0&&s!==sign)turns++;
    sign=s;
  }
  c.status.textContent=turns?
    "La composición tiene pliegues: hay "+turns+" cambio(s) de monotonía y regiones superpuestas.":
    "La imagen sigue x ↦ f(x) ↦ g(f(x))…; y queda fija.";
}
function schedule(){
  if(drawPending)return;
  drawPending=true;
  requestAnimationFrame(()=>{drawPending=false;renderFunctionImage();linearImageRender();});
}
async function openImage(file){
  if(!file||!file.type.startsWith("image/"))throw Error("Selecciona un archivo de imagen.");
  if(file.size>25*1024*1024)throw Error("La imagen debe pesar menos de 25 MB.");
  const id=++lastLoad;
  const url=URL.createObjectURL(file);
  try{
    const img=new Image();
    await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(Error("Imagen no compatible"));img.src=url;});
    if(id!==lastLoad)return;
    const factor=Math.min(1,SOURCE_MAX_SIDE/Math.max(img.naturalWidth,img.naturalHeight));
    const canvas=document.createElement("canvas");
    canvas.width=Math.max(1,Math.round(img.naturalWidth*factor));
    canvas.height=Math.max(1,Math.round(img.naturalHeight*factor));
    const ctx=canvas.getContext("2d",{willReadFrequently:true});
    ctx.drawImage(img,0,0,canvas.width,canvas.height);
    const data=ctx.getImageData(0,0,canvas.width,canvas.height);
    window.dispatchEvent(new CustomEvent("functionmapper:image-loaded",{
      detail:{canvas,data,name:file.name},
    }));
  }finally{URL.revokeObjectURL(url);}
}
for(const c of Object.values(imageControls)){
  c.input.addEventListener("change",async()=>{
    const file=c.input.files?.[0];if(!file)return;
    try{await openImage(file);}catch(error){c.status.textContent=error.message;}
  });
}
window.addEventListener("functionmapper:image-loaded",event=>{
  if(!event.detail?.canvas)return;
  texture=event.detail.canvas;
  filename=event.detail.name||"imagen";
  schedule();
});
window.addEventListener("functionmapper:linear-change",event=>{
  selectedMatrix=event.detail?.A||null;
  schedule();
});
window.addEventListener("functionmapper:functions-change",()=>{
  refreshCompiledFunctions();schedule();
});
document.getElementById("warp-grid").addEventListener("change",schedule);
for(const id of ["warp-image-xmin","warp-image-xmax","warp-image-ymin","warp-image-ymax"]){
  $(id).addEventListener("input",schedule);
}
window.addEventListener("functionmapper:image-visible",schedule);
const observer=new MutationObserver(()=>{
  refreshCompiledFunctions();schedule();
});
observer.observe(document.getElementById("function-list"),{childList:true,subtree:false});
document.getElementById("tab-functions").addEventListener("click",schedule);
document.getElementById("tab-linear").addEventListener("click",schedule);
refreshCompiledFunctions();
schedule();
try{
  const mod=await import("https://cdn.jsdelivr.net/npm/mathjs@14.8.1/+esm");
  fnMath=mod.default||mod;
  refreshCompiledFunctions();schedule();
}catch(error){
  imageControls.functions.status.textContent="No se pudo cargar Math.js.";
}
