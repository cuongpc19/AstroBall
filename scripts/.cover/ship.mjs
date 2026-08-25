import sharp from "sharp";
const LOGO="scripts/.shots/logo-fix.png";
function rgb2hsl(r,g,b){r/=255;g/=255;b/=255;const mx=Math.max(r,g,b),mn=Math.min(r,g,b);
  const l=(mx+mn)/2;let s=0,h=0;if(mx!==mn){const d=mx-mn;s=l>0.5?d/(2-mx-mn):d/(mx+mn);
  h=mx===r?((g-b)/d+(g<b?6:0)):mx===g?((b-r)/d+2):((r-g)/d+4);h/=6;}return[h,s,l];}
function hue2rgb(p,q,t){if(t<0)t+=1;if(t>1)t-=1;
  if(t<1/6)return p+(q-p)*6*t;if(t<1/2)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p;}
function hsl2rgb(h,s,l){if(s===0){const v=Math.round(l*255);return[v,v,v];}
  const q=l<0.5?l*(1+s):l+s-l*s,p=2*l-q;
  return[hue2rgb(p,q,h+1/3),hue2rgb(p,q,h),hue2rgb(p,q,h-1/3)].map(v=>Math.max(0,Math.min(255,Math.round(v*255))));}
const cl=(v,a,b)=>Math.max(a,Math.min(b,v));
const K=0.32;

/** paint the Gemini sparkle out: fit a smooth quadratic to the violet around it */
async function dewatermark(src, wm){
  const {data,info}=await sharp(src).removeAlpha().raw().toBuffer({resolveWithObject:true});
  const W=info.width,H=info.height;
  const M=70;                                    // margin of clean ground to fit against
  const BX0=Math.max(0,wm.x0-M), BY0=Math.max(0,wm.y0-M);
  const BX1=Math.min(W,wm.x1+1+M), BY1=Math.min(H,wm.y1+1+M);
  const mw=BX1-BX0, mh=BY1-BY0;
  const inWm=(x,y)=>x+BX0>=wm.x0-4&&x+BX0<=wm.x1+4&&y+BY0>=wm.y0-4&&y+BY0<=wm.y1+4;
  const T=(x,y)=>[1,x,y,x*x,x*y,y*y];
  const out=Buffer.from(data);
  let worst=0;
  for(let c=0;c<3;c++){
    const A=Array.from({length:6},()=>new Float64Array(6)),b=new Float64Array(6);
    for(let y=0;y<mh;y++)for(let x=0;x<mw;x++){ if(inWm(x,y))continue;
      const t=T(x/mw,y/mh),v=data[((y+BY0)*W+(x+BX0))*3+c];
      for(let p=0;p<6;p++){b[p]+=t[p]*v;for(let q=0;q<6;q++)A[p][q]+=t[p]*t[q];}}
    for(let p=0;p<6;p++){let mx=p;for(let r=p+1;r<6;r++)if(Math.abs(A[r][p])>Math.abs(A[mx][p]))mx=r;
      [A[p],A[mx]]=[A[mx],A[p]];[b[p],b[mx]]=[b[mx],b[p]];
      for(let r=p+1;r<6;r++){const f=A[r][p]/A[p][p];if(!isFinite(f))continue;
        for(let q=p;q<6;q++)A[r][q]-=f*A[p][q];b[r]-=f*b[p];}}
    const k=new Float64Array(6);
    for(let p=5;p>=0;p--){let s=b[p];for(let q=p+1;q<6;q++)s-=A[p][q]*k[q];k[p]=s/A[p][p];}
    let e=0,en=0;
    for(let y=0;y<mh;y++)for(let x=0;x<mw;x++){
      const t=T(x/mw,y/mh);let v=0;for(let p=0;p<6;p++)v+=k[p]*t[p];
      const i=((y+BY0)*W+(x+BX0))*3+c;
      if(inWm(x,y)) out[i]=Math.max(0,Math.min(255,Math.round(v)));
      else {e+=Math.abs(v-data[i]);en++;}}
    worst=Math.max(worst,e/en);
  }
  console.log(`  xoa watermark: sai so tren nen that ${worst.toFixed(1)}/255`);
  return sharp(out,{raw:{width:W,height:H,channels:3}}).png().toBuffer();
}
async function grade(png,w,h){
  const im=sharp(png);
  const g=()=>im.clone().modulate({saturation:1.45,brightness:1.18}).linear(1.12,-10);
  const base=await g().removeAlpha().raw().toBuffer();
  const blr =await g().blur(22).removeAlpha().raw().toBuffer();
  const out=Buffer.from(base);
  for(let i=0;i<out.length;i+=3){
    const[hh,s,l]=rgb2hsl(out[i],out[i+1],out[i+2]);
    const[,,lb]=rgb2hsl(blr[i],blr[i+1],blr[i+2]);
    const w2=cl((0.50-l)/0.30,0,1)*cl(1-Math.abs(l-lb)/0.07,0,1);
    if(w2>0){const nl=l+K*(1-l)*w2,ns=cl(s*(1-0.06*w2),0,1);
      const[r,gg,b]=hsl2rgb(hh,ns,nl);out[i]=r;out[i+1]=gg;out[i+2]=b;}}
  return sharp(out,{raw:{width:w,height:h,channels:3}}).png().toBuffer();
}
async function ship(src,wm,crop,W,H,place,dst,tag){
  console.log(tag);
  const clean=await dewatermark(src,wm);
  const art=await sharp(clean).extract(crop).resize(W,H).png().toBuffer();
  const meta=await sharp(LOGO).metadata();
  const lw=Math.round(W*place.frac), lh=Math.round(lw*meta.height/meta.width);
  const logo=await sharp(LOGO).resize(lw,lh).png().toBuffer();
  const sh=await sharp(await sharp(LOGO).resize(lw,lh).extractChannel("alpha").png().toBuffer())
    .blur(18).linear(0.5,0).png().toBuffer();
  const shadow=await sharp({create:{width:lw,height:lh,channels:3,background:{r:22,g:14,b:52}}})
    .joinChannel(sh).png().toBuffer();
  const left=place.left!=null?Math.round(W*place.left):Math.round((W-lw)/2);
  const top =place.top !=null?Math.round(H*place.top ):H-lh-place.pad;
  const comp=await sharp(art).composite([
    {input:shadow,left,top:top+Math.round(lh*0.06)},{input:logo,left,top}]).png().toBuffer();
  const png=await grade(comp,W,H);
  await sharp(png).toFile(dst);
  await sharp(png).resize(330,330,{fit:"inside"}).toFile("scripts/.shots/s-"+tag.replace(/\W/g,"")+".png");
  const d=await sharp(png).resize(160,Math.round(160*H/W),{fit:"fill"}).removeAlpha().raw().toBuffer();
  let sS=0,bg=0,n=0;const ls=[];
  for(let i=0;i<d.length;i+=3){const[hh,s,l]=rgb2hsl(d[i],d[i+1],d[i+2]);sS+=s;ls.push(l);n++;
    if(hh>0.62&&hh<0.84&&l<0.62)bg++;}
  ls.sort((a,b)=>a-b);
  console.log(`  S ${(sS/n).toFixed(3)}  bien do ${(ls[Math.floor(n*0.95)]-ls[Math.floor(n*0.05)]).toFixed(2)}  nen ${Math.round(100*bg/n)}%`);
}
const D="store/crazygames/";
await ship(D+"Gemini_Generated_Image_8egrui8egrui8egr.png",{x0:1761,y0:1761,x1:1854,y1:1855},
  {left:90,top:60,width:1880,height:1880},800,800,{frac:0.66,pad:26},D+"cover-800x800-N.png","1:1");
await ship(D+"Gemini_Generated_Image_mydgy7mydgy7mydg.png",{x0:1408,y0:2240,x1:1503,y1:2335},
  {left:70,top:120,width:1556,height:2334},800,1200,{frac:0.66,pad:30},D+"cover-800x1200-N.png","2:3");
await ship(D+"Gemini_Generated_Image_sv9yp8sv9yp8sv9y.png",{x0:2464,y0:1249,x1:2558,y1:1343},
  {left:120,top:60,width:2512,height:1402},1920,1080,{frac:0.34,left:0.045,top:0.40},D+"cover-1920x1080-N.png","16:9");
