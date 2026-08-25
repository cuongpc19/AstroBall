import sharp from "sharp";
const SRC="Manythings/image/vm54x7vm54x7vm54-clean.png";
const {data,info}=await sharp(SRC).removeAlpha().raw().toBuffer({resolveWithObject:true});
const W=info.width,H=info.height;
const BX0=100,BY0=630,BX1=940,BY1=1225,mw=BX1-BX0,mh=BY1-BY0;
function hsl(r,g,b){r/=255;g/=255;b/=255;const mx=Math.max(r,g,b),mn=Math.min(r,g,b);
  const l=(mx+mn)/2;let s=0,h=0;if(mx!==mn){const d=mx-mn;s=l>0.5?d/(2-mx-mn):d/(mx+mn);
  h=mx===r?((g-b)/d+(g<b?6:0)):mx===g?((b-r)/d+2):((r-g)/d+4);h/=6;}return[h,s,l];}
const isViolet=i=>{const[h,,l]=hsl(data[i],data[i+1],data[i+2]);return h>0.640&&h<0.790&&l<0.55;};
// coarse "not backdrop" blobs -> the region to repaint (fat is fine here)
const raw=new Uint8Array(mw*mh);
for(let y=0;y<mh;y++)for(let x=0;x<mw;x++){
  const i=((y+BY0)*W+(x+BX0))*3;const[h,s,l]=hsl(data[i],data[i+1],data[i+2]);
  raw[y*mw+x]=(h>0.655&&h<0.775&&l<0.50&&s>0.22&&s<0.46)?0:1;}
const lab=new Int32Array(mw*mh).fill(-1);const keep=new Uint8Array(mw*mh);
for(let s=0;s<mw*mh;s++){if(!raw[s]||lab[s]>=0)continue;
  const q=[s];lab[s]=1;const cells=[];let touch=false;
  while(q.length){const p=q.pop();cells.push(p);const x=p%mw,y=(p/mw)|0;
    if(x===0||y===0||x===mw-1||y===mh-1)touch=true;
    for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,ny=y+dy;
      if(nx<0||ny<0||nx>=mw||ny>=mh)continue;const np=ny*mw+nx;
      if(raw[np]&&lab[np]<0){lab[np]=1;q.push(np);}}}
  if(!touch&&cells.length>200) for(const p of cells) keep[p]=1;}
const dilate=(m,R)=>{const o=new Uint8Array(m);
  for(let y=0;y<mh;y++)for(let x=0;x<mw;x++){if(!m[y*mw+x])continue;
    for(let dy=-R;dy<=R;dy++)for(let dx=-R;dx<=R;dx++){const nx=x+dx,ny=y+dy;
      if(nx>=0&&ny>=0&&nx<mw&&ny<mh)o[ny*mw+nx]=1;}}return o;};
const T=(x,y)=>[1,x,y,x*x,x*y,y*y];
function fit(mask,c){const A=Array.from({length:6},()=>new Float64Array(6)),b=new Float64Array(6);
  for(let y=0;y<mh;y+=2)for(let x=0;x<mw;x+=2){if(mask[y*mw+x])continue;
    const i=((y+BY0)*W+(x+BX0))*3;if(!isViolet(i))continue;
    const t=T(x/mw,y/mh),v=data[i+c];
    for(let p=0;p<6;p++){b[p]+=t[p]*v;for(let q=0;q<6;q++)A[p][q]+=t[p]*t[q];}}
  for(let p=0;p<6;p++){let mx=p;for(let r=p+1;r<6;r++)if(Math.abs(A[r][p])>Math.abs(A[mx][p]))mx=r;
    [A[p],A[mx]]=[A[mx],A[p]];[b[p],b[mx]]=[b[mx],b[p]];
    for(let r=p+1;r<6;r++){const f=A[r][p]/A[p][p];if(!isFinite(f))continue;
      for(let q=p;q<6;q++)A[r][q]-=f*A[p][q];b[r]-=f*b[p];}}
  const k=new Float64Array(6);
  for(let p=5;p>=0;p--){let s=b[p];for(let q=p+1;q<6;q++)s-=A[p][q]*k[q];k[p]=s/A[p][p];}return k;}
const ev=(k,x,y)=>{const t=T(x/mw,y/mh);let v=0;for(let p=0;p<6;p++)v+=k[p]*t[p];return v;};
let mask=dilate(keep,8);
for(let pass=0;pass<2;pass++){
  const K=[0,1,2].map(c=>fit(mask,c));const add=new Uint8Array(mask);
  for(let y=0;y<mh;y++)for(let x=0;x<mw;x++){if(mask[y*mw+x])continue;
    const i=((y+BY0)*W+(x+BX0))*3;if(!isViolet(i))continue;
    let d=0;for(let c=0;c<3;c++)d+=Math.abs(ev(K[c],x,y)-data[i+c]);
    if(d/3>6)add[y*mw+x]=1;}
  mask=dilate(add,4);}
const K=[0,1,2].map(c=>fit(mask,c));
const plate=Buffer.from(data);
for(let y=0;y<mh;y++)for(let x=0;x<mw;x++){const i=((y+BY0)*W+(x+BX0))*3;
  if(mask[y*mw+x])for(let c=0;c<3;c++)plate[i+c]=Math.max(0,Math.min(255,Math.round(ev(K[c],x,y))));}
await sharp(plate,{raw:{width:W,height:H,channels:3}}).png().toFile("scripts/.shots/plate.png");

// TIGHT cutout: the logo is BRIGHTER than the fitted ground; its drop shadow is darker.
// Key on that, so the shadow stays behind and the halo of violet does not travel with it.
const logoZone=dilate(keep,10);
const alpha=new Float32Array(mw*mh);
for(let y=0;y<mh;y++)for(let x=0;x<mw;x++){
  const i=((y+BY0)*W+(x+BX0))*3;
  const [h,s,l]=hsl(data[i],data[i+1],data[i+2]);
  // the letters are any hue but violet; the white outline is bright and pale;
  // the drop shadow is violet and dark, so it stays behind
  const notViolet = !(h>0.640 && h<0.790);
  const outline   = l>0.66 && s<0.42;
  alpha[y*mw+x] = (logoZone[y*mw+x] && (notViolet || outline)) ? 1 : 0;
}
const a8=Buffer.alloc(mw*mh);for(let i=0;i<mw*mh;i++)a8[i]=Math.round(alpha[i]*255);
const soft=await sharp(a8,{raw:{width:mw,height:mh,channels:1}}).blur(1.2).raw().toBuffer();
// crop to the letters' real extent
let x0=mw,x1=0,y0=mh,y1=0;
for(let y=0;y<mh;y++)for(let x=0;x<mw;x++) if(soft[y*mw+x]>40){
  if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;}
const P=6; x0=Math.max(0,x0-P);y0=Math.max(0,y0-P);x1=Math.min(mw-1,x1+P);y1=Math.min(mh-1,y1+P);
const cw=x1-x0+1, ch=y1-y0+1;
const rgba=Buffer.alloc(cw*ch*4);
for(let y=0;y<ch;y++)for(let x=0;x<cw;x++){
  const s=((y+y0+BY0)*W+(x+x0+BX0))*3, d=(y*cw+x)*4;
  rgba[d]=data[s];rgba[d+1]=data[s+1];rgba[d+2]=data[s+2];rgba[d+3]=soft[(y+y0)*mw+(x+x0)];}
await sharp(rgba,{raw:{width:cw,height:ch,channels:4}}).png().toFile("scripts/.shots/logo-cut.png");
console.log(`logo cutout ${cw}x${ch}  (ty le ${(cw/ch).toFixed(2)})`);
const g=await sharp({create:{width:cw,height:ch,channels:3,background:{r:0,g:170,b:70}}})
  .composite([{input:"scripts/.shots/logo-cut.png"}]).png().toBuffer();
await sharp(g).resize(420).toFile("scripts/.shots/logo-green.png");
