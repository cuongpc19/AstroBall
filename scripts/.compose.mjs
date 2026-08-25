import sharp from "sharp";
const PLATE="scripts/.shots/plate.png";      // logo removed, ground repainted
const LOGO ="scripts/.shots/logo-fix.png";
const {data,info}=await sharp("Manythings/image/vm54x7vm54x7vm54-clean.png").removeAlpha().raw().toBuffer({resolveWithObject:true});
const W=info.width;
function hsl(r,g,b){r/=255;g/=255;b/=255;const mx=Math.max(r,g,b),mn=Math.min(r,g,b);
  const l=(mx+mn)/2;let s=0,h=0;if(mx!==mn){const d=mx-mn;s=l>0.5?d/(2-mx-mn):d/(mx+mn);
  h=mx===r?((g-b)/d+(g<b?6:0)):mx===g?((b-r)/d+2):((r-g)/d+4);h/=6;}return[h,s,l];}
// fixed rectangle round the lockup, keyed by hue — no auto-bbox to get wrong
const RX=140,RY=685,RW=745,RH=480;
const rgba=Buffer.alloc(RW*RH*4);
for(let y=0;y<RH;y++)for(let x=0;x<RW;x++){
  const i=((y+RY)*W+(x+RX))*3,d=(y*RW+x)*4;
  const[h,s,l]=hsl(data[i],data[i+1],data[i+2]);
  const keep=!(h>0.640&&h<0.790) || (l>0.66&&s<0.42);
  rgba[d]=data[i];rgba[d+1]=data[i+1];rgba[d+2]=data[i+2];rgba[d+3]=keep?255:0;
}
// 1px feather, done in place — sharp's raw 1-channel round trip was striping the matte
const a=new Float32Array(RW*RH);for(let i=0;i<RW*RH;i++)a[i]=rgba[i*4+3];
const b=new Float32Array(RW*RH);
for(let y=0;y<RH;y++)for(let x=0;x<RW;x++){
  let s=0,n=0;
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    const nx=x+dx,ny=y+dy; if(nx<0||ny<0||nx>=RW||ny>=RH)continue; s+=a[ny*RW+nx];n++; }
  b[y*RW+x]=s/n; }
for(let i=0;i<RW*RH;i++)rgba[i*4+3]=Math.round(b[i]);
await sharp(rgba,{raw:{width:RW,height:RH,channels:4}}).png().toFile(LOGO);
const g=await sharp({create:{width:RW,height:RH,channels:3,background:{r:0,g:170,b:70}}})
  .composite([{input:LOGO}]).png().toBuffer();
await sharp(g).resize(420).toFile("scripts/.shots/logo-green.png");
console.log(`logo ${RW}x${RH}`);
