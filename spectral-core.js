/** Small real-matrix spectral toolkit (n = 1,2,3). Pure functions, no DOM. */
export function identity(n) {
  return Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>+(i===j)));
}
export function multiply(A,B){
  return A.map(row=>B[0].map((_,j)=>row.reduce((s,x,k)=>s+x*B[k][j],0)));
}
export function mulVec(A,v){return A.map(row=>row.reduce((s,x,k)=>s+x*v[k],0));}
export function transpose(A){return A[0].map((_,j)=>A.map(row=>row[j]));}
export function maxAbs(A){return Math.max(0,...A.flat().map(Math.abs));}
export function inverse(A){
  const n=A.length, M=A.map((r,i)=>r.concat(identity(n)[i]));
  const threshold=1e-9*Math.max(1,maxAbs(A));
  for(let i=0;i<n;i++){
    let pivot=i;
    for(let j=i+1;j<n;j++)if(Math.abs(M[j][i])>Math.abs(M[pivot][i]))pivot=j;
    if(Math.abs(M[pivot][i])<=threshold)return null;
    [M[i],M[pivot]]=[M[pivot],M[i]];
    const d=M[i][i];for(let k=0;k<2*n;k++)M[i][k]/=d;
    for(let j=0;j<n;j++){
      if(j===i)continue;
      const f=M[j][i];
      for(let k=0;k<2*n;k++)M[j][k]-=f*M[i][k];
    }
  }
  return M.map(row=>row.slice(n));
}
export function isSymmetric(A){
  const eps=1e-8*Math.max(1,maxAbs(A));
  return A.every((row,i)=>row.every((v,j)=>Math.abs(v-A[j][i])<=eps));
}
export function jacobiSymmetric(A) {
  const n=A.length;
  if(!isSymmetric(A))return null;
  const B=A.map(row=>row.slice());
  const Q=identity(n);
  const tolerance=1e-12*Math.max(1,maxAbs(A));
  for(let iteration=0;iteration<90;iteration++){
    let p=0,q=0,best=0;
    for(let i=0;i<n;i++)for(let j=i+1;j<n;j++){
      const v=Math.abs(B[i][j]);if(v>best){best=v;p=i;q=j;}
    }
    if(best<=tolerance)break;
    const angle=0.5*Math.atan2(2*B[p][q],B[q][q]-B[p][p]);
    // Rotation that diagonalizes the symmetric two-dimensional block.
    const c=Math.cos(angle),s=Math.sin(angle);
    // Qnew = Q R, where R = [[c,s],[-s,c]] at (p,q).
    for(let i=0;i<n;i++){
      const qp=Q[i][p],qq=Q[i][q];
      Q[i][p]=c*qp-s*qq; Q[i][q]=s*qp+c*qq;
    }
    const pp=B[p][p],qq=B[q][q],pq=B[p][q];
    B[p][p]=c*c*pp-2*c*s*pq+s*s*qq;
    B[q][q]=s*s*pp+2*c*s*pq+c*c*qq;
    B[p][q]=B[q][p]=0;
    for(let i=0;i<n;i++){
      if(i===p||i===q)continue;
      const ip=B[i][p],iq=B[i][q];
      B[i][p]=B[p][i]=c*ip-s*iq;
      B[i][q]=B[q][i]=s*ip+c*iq;
    }
  }
  const ordered=Array.from({length:n},(_,i)=>i).sort((a,b)=>B[b][b]-B[a][a]);
  return {
    values:ordered.map(i=>B[i][i]),
    P:Array.from({length:n},(_,r)=>ordered.map(i=>Q[r][i])),
  };
}
export function spectralDecomposition(A, eigenpairs = []) {
  const n=A.length, scale=Math.max(1,maxAbs(A));
  if(!Array.isArray(A)||n<1||n>3||A.some(row=>row.length!==n||row.some(v=>!Number.isFinite(v)))){
    return {ok:false,reason:"La matriz debe ser real, finita y cuadrada de tamaño 1–3."};
  }
  let P, values, symmetric=isSymmetric(A);
  if(symmetric){
    const solved=jacobiSymmetric(A);
    P=solved.P; values=solved.values;
  }else{
    const cols=[], vals=[];
    for(const pair of eigenpairs){
      for(const v of pair.vectors){
        if(cols.length>=n)break;
        if(v.length===n && v.every(Number.isFinite)) {
          const norm=Math.hypot(...v);
          if(norm>1e-12){cols.push(v.map(x=>x/norm)); vals.push(pair.value);}
        }
      }
    }
    if(cols.length<n)return {ok:false,reason:"No hay una eigenbase real completa. Puede haber eigenvalores complejos o una matriz defectuosa."};
    P=Array.from({length:n},(_,i)=>cols.map(col=>col[i]));
    values=vals;
  }
  const Pinv=symmetric?transpose(P):inverse(P);
  if(!Pinv)return {ok:false,reason:"Los eigenvectores no forman una base linealmente independiente."};
  const Lambda=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>i===j?values[i]:0));
  const recovered=multiply(multiply(P,Lambda),Pinv);
  const residual=Math.max(...A.flatMap((row,i)=>row.map((x,j)=>Math.abs(x-recovered[i][j]))));
  if(!Number.isFinite(residual)||residual>1e-5*scale){
    return {ok:false,reason:"No se obtuvo una diagonalización numéricamente estable (residuo elevado)."};
  }
  return {
    ok:true,symmetric,values,P,Pinv,Lambda,residual,
    stages:[identity(n),Pinv,multiply(Lambda,Pinv),recovered],
  };
}
