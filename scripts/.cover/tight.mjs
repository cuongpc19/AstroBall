import sharp from "sharp";
const PLATE="scripts/.shots/plate.png", LOGO="scripts/.shots/logo-fix.png";
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
async function make(crop,W,H,logoFrac,pad,label){
  const art=await sharp(PLATE).extract(crop).resize(W,H).png().toBuffer();
  const meta=await sharp(LOGO).metadata();
  const lw=Math.round(W*logoFrac), lh=Math.round(lw*meta.height/meta.width);
  const logo=await sharp(LOGO).resize(lw,lh).png().toBuffer();
  const sh=await sharp(await sharp(LOGO).resize(lw,lh).extractChannel("alpha").png().toBuffer())
    .blur(18).linear(0.5,0).png().toBuffer();
  const shadow=await sharp({create:{width:lw,height:lh,channels:3,background:{r:22,g:14,b:52}}})
    .joinChannel(sh).png().toBuffer();
  const left=Math.round((W-lw)/2), top=H-lh-pad;
  const comp=await sharp(art).composite([
    {input:shadow,left,top:top+Math.round(lh*0.06)},{input:logo,left,top}]).png().toBuffer();
  const png=await grade(comp,W,H);
  await sharp(png).resize(300).toFile(`scripts/.shots/${label}.png`);
  await sharp(png).toFile(`scripts/.shots/${label}-full.png`);
  // how much plain violet is left?
  const d=await sharp(png).resize(160,Math.round(160*H/W),{fit:"fill"}).removeAlpha().raw().toBuffer();
  let n=0,tot=0;for(let i=0;i<d.length;i+=3){const[hh,,l]=rgb2hsl(d[i],d[i+1],d[i+2]);tot++;if(hh>0.62&&hh<0.82&&l<0.62)n++;}
  console.log(`${label}  nen tim ${(100*n/tot).toFixed(0)}%`);
}
await make({left:790,top:210,width:1250,height:1250},800,800,0.68,26,"T1");
await make({left:860,top:270,width:1120,height:1120},800,800,0.70,22,"T2");
await make({left:700,top:250,width:1348,height:1348},800,800,0.66,28,"T3");
