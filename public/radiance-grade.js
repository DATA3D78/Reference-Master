// SPDX-License-Identifier: GPL-3.0-only
// Grading math adapted from FXTD Studios Radiance (commit 0174a5811b64665714a366b209cfd73d44418e91),
// js/radiance_webgl.js and js/radiance_grade.js. Browser SDR subset and depth
// integration modified for FWRD.STUDIO, 2026. See vendor/radiance/LICENSE.txt.
export const gradeVertex=`attribute vec2 position;varying vec2 uv;void main(){uv=position*.5+.5;gl_Position=vec4(position,0.,1.);}`;
export const gradeFragment=`precision highp float;
varying vec2 uv;uniform sampler2D source,depthA,depthB;
uniform vec2 size,balance,colour;uniform vec4 light,optics;uniform vec3 depthEffects;
uniform float time,depthMix,depthEnabled;
float luma(vec3 c){return dot(c,vec3(.2126,.7152,.0722));}
vec3 linear(vec3 c){return mix(c/12.92,pow((c+.055)/1.055,vec3(2.4)),step(vec3(.04045),c));}
vec3 display(vec3 c){c=max(c,vec3(0.));return mix(c*12.92,1.055*pow(c,vec3(1./2.4))-.055,step(vec3(.0031308),c));}
vec4 sampleImage(vec2 p){return texture2D(source,clamp(p,vec2(0.),vec2(1.)));}
float depth(vec2 p){p=vec2(p.x,1.-p.y);return mix(texture2D(depthA,p).r,texture2D(depthB,p).r,depthMix);}
// Radiance's linear-light exposure, temperature/tint, contrast at 18% gray,
// quadratic shadows/highlights and low-saturation color boost.
vec3 primary(vec3 c){
 c=linear(c)*exp2(light.x);
 c=max(vec3(0.),c+vec3(balance.x, -balance.y,-balance.x));
 c=max(vec3(0.),(c-.18)*(1.+light.y)+.18);
 float y=luma(c),s=pow(1.-smoothstep(0.,.5,y),2.),h=pow(smoothstep(.5,1.,y),2.);
 c*=1.+light.w*s*.5;c*=1.+light.z*h*.5;
 float sat=clamp(max(c.r,max(c.g,c.b))-min(c.r,min(c.g,c.b)),0.,1.);
 c=mix(vec3(luma(c)),c,1.+(1.-sat*.8)*colour.y);
 return max(mix(vec3(luma(c)),c,1.+colour.x),vec3(0.));
}
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
void main(){
 vec4 raw=sampleImage(uv);vec3 c=primary(raw.rgb);float near=depthEnabled>.5?depth(uv):1.;
 if(depthEnabled>.5&&depthEffects.x>0.){
  // Focus on the foreground. Reject nearer taps so background blur does not
  // drag background colors across the sharp subject's silhouette.
  float radius=max(0.,.72-near)*depthEffects.x*min(size.x,size.y)*.035;
  vec3 sum=c;float total=1.;
  for(int i=0;i<24;i++){float t=(float(i)+.5)/24.,a=float(i)*2.399963;vec2 q=uv+vec2(cos(a),sin(a))*sqrt(t)*radius/size;float n=depth(q);float w=(1.-smoothstep(.03,.17,n-near))*sampleImage(q).a;sum+=primary(sampleImage(q).rgb)*w;total+=w;}
  c=sum/total;
 }
 if(depthEnabled>.5&&depthEffects.y>0.){float fog=1.-exp(-depthEffects.y*pow(1.-near,1.5)*1.6);c=mix(c,vec3(.65,.72,.8),fog);}
 if(depthEnabled>.5&&depthEffects.z>0.){vec2 px=2./size;float dx=depth(uv+vec2(px.x,0.))-depth(uv-vec2(px.x,0.)),dy=depth(uv+vec2(0.,px.y))-depth(uv-vec2(0.,px.y));vec3 normal=normalize(vec3(-dx*30.,-dy*30.,1.));float lambert=dot(normal,normalize(vec3(-.55,.65,1.)));float shape=(lambert-.72)*.8+(near-.5)*.16;c*=exp2(shape*depthEffects.z*2.);}
 // Radiance-inspired circular highlight bloom/halation in linear space.
 // Fixed radii scale with the image, so exports match the preview framing.
 if(optics.y>0.||optics.z>0.){
  vec3 glow=vec3(0.);float halation=0.;
  for(int i=0;i<24;i++){float t=(float(i)+.5)/24.,a=float(i)*2.399963;vec2 offset=vec2(cos(a),sin(a))*sqrt(t)*min(size.x,size.y)*.018/size;vec4 s=sampleImage(uv+offset);vec3 v=primary(s.rgb);float weight=exp(-t*2.)*s.a;float bright=smoothstep(.45,1.2,luma(v));glow+=(v/(1.+v))*bright*weight;halation+=max(0.,luma(v)-.4)*weight;}
  c+=glow/10.*optics.y*1.6;
  c+=vec3(1.,.16,.035)*(halation/10.)*optics.z*.7;
 }
 c=display(c);
 if(optics.x>0.){vec2 p=floor(uv*size/1.3)+floor(time*24.);float grain=(hash(p)+hash(p+17.)+hash(p+43.))/3.-.5;float density=.3+.7*(1.-abs(clamp(luma(c),0.,1.)*2.-1.));c+=grain*optics.x*.24*density;}
 float edge=smoothstep(.12,.72,length((uv-.5)*1.4142));
 if(optics.w>=0.)c*=1.-optics.w*edge*.85;else c=mix(c,vec3(1.),-optics.w*edge*.65);
 gl_FragColor=vec4(clamp(c,0.,1.),raw.a);
}`;
export function createProgram(gl,vertex,fragment){
 const program=gl.createProgram();for(const [type,code]of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]]){const shader=gl.createShader(type);gl.shaderSource(shader,code);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error('Could not prepare color grading: '+gl.getShaderInfoLog(shader));gl.attachShader(program,shader);gl.deleteShader(shader);}gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error('Could not start color grading: '+gl.getProgramInfoLog(program));return program;
}
export class GradePass{
 constructor(gl){this.gl=gl;this.program=createProgram(gl,gradeVertex,gradeFragment);this.u={};for(const n of ['source','depthA','depthB','size','balance','colour','light','optics','depthEffects','time','depthMix','depthEnabled'])this.u[n]=gl.getUniformLocation(this.program,n);this.target=gl.createTexture();this.framebuffer=gl.createFramebuffer();this.depthTextures=[gl.createTexture(),gl.createTexture()];this.depthKeys=[];}
 draw(source,width,height,g,{time=0,depth=null}={}){
  const gl=this.gl,u=this.u;gl.useProgram(this.program);const a=gl.getAttribLocation(this.program,'position');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);
  gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,source);gl.uniform1i(u.source,0);
  const setup=()=>{for(const p of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,p,gl.CLAMP_TO_EDGE);for(const p of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,p,gl.LINEAR);};
  for(let i=0;i<2;i++){gl.activeTexture(gl.TEXTURE5+i);gl.bindTexture(gl.TEXTURE_2D,this.depthTextures[i]);const frame=depth?.[i?'b':'a'];if(this.depthKeys[i]!==frame||!this.depthInitialized){setup();gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);gl.texImage2D(gl.TEXTURE_2D,0,gl.LUMINANCE,frame?.width||1,frame?.height||1,0,gl.LUMINANCE,gl.UNSIGNED_BYTE,frame?.data||new Uint8Array([255]));gl.pixelStorei(gl.UNPACK_ALIGNMENT,4);this.depthKeys[i]=frame;}}
  this.depthInitialized=true;gl.uniform1i(u.depthA,5);gl.uniform1i(u.depthB,6);
  gl.activeTexture(gl.TEXTURE7);gl.bindTexture(gl.TEXTURE_2D,this.target);if(this.width!==width||this.height!==height){setup();gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);this.width=width;this.height=height;}
  gl.bindFramebuffer(gl.FRAMEBUFFER,this.framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.target,0);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Choose a smaller export size for color grading.');
  gl.uniform2f(u.size,width,height);gl.uniform4f(u.light,g.exposure,g.contrast/100,g.highlights/100,g.shadows/100);gl.uniform2f(u.balance,g.warmth/500,g.tint/500);gl.uniform2f(u.colour,g.saturation/100,g.vibrance/100);gl.uniform4f(u.optics,g.grain/100,g.glow/100,g.halation/100,g.vignette/100);gl.uniform3f(u.depthEffects,g.lensBlur/100,g.atmosphere/100,g.relight/100);gl.uniform1f(u.time,time);gl.uniform1f(u.depthMix,depth?.mix||0);gl.uniform1f(u.depthEnabled,depth?1:0);gl.drawArrays(gl.TRIANGLES,0,6);gl.bindFramebuffer(gl.FRAMEBUFFER,null);return this.target;
 }
 dispose(){const gl=this.gl;gl.deleteTexture(this.target);this.depthTextures.forEach(t=>gl.deleteTexture(t));gl.deleteFramebuffer(this.framebuffer);gl.deleteProgram(this.program);}
}
