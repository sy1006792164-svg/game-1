'use strict';
// Original procedural launcher icon; no external image assets.
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib');
const W = 512, pixels = Buffer.alloc(W * W * 4);
function rgba(hex) { return [parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5,7),16),255]; }
function set(x,y,color) { if(x>=0&&y>=0&&x<W&&y<W){const i=(Math.floor(y)*W+Math.floor(x))*4;for(let k=0;k<4;k++)pixels[i+k]=color[k];} }
function circle(x,y,r,hex) { const color=rgba(hex);for(let a=Math.max(0,Math.floor(y-r));a<=Math.min(W-1,y+r);a++)for(let b=Math.max(0,Math.floor(x-r));b<=Math.min(W-1,x+r);b++)if((b-x)**2+(a-y)**2<=r*r)set(b,a,color); }
function polygon(points,hex) { const color=rgba(hex);for(let y=0;y<W;y++)for(let x=0;x<W;x++){let inside=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i],b=points[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;}if(inside)set(x,y,color);} }
function stroke(points,width,color) { for(let j=1;j<points.length;j++){const a=points[j-1],b=points[j],steps=Math.max(Math.abs(b[0]-a[0]),Math.abs(b[1]-a[1]));for(let i=0;i<=steps;i++)circle(a[0]+(b[0]-a[0])*i/steps,a[1]+(b[1]-a[1])*i/steps,width/2,color);} }
polygon([[0,0],[512,0],[512,512],[0,512]],'#315e4c');circle(268,270,184,'#426b57');circle(268,270,168,'#315e4c');
stroke([[73,145],[184,145],[205,125],[199,109]],10,'#b8cba3');stroke([[49,177],[186,177]],9,'#b8cba3');stroke([[68,209],[143,209]],8,'#b8cba3');
polygon([[126,246],[325,183],[393,363],[193,429]],'#224738');polygon([[126,226],[325,163],[393,343],[193,409]],'#f4ead0');polygon([[127,226],[268,285],[325,163]],'#e3cd9f');
stroke([[127,226],[268,285],[325,163]],7,'#dd8152');stroke([[193,409],[236,286]],5,'#dd8152');stroke([[393,343],[280,274]],5,'#dd8152');
circle(353,139,42,'#dd8152');const star=[];for(let i=0;i<10;i++){const a=-Math.PI/2+i*Math.PI/5,r=i%2?11:25;star.push([353+Math.cos(a)*r,139+Math.sin(a)*r]);}polygon(star,'#fff5d8');
const table=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;table[n]=c>>>0;}
function crc(b){let c=0xffffffff;for(const v of b)c=table[(c^v)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
function chunk(name,data){const type=Buffer.from(name),out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);type.copy(out,4);data.copy(out,8);out.writeUInt32BE(crc(Buffer.concat([type,data])),data.length+8);return out;}
const header=Buffer.alloc(13);header.writeUInt32BE(W);header.writeUInt32BE(W,4);header[8]=8;header[9]=6;
const raw=Buffer.alloc(W*(W*4+1));for(let y=0;y<W;y++)pixels.copy(raw,y*(W*4+1)+1,y*W*4,(y+1)*W*4);
fs.writeFileSync(path.resolve(__dirname,'../assets/icon.png'),Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));
console.log('Original 512 x 512 icon generated.');
