import {GradePass} from './radiance-grade.js';
import {curveTexture,EFFECTS,defaultEffect,normalizeEdit} from './editing-models.js';
const vertex=`attribute vec2 position;varying vec2 uv;void main(){uv=position*.5+.5;gl_Position=vec4(position,0.,1.);}`;
const fragment=`precision highp float;
varying vec2 uv;uniform sampler2D source;uniform sampler2D originalSource;uniform bool applyGrading;uniform sampler2D curves;uniform sampler2D glyphs;uniform vec2 size;uniform vec2 sourceSize;uniform vec4 tone;uniform vec2 levels;uniform vec4 gamma;uniform vec3 finish;uniform int effect;uniform vec4 fx;uniform vec3 ink;uniform vec3 paper;uniform float colored;uniform float time;uniform float compare;uniform vec3 midpoint;uniform float seed;uniform sampler2D historySource;uniform float historyReady;
float hash(vec2 p){return fract(sin(dot(p+seed,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+1.),f.x),f.y);}
mat2 rotate2(float a){return mat2(cos(a),-sin(a),sin(a),cos(a));}
float linePattern(float t,float width){float d=abs(fract(t)-.5);return 1.-smoothstep(width,width+.08,d);}
float luma(vec3 c){return dot(c,vec3(.2126,.7152,.0722));}
float random(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7))+time*71.)*43758.5453);}
vec3 original(vec2 p){return texture2D(source,clamp(p,vec2(0.),vec2(1.))).rgb;}
vec3 grade(vec2 p){vec3 c=original(p);if(!applyGrading)return c;vec2 d=1./sourceSize;
 if(finish.x>0.)c+=(c*4.-original(p+vec2(d.x,0.))-original(p-vec2(d.x,0.))-original(p+vec2(0.,d.y))-original(p-vec2(0.,d.y)))*finish.x;
 c*=exp2(tone.x);c=clamp((c-levels.x)/max(.01,levels.y-levels.x),0.,1.);c=pow(c,1./(gamma.rgb*gamma.a));
 c=(c-.5)*(1.+tone.y)+.5;c=mix(vec3(luma(c)),c,1.+tone.z);
 float a=tone.w;vec3 axis=normalize(vec3(1.));c=c*cos(a)+cross(axis,c)*sin(a)+axis*dot(axis,c)*(1.-cos(a));c=clamp(c,0.,1.);
 c=vec3(texture2D(curves,vec2((c.r*255.+.5)/256.,.5)).r,texture2D(curves,vec2((c.g*255.+.5)/256.,.5)).g,texture2D(curves,vec2((c.b*255.+.5)/256.,.5)).b);
 return c;}
float bayer(vec2 p){vec2 a=mod(floor(p),2.);vec2 b=mod(floor(p/2.),2.);return (4.*(2.*a.x+3.*a.y-4.*a.x*a.y)+(2.*b.x+3.*b.y-4.*b.x*b.y)+.5)/16.;}
void main(){vec2 p=uv;vec4 raw=texture2D(source,p);if(compare>=0.&&p.x<compare){gl_FragColor=texture2D(originalSource,p);return;}
 vec3 c=grade(p),outColor=c;float cell=max(.8,fx.y*size.x/1000.),y=luma(c);vec2 pixel=p*size;
 if(effect==2){float value=step(bayer(pixel/cell),clamp(y+(fx.w-.5),0.,1.));outColor=mix(paper,mix(ink,c,colored),value);}
 if(effect==3){float a=fx.z;mat2 r=mat2(cos(a),-sin(a),sin(a),cos(a));vec2 rotated=r*pixel,grid=floor(rotated/cell),q=fract(rotated/cell)-.5;vec2 center=mat2(cos(a),sin(a),-sin(a),cos(a))*(grid+.5)*cell/size;vec3 s=grade(center);float radius=sqrt(clamp(luma(s),0.,1.))*.7;float mask=1.-smoothstep(radius-.04,radius+.04,length(q));outColor=mix(paper,mix(ink,s,colored),mask);}
 if(effect==4){outColor=grade((floor(pixel/cell)+.5)*cell/size);}
 if(effect==6){outColor=mix(paper,mix(ink,c,colored),step(fx.w,y));}
 if(effect==7){float shift=(sin(pixel.y/35.+time*2.)+random(vec2(floor(pixel.y/12.),0.))*.5)*cell*.15/size.x;outColor=vec3(grade(p+vec2(shift+.003,0.)).r,c.g,grade(p-vec2(shift+.003,0.)).b);outColor*=.86+.14*sin(pixel.y*3.14159);outColor+=(random(pixel)-.5)*.055;}
 if(effect==8){outColor=mix(paper,ink,clamp(y+(fx.w-.5),0.,1.));}
 if(effect==10){vec2 axis=vec2(cos(fx.z),sin(fx.z));float stripe=dot(pixel,axis)/cell;float wave=sin(stripe*6.28318);outColor=grade(p+axis*wave*cell*.35/size);outColor*=.85+.15*cos(stripe*6.28318);outColor+=pow(max(0.,wave),12.)*.13;}
 // Thermal print treatments share ink response, but scans add irregular paper,
 // registration movement and exposure bands instead of a clean receipt.
 if(effect==15||effect==16){
  float tick=floor(time*7.);vec2 jitter=effect==15?(vec2(hash(vec2(tick,3.)),hash(vec2(tick,9.)))-.5)*.018:vec2(0.);
  vec2 q=(p-.5)/.84+.5+jitter;float rough=(noise(vec2(p.y*90.,4.))-.5)*.006;
  float edge=.07+rough;float bottom=.07+abs(fract(p.x*65.)-.5)*.014;
  float sheet=step(edge,p.x)*step(p.x,1.-edge)*step(bottom,p.y)*step(p.y,.93+rough);
  float py=luma(grade(q));py=clamp((py-.5)*1.55+.5+(.5-fx.w)*1.4,0.,1.);
  vec2 dots=floor(q*size/max(1.,cell*.45));float printed=step(py,hash(dots));
  float scan=effect==15?step(.9,hash(vec2(floor(q.y*150.),tick)))*.45:0.;
  vec3 thermal=mix(paper,ink,printed*(1.-scan));thermal+=(hash(floor(pixel))-.5)*.035;
  outColor=mix(paper*.76,thermal,sheet);
 }
 if(effect==17){
  vec2 g=floor(pixel/cell);float dots=0.;
  for(int iy=-1;iy<=1;iy++)for(int ix=-1;ix<=1;ix++){
   vec2 tile=g+vec2(float(ix),float(iy));vec2 center=(tile+vec2(.18+.64*hash(tile),.18+.64*hash(tile+39.)))*cell;
   float density=clamp(1.-luma(grade(center/size))+(fx.w-.5),0.,1.);
   float radius=(.18+.27*sqrt(density))*cell,aa=max(.08,min(.5,cell*.15));float mark=1.-smoothstep(max(0.,radius-aa),radius+aa,length(pixel-center));
   dots=max(dots,mark*step(hash(tile+91.),density));
  }
  outColor=mix(paper,mix(ink,c,colored),dots);
 }
 if(effect==18){
  vec2 q=rotate2(fx.z)*pixel/cell;float darkness=clamp(1.-y+(fx.w-.5),0.,1.);
  float wobble=sin(q.x*.7)*.07+sin(q.y*1.3)*.035;
  float a=linePattern(q.y+wobble,.09),b=linePattern(q.x-wobble,.075),d=linePattern((q.x+q.y)*.707,.07),e=linePattern((q.x-q.y)*.707,.06);
  float h=max(max(a*smoothstep(.08,.32,darkness),b*smoothstep(.32,.55,darkness)),max(d*smoothstep(.55,.78,darkness),e*smoothstep(.76,.96,darkness)));
  outColor=mix(paper,mix(ink,c*.6,colored),h);outColor+=(hash(floor(pixel))-.5)*.035;
 }
 if(effect==19){
  vec3 bloom=vec3(0.);for(int i=0;i<12;i++){float a=float(i)*.523599;vec3 s=grade(p+vec2(cos(a),sin(a))*cell*2./size);bloom+=max(vec3(0.),s-vec3(fx.w));}
  vec3 base=pow(max(c,vec3(0.)),vec3(.92));base=mix(base,base*.55+paper*.45,(1.-y)*.68);
  base=mix(base,base*.7+ink*.3,smoothstep(.4,1.,y));outColor=base+bloom/12.*vec3(1.15,.72,1.05)*1.8;
  outColor+=(hash(floor(pixel))-.5)*.032;
 }
 if(effect==20){
  vec2 axis=vec2(cos(fx.z),sin(fx.z)),crossAxis=vec2(-axis.y,axis.x);
  float along=dot(p-.5,crossAxis),seam=(noise(vec2(along*24.,3.))-.5)*.045+(noise(vec2(along*190.,7.))-.5)*.009;
  float cut=dot(p-.5,axis)-(fx.w-.5)*.8-seam,gap=fx.y/1500.;
  vec2 offset=axis*sign(cut)*gap*.75;vec3 fragment=grade(p+offset);
  float fibers=(hash(vec2(floor(along*size.y),4.))-.5)*.004;
  float mask=smoothstep(gap+fibers,gap+.003+fibers,abs(cut));
  vec3 edge=mix(paper,ink,smoothstep(gap*.4,gap,abs(cut))*.5);outColor=mix(edge,fragment,mask);
  outColor*=1.-.16*(1.-smoothstep(gap+.003,gap+.012,abs(cut)))*mask;
 }
 if(effect==21){
  float frameWidth=fx.y/500.,tick=floor(time*6.),mark=0.;vec2 q=p;
  for(int i=0;i<5;i++){
   float n=float(i),inset=.025+n*.007;float sx=sin(q.x*(29.+n*7.)+n+seed*.3+tick*.8)*.004+sin(q.x*121.+n)*.002;
   float sy=sin(q.y*(31.+n*5.)+n+seed*.7-tick*.5)*.004+sin(q.y*143.+n)*.002;
   float edge=min(min(abs(q.y-inset-sx),abs(q.y-(1.-inset)-sx)),min(abs(q.x-inset-sy),abs(q.x-(1.-inset)-sy)));
   float stroke=1.-smoothstep(.0015,.0015+1./min(size.x,size.y),edge);
   mark=max(mark,stroke*step(n,1.+fx.w*5.));
  }
  float border=1.-smoothstep(frameWidth,frameWidth+.015,min(min(q.x,1.-q.x),min(q.y,1.-q.y)));
  outColor=mix(c,paper,border*.45);outColor=mix(outColor,ink,mark);
 }
 if(effect==22){
  float tick=floor(time*13.),band=floor(pixel.y/max(2.,cell));float dropout=step(1.-fx.w*.45,hash(vec2(band,tick)));
  float shift=(hash(vec2(band+13.,tick))-.5)*dropout*cell*8./size.x;
  vec2 q=p+vec2(shift,0.);float split=(.001+dropout*.018)*fx.y/20.;
  outColor=vec3(grade(q+vec2(split,0.)).r,grade(q).g,grade(q-vec2(split,0.)).b);
  float snow=hash(floor(pixel)+tick*3.);outColor=mix(outColor,vec3(snow),dropout*.5);
  outColor*=.88+.12*step(.3,fract(pixel.y*.5));
 }
 if(effect==23){
  vec2 dir=vec2(cos(fx.z),sin(fx.z))*cell*5./size;vec3 trails=vec3(0.),lights=vec3(0.);
  for(int i=0;i<17;i++){float t=float(i)/16.;vec3 sampleColor=grade(p-dir*t);trails+=sampleColor;lights=max(lights,sampleColor);}
  outColor=mix(trails/17.,lights,.22+fx.w*.38);outColor=mix(outColor,c,.2);
  if(historyReady>0.5)outColor=mix(outColor,texture2D(historySource,p).rgb,.35+fx.w*.48);
 }
 if(effect==24){
  vec2 grid=floor(pixel/max(2.,cell));vec3 s=grade((grid+.5)*max(2.,cell)/size);
  float value=clamp(luma(s)+(fx.w-.5)*1.5+(bayer(grid)-.5)/3.,0.,.999);
  float toneIndex=floor(value*4.)/3.;outColor=mix(paper,ink,toneIndex);outColor*=.94+.06*step(.12,fract(pixel.y/max(2.,cell)));
 }
 if(effect==25){
  float tick=floor(time*10.);vec2 q=p+(vec2(hash(vec2(tick,0.)),hash(vec2(tick,5.)))-.5)*2./size;
  vec2 grid=floor(q*size/cell),f=fract(q*size/cell);vec2 snap=(grid+vec2(f.x+f.y>1.?.72:.28))*cell/size;
  vec3 s=grade(snap);float levelsCount=4.+floor(fx.w*12.);outColor=floor(clamp(s+(bayer(grid)-.5)/levelsCount,0.,1.)*levelsCount)/levelsCount;
 }
 if(effect==26){
  vec2 grid=floor(pixel/max(1.,cell*.55));float wear=noise(pixel/max(10.,cell*7.));
  float value=clamp(y+(wear-.5)*fx.w*.85,0.,1.);float dotMask=step(value,bayer(grid)*.65+hash(grid)*.35);
  dotMask*=step(fx.w*.18,hash(grid+76.));outColor=mix(paper,mix(ink,c,colored),dotMask);outColor+=(hash(floor(pixel))-.5)*.075;
 }
 if(effect==27){
  vec2 q=rotate2(fx.z)*(p-.5);float tiles=3.+fx.y*.09;vec2 grid=floor(q*tiles),f=fract(q*tiles);float pick=hash(grid);
  vec2 offset=(vec2(hash(grid+1.),hash(grid+7.))-.5)*.06;vec3 s=grade(p+offset);float sy=luma(s);
  float hatch=linePattern((pixel.x+pixel.y)/(max(2.,cell*.22)),.1)*smoothstep(.2,.8,1.-sy);
  vec3 mono=mix(paper,ink,step(sy,bayer(pixel/max(1.,cell*.1))));
  vec3 printColor=mix(paper,ink,hatch);vec3 piece=pick<fx.w?mono:pick<.78?mix(s,s*vec3(1.2,.85,.7),.45):printColor;
  float rip=(noise(vec2(pixel.y*.08,grid.x))-.5)*.04;float edge=smoothstep(.012,.035,abs(f.x+rip-.5));
  outColor=mix(paper,piece,edge);outColor+=(hash(floor(pixel))-.5)*.05;
 }
 if(effect==28){
  vec2 direction=vec2(cos(fx.z),sin(fx.z))*cell*4./size;vec3 echo=grade(p-direction),echo2=grade(p-direction*2.);
  vec3 held=historyReady>.5?texture2D(historySource,p-direction*.45).rgb:echo;
  float mask=smoothstep(.04,.2,length(held-c));outColor=mix(c,held,mask*(.2+fx.w*.35));outColor=max(outColor,echo2*(.4+fx.w*.3));outColor=max(outColor,echo*(.55+fx.w*.25));
 }
 if(effect==29){
  vec2 q=rotate2(fx.z)*(p-.5);float row=(floor((q.y+.5)*size.y/max(1.,cell))+.5)*max(1.,cell)/size.y;
  vec2 samplePoint=rotate2(-fx.z)*vec2((fx.w-.5)*.98,row-.5)+.5;outColor=grade(samplePoint);
 }
 if(effect==30){
  vec2 q=p*2.-1.;q*=1.+dot(q,q)*(.02+fx.w*.16);q=q*.5+.5;
  float border=step(0.,q.x)*step(q.x,1.)*step(0.,q.y)*step(q.y,1.);
  float stripe=mod(floor(pixel.x/max(1.,cell*.36)),3.);vec3 phosphor=stripe<1.?vec3(1.22,.72,.72):stripe<2.?vec3(.72,1.22,.72):vec3(.72,.72,1.22);
  outColor=grade(q)*phosphor*(.8+.2*sin(pixel.y/max(1.,cell*.5)*3.14159));outColor+=(random(floor(pixel))-.5)*.025;
  outColor*=border*(1.-.22*dot(p-.5,p-.5));
 }
 if(effect==31){
  float dirt=noise(pixel/max(3.,cell*2.))*.6+noise(pixel/max(2.,cell*.5))*.3+noise(pixel/max(1.,cell*.14))*.1,fine=hash(floor(pixel/max(1.,cell*.12)));
  float scratch=step(.987,noise(vec2(pixel.x*.6,2.)))*step(.32,noise(pixel/vec2(2.,120.)));
  float worn=smoothstep(.68-fx.w*.1,.91-fx.w*.1,dirt);vec3 faded=mix(c,vec3(y),.22)*vec3(1.04,.97,.85);
  outColor=mix(faded,paper,worn*.7);outColor=mix(outColor,ink,step(fine,fx.w*.018));outColor=mix(outColor,paper,scratch*.7);
  outColor+=(fine-.5)*(.06+fx.w*.08);
 }
 if(effect==32){
  vec2 q=floor(pixel/max(1.,cell*.35));float grain=(hash(q)+hash(q+19.)+hash(q+71.))/3.-.5;
  outColor=c+grain*(.08+fx.w*.72)*(1.-abs(y-.5)*.7);
 }
 if(effect==33){
  float pivot=clamp(fx.w,.05,.95);outColor=y<pivot?mix(paper,midpoint,y/pivot):mix(midpoint,ink,(y-pivot)/(1.-pivot));
 }
 c=mix(c,outColor,fx.x);c+=(random(floor(pixel))-0.5)*finish.y*.22;
 vec2 v=(p-.5)*1.4142;c*=1.-finish.z*smoothstep(.15,.85,dot(v,v));gl_FragColor=vec4(clamp(c,0.,1.),raw.a);}`;
export class EditRenderer{
 constructor(canvas){this.canvas=canvas;const gl=this.gl=canvas.getContext('webgl',{preserveDrawingBuffer:true,alpha:true,premultipliedAlpha:false,antialias:false});if(!gl)throw Error('This browser cannot start the live editor. Enable hardware acceleration and reopen the studio.');
 const compile=(type,src)=>{const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error('Could not prepare the image editor: '+gl.getShaderInfoLog(s));return s;};
 this.program=gl.createProgram();const v=compile(gl.VERTEX_SHADER,vertex),f=compile(gl.FRAGMENT_SHADER,fragment);gl.attachShader(this.program,v);gl.attachShader(this.program,f);gl.linkProgram(this.program);gl.deleteShader(v);gl.deleteShader(f);if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw Error('Could not start the image editor.');gl.useProgram(this.program);
 this.buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);const a=gl.getAttribLocation(this.program,'position');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);
 this.locations={};for(const name of ['source','originalSource','applyGrading','curves','glyphs','size','sourceSize','tone','levels','gamma','finish','effect','fx','ink','paper','colored','time','compare','midpoint','seed','historySource','historyReady'])this.locations[name]=gl.getUniformLocation(this.program,name);
 this.textures=[];for(let i=0;i<3;i++){const t=gl.createTexture();this.textures.push(t);gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.uniform1i(this.locations[['source','curves','glyphs'][i]],i);}
 const atlas=document.createElement('canvas');atlas.width=320;atlas.height=32;const c=atlas.getContext('2d');c.fillStyle='#000';c.fillRect(0,0,320,32);c.fillStyle='#fff';c.font='bold 30px monospace';c.textAlign='center';c.textBaseline='middle';[...' .:-=+*#%@'].forEach((ch,i)=>c.fillText(ch,i*32+16,17));gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,atlas);
 gl.uniform1i(this.locations.originalSource,3);this.targets=[];this.histories=new Map();gl.uniform1i(this.locations.historySource,4);this.maxSize=gl.getParameter(gl.MAX_TEXTURE_SIZE);this.gradePass=new GradePass(gl);
 }
 draw(source,width,height,settings,{time=0,compare=-1,depth=null}={}){
 const gl=this.gl;if(gl.isContextLost())throw Error('The graphics connection was lost. Refresh the studio to reopen your saved edit.');if(width>this.maxSize||height>this.maxSize)throw Error('Choose a smaller export size for this device.');
 if(this.canvas.width!==width)this.canvas.width=width;if(this.canvas.height!==height)this.canvas.height=height;gl.viewport(0,0,width,height);gl.useProgram(this.program);
 let upload=source,sw=source.videoWidth||source.naturalWidth||source.width,sh=source.videoHeight||source.naturalHeight||source.height;
 if(sw>this.maxSize||sh>this.maxSize){const scale=Math.min(this.maxSize/sw,this.maxSize/sh);this.staging??=document.createElement('canvas');this.staging.width=Math.max(1,Math.floor(sw*scale));this.staging.height=Math.max(1,Math.floor(sh*scale));this.staging.getContext('2d').drawImage(source,0,0,this.staging.width,this.staging.height);upload=this.staging;sw=upload.width;sh=upload.height;}
 settings=normalizeEdit(settings);const g=settings.grade,u=this.locations;
 gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.textures[0]);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,upload);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
 gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,this.textures[0]);
 const curveKey=JSON.stringify(settings.curves);if(curveKey!==this.curveKey){gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,this.textures[1]);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,256,1,0,gl.RGBA,gl.UNSIGNED_BYTE,curveTexture(settings.curves));this.curveKey=curveKey;}
 const graded=Object.values(g).some(v=>v!==0)?this.gradePass.draw(this.textures[0],width,height,g,{time,depth}):this.textures[0];
 gl.useProgram(this.program);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);const attribute=gl.getAttribLocation(this.program,'position');gl.enableVertexAttribArray(attribute);gl.vertexAttribPointer(attribute,2,gl.FLOAT,false,0,0);
 gl.uniform2f(u.size,width,height);gl.uniform4f(u.tone,0,0,0,0);gl.uniform2f(u.levels,0,1);gl.uniform4f(u.gamma,1,1,1,1);
 const effects=settings.effects.length?settings.effects:[defaultEffect()];
 const temporal=Number.isFinite(source.videoWidth)&&source.videoWidth>0;
 const historyKey=JSON.stringify([width,height,settings]);
 if(this.historySource!==source||this.historyKey!==historyKey||time<this.historyTime||time-this.historyTime>1){this.resetHistory();this.historySource=source;this.historyKey=historyKey;}
 this.historyTime=time;
 try{
  if(effects.length>1)this.prepareTargets(width,height);
  // Effects read the graded result, then the preceding effect in the stack.
  // Before/split comparison always uses the untouched source.
  for(let i=0;i<effects.length;i++){
   const e=effects[i],last=i===effects.length-1;
   gl.bindFramebuffer(gl.FRAMEBUFFER,last?null:this.targets[i%2].framebuffer);
   gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,i===0?graded:this.targets[(i-1)%2].texture);
   gl.uniform1i(u.applyGrading,0);gl.uniform2f(u.sourceSize,i===0?sw:width,i===0?sh:height);
   gl.uniform3f(u.finish,0,0,0);
   gl.uniform1f(u.time,time*(e.speed??1));gl.uniform1f(u.seed,e.seed??1);
   const history=temporal&&['slow-shutter','motion-freeze'].includes(e.id)?this.historyFor(e.id,width,height):null;
   if(history?.pending&&time>history.time){[history.texture,history.capture]=[history.capture,history.texture];history.ready=true;history.pending=false;}
   gl.activeTexture(gl.TEXTURE4);gl.bindTexture(gl.TEXTURE_2D,history?.texture||this.textures[0]);gl.uniform1f(u.historyReady,history?.ready?1:0);
   gl.uniform1i(u.effect,EFFECTS.find(f=>f.id===e.id)?.index||0);gl.uniform4f(u.fx,e.amount/100,e.size,e.angle*Math.PI/180,e.threshold);
   for(const [name,color] of [['ink',e.foreground],['paper',e.background],['midpoint',e.midtone||'#c76584']])gl.uniform3fv(u[name],color.slice(1).match(/../g).map(v=>parseInt(v,16)/255));
   gl.uniform1f(u.colored,e.sourceColor?1:0);gl.uniform1f(u.compare,last?compare:-1);gl.drawArrays(gl.TRIANGLES,0,6);
   // Keep one previous exposure per temporal layer. A paused redraw does not
   // accumulate itself; changing source/settings or seeking resets the history.
   if(history&&compare<0&&(!history.captured||time-history.time>=(e.id==='motion-freeze'?.08+e.threshold*.72:1/60))){
    gl.activeTexture(gl.TEXTURE4);gl.bindTexture(gl.TEXTURE_2D,history.capture);gl.copyTexSubImage2D(gl.TEXTURE_2D,0,0,0,0,0,width,height);history.captured=true;history.pending=true;history.time=time;
   }
  }
 }finally{gl.bindFramebuffer(gl.FRAMEBUFFER,null);}
 }
 resetHistory(){for(const h of this.histories.values()){this.gl.deleteTexture(h.texture);this.gl.deleteTexture(h.capture);}this.histories.clear();}
 historyFor(id,width,height){
  if(!this.histories.has(id)){
   const gl=this.gl,create=()=>{const texture=gl.createTexture();gl.activeTexture(gl.TEXTURE4);gl.bindTexture(gl.TEXTURE_2D,texture);for(const p of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,p,gl.CLAMP_TO_EDGE);for(const p of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,p,gl.LINEAR);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);return texture;};
   this.histories.set(id,{texture:create(),capture:create(),ready:false,captured:false,pending:false,time:0});
  }
  return this.histories.get(id);
 }
 prepareTargets(width,height){
  const gl=this.gl;if(this.targetWidth===width&&this.targetHeight===height)return;
  gl.activeTexture(gl.TEXTURE0);
  for(let i=0;i<2;i++){
   const target=this.targets[i]??={texture:gl.createTexture(),framebuffer:gl.createFramebuffer()};
   gl.bindTexture(gl.TEXTURE_2D,target.texture);
   for(const param of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,param,gl.CLAMP_TO_EDGE);
   for(const param of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,param,gl.LINEAR);
   gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
   gl.bindFramebuffer(gl.FRAMEBUFFER,target.framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,target.texture,0);
   if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Choose a smaller size to combine effects on this device.');
  }
  this.targetWidth=width;this.targetHeight=height;
 }

 dispose(){const gl=this.gl;this.gradePass.dispose();this.resetHistory();this.textures.forEach(t=>gl.deleteTexture(t));this.targets.forEach(t=>{gl.deleteTexture(t.texture);gl.deleteFramebuffer(t.framebuffer);});gl.deleteBuffer(this.buffer);gl.deleteProgram(this.program);gl.getExtension('WEBGL_lose_context')?.loseContext();}
}
