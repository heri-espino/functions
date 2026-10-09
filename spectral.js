import { spectralDecomposition, mulVec } from "./spectral-core.js";

const svg=document.getElementById("spectral-svg");
const status=document.getElementById("spectral-message");
const values=document.getElementById("spectral-eigenvectors");
const stepInput=document.getElementById("spectral-step");
const toggle=document.getElementById("spectral-show");
const contentPanel=document.getElementById("spectral-content");
const NS="http://www.w3.org/2000/svg";
const palette=["#efaf60","#83d3d5","#d291e4"];
const stagesLabel=["Vector original","Cambio de eigenbase","Escalamiento por λ","Reconstrucción"];
let current=null;

function node(tag,attrs={}){
  const el=document.createElementNS(NS,tag);
  Object.entries(attrs).forEach(([k,v])=>el.setAttribute(k,String(v)));
  return el;
}
function drawLine(parent,a,b,color="#51627b",width=1,extra={}){
  parent.appendChild(node("line",{x1:a[0],y1:a[1],x2:b[0],y2:b[1],
    stroke:color,"stroke-width":width,...extra}));
}
function text(parent,x,y,t,extra={}){
  const el=node("text",{x,y,fill:"#b5c4d8","font-size":13,
    "font-family":"Inter, system-ui, sans-serif",...extra});
  el.textContent=t;parent.appendChild(el);
}
function fmt(n){return Number(n.toFixed(3)).toString();}
function project(v,n,cx,cy,scale){
  if(n===1)return [cx+v[0]*scale,cy];
  if(n===2)return [cx+v[0]*scale,cy-v[1]*scale];
  return [cx+(v[0]-v[2])*0.8660254*scale,cy-(0.5*v[0]+v[1]+0.5*v[2])*scale];
}
function apply(M,v){return mulVec(M,v);}
function drawGeometry(parent,M,n,cx,cy,scale,index,info){
  const g=node("g");parent.appendChild(g);
  // Four panels deliberately share one mathematical unit scale.
  const pp=v=>project(apply(M,v),n,cx,cy,scale);
  if(n===1){
    drawLine(g,pp([-1.4]),pp([1.4]),"#50627c",1.6);
    for(const x of [-1,0,1]){const p=pp([x]);drawLine(g,[p[0],p[1]-4],[p[0],p[1]+4]);}
  }else if(n===2){
    for(const t of [-1,-0.5,0,0.5,1]){
      drawLine(g,pp([t,-1]),pp([t,1]),"#4f6281",1,{opacity:0.8});
      drawLine(g,pp([-1,t]),pp([1,t]),"#4f6281",1,{opacity:0.8});
    }
  }else{
    const vertices=[];
    for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1])vertices.push([x,y,z]);
    for(let a=0;a<vertices.length;a++)for(let b=a+1;b<vertices.length;b++){
      let differences=0;for(let k=0;k<3;k++)if(vertices[a][k]!==vertices[b][k])differences++;
      if(differences===1)drawLine(g,pp(vertices[a]),pp(vertices[b]),"#4f6281",1.15,{opacity:0.7});
    }
  }
  for(let i=0;i<n;i++){
    const e=Array(n).fill(0);e[i]=1;
    const a=pp(Array(n).fill(0)),b=pp(e);
    drawLine(g,a,b,palette[i],2.8);
    g.appendChild(node("circle",{cx:b[0],cy:b[1],r:4.2,fill:palette[i]}));
  }
  const test=n===1?[0.9]:n===2?[0.8,0.6]:[0.8,0.6,0.4];
  const vector=pp(test),zero=pp(Array(n).fill(0));
  drawLine(g,zero,vector,"#ffffff",3.1,{"stroke-linecap":"round"});
  g.appendChild(node("circle",{cx:vector[0],cy:vector[1],r:5.4,fill:"#ffffff"}));
  if((index===0||index===3)&&document.getElementById("linear-show-eigen").checked){
    const P=info.P;
    for(let k=0;k<n;k++){
      const eig=Array.from({length:n},(_,r)=>P[r][k]);
      const neg=eig.map(v=>-v*1.25),pos=eig.map(v=>v*1.25);
      drawLine(g,pp(neg),pp(pos),palette[k],1.7,{"stroke-dasharray":"5 4",opacity:0.85});
    }
  }
}
function render(){
  const enabled=toggle.checked;
  contentPanel.classList.toggle("hidden",!enabled);
  if(!enabled||!current)return;
  const {A,eigenpairs}=current;
  const solved=spectralDecomposition(A,eigenpairs);
  while(svg.firstChild)svg.removeChild(svg.firstChild);
  values.textContent="";
  if(!solved.ok){
    status.textContent=solved.reason+" La visualización de eigenvectores reales individuales sigue disponible arriba cuando existan.";
    stepInput.disabled=true;
    document.getElementById("spectral-prev").disabled=true;
    document.getElementById("spectral-next").disabled=true;
    return;
  }
  stepInput.disabled=false;
  document.getElementById("spectral-prev").disabled=false;
  document.getElementById("spectral-next").disabled=false;
  const n=A.length;
  status.textContent=solved.symmetric
    ? "Matriz simétrica: A = QΛQᵀ. Los eigenvectores forman una base ortonormal."
    : "Matriz diagonalizable sobre R: A = PΛP⁻¹. La eigenbase no necesariamente es ortogonal.";
  const highlighted=Number(stepInput.value);
  const maxProjected=Math.max(1,...solved.stages.flatMap(M=>{
    const points=n===1?[[1],[-1]]:n===2?[[1,1],[-1,-1],[1,-1],[-1,1]]:
      [[1,1,1],[-1,-1,-1],[1,-1,1],[-1,1,-1]];
    return points.flatMap(v=>apply(M,v).map(Math.abs));
  }));
  const scale=Math.min(72,88/(Math.max(1,maxProjected)*(n===3?1.75:1.1)));
  for(let i=0;i<4;i++){
    const left=i*300;
    const cx=left+150,cy=180;
    svg.appendChild(node("rect",{x:left+8,y:8,width:284,height:324,rx:12,fill:i===highlighted?"#1a2840":"#101929",stroke:i===highlighted?"#8fb3ff":"#334259","stroke-width":i===highlighted?2:1}));
    text(svg,cx,34,stagesLabel[i],{fill:i===highlighted?"#ffffff":"#cad7e8","font-size":15,"font-weight":700,"text-anchor":"middle"});
    drawGeometry(svg,solved.stages[i],n,cx,cy,scale,i,solved);
    let coordinates=i===0?"x":i===1?(solved.symmetric?"Qᵀx":"P⁻¹x"):i===2?"Λz": "Ax";
    text(svg,cx,300,coordinates,{fill:"#c3d3ea","text-anchor":"middle","font-size":16,"font-family":"Cambria Math, serif"});
    text(svg,cx,319,i===highlighted?"ETAPA SELECCIONADA":" ",{fill:"#8fb3ff","text-anchor":"middle","font-size":10});
  }
  const basisLabel=solved.symmetric?"Q":"P";
  const items=[];
  for(let i=0;i<n;i++){
    const vector=Array.from({length:n},(_,r)=>solved.P[r][i]);
    items.push("λ"+(i+1)+" = "+fmt(solved.values[i])+
      " · v"+(i+1)+" = ("+vector.map(fmt).join(", ")+")");
  }
  values.textContent=basisLabel+" = [v₁ … vₙ] · "+items.join("   |   ")+
    " · max |A − PΛP⁻¹| ≈ "+solved.residual.toExponential(1);
}

window.addEventListener("functionmapper:linear-change",event=>{
  current=event.detail;
  render();
});
stepInput.addEventListener("input",render);
toggle.addEventListener("change",render);
document.getElementById("spectral-prev").addEventListener("click",()=>{
  stepInput.value=Math.max(0,Number(stepInput.value)-1);render();
});
document.getElementById("spectral-next").addEventListener("click",()=>{
  stepInput.value=Math.min(3,Number(stepInput.value)+1);render();
});
document.getElementById("linear-show-eigen").addEventListener("change",render);
