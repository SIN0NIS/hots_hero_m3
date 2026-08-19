/* 낱개 HTML 용 최소 뷰어 — 파일 하나로 완결, 서버 없이 더블클릭으로 연다.
 *
 * 본체 뷰어(hots_hero/js/viewer.js)에서 재생에 필요한 것만 떼어 왔다:
 * WebGL2 + 뼈 스키닝 + 동작·표정 재생 + 궤도 카메라. 이펙트·유닛·이어보기는
 * 없다. 자료는 같은 문서 안 <script> 로 심겨 있다 (HERO_DATA / HERO_ANIMS).
 *
 * window.PAGE = { title, sub, skins:[{slug,label,href}], current }
 *   href 가 있는 스킨은 딴 파일이다 — 고르면 그 파일로 건너간다 (쪼갠 영웅).
 */
(function () {
"use strict";
var PAGE = window.PAGE || { skins: [], current: 0 };

// ------------------------------------------------------------- 행렬 (열 우선)
function mMul(a, b) {
  var o = new Float32Array(16);
  for (var c = 0; c < 4; c++)
    for (var r = 0; r < 4; r++)
      o[c*4+r] = a[r]*b[c*4] + a[4+r]*b[c*4+1] + a[8+r]*b[c*4+2] + a[12+r]*b[c*4+3];
  return o;
}
function mPersp(fovy, asp, zn, zf) {
  var f = 1 / Math.tan(fovy / 2), o = new Float32Array(16);
  o[0] = f / asp; o[5] = f; o[11] = -1;
  o[10] = (zf + zn) / (zn - zf); o[14] = 2 * zf * zn / (zn - zf);
  return o;
}
function vSub(a,b){ return [a[0]-b[0],a[1]-b[1],a[2]-b[2]]; }
function vCross(a,b){ return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]; }
function vNorm(a){ var l=Math.hypot(a[0],a[1],a[2])||1; return [a[0]/l,a[1]/l,a[2]/l]; }
function vDot(a,b){ return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
// 열 우선 회전·이동 (셰이더가 uMVP*vec4(p) 열벡터 규약이라 표준형 그대로)
function mRotX(a){var c=Math.cos(a),s=Math.sin(a);
  return new Float32Array([1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1]);}
function mRotY(a){var c=Math.cos(a),s=Math.sin(a);
  return new Float32Array([c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1]);}
function mRotZ(a){var c=Math.cos(a),s=Math.sin(a);
  return new Float32Array([c,s,0,0, -s,c,0,0, 0,0,1,0, 0,0,0,1]);}
function mTrans(x,y,z){
  return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, x,y,z,1]);}
function mScale(s){
  return new Float32Array([s,0,0,0, 0,s,0,0, 0,0,s,0, 0,0,0,1]);}
function mLookAt(eye, at, up) {
  var z = vNorm(vSub(eye, at)), x = vNorm(vCross(up, z)), y = vCross(z, x);
  return new Float32Array([
    x[0],y[0],z[0],0, x[1],y[1],z[1],0, x[2],y[2],z[2],0,
    -vDot(x,eye), -vDot(y,eye), -vDot(z,eye), 1]);
}

// ---------------------------------------------- 뼈 행렬 (행 우선, v' = v*M)
function rTRS(lo, ro, so, out) {
  var x=ro[0],y=ro[1],z=ro[2],w=ro[3];
  var n=Math.sqrt(x*x+y*y+z*z+w*w);
  if (n<1e-9){x=y=z=0;w=1;n=1;} x/=n;y/=n;z/=n;w/=n;
  var m00=1-2*(y*y+z*z), m01=2*(x*y+z*w),   m02=2*(x*z-y*w);
  var m10=2*(x*y-z*w),   m11=1-2*(x*x+z*z), m12=2*(y*z+x*w);
  var m20=2*(x*z+y*w),   m21=2*(y*z-x*w),   m22=1-2*(x*x+y*y);
  var s0=so[0],s1=so[1],s2=so[2];
  out[0]=s0*m00; out[1]=s0*m01; out[2]=s0*m02; out[3]=0;
  out[4]=s1*m10; out[5]=s1*m11; out[6]=s1*m12; out[7]=0;
  out[8]=s2*m20; out[9]=s2*m21; out[10]=s2*m22; out[11]=0;
  out[12]=lo[0]; out[13]=lo[1]; out[14]=lo[2]; out[15]=1;
}
function rMul(a, b, out) {
  for (var i = 0; i < 4; i++) {
    var a0=a[i*4],a1=a[i*4+1],a2=a[i*4+2],a3=a[i*4+3];
    out[i*4]  =a0*b[0]+a1*b[4]+a2*b[8] +a3*b[12];
    out[i*4+1]=a0*b[1]+a1*b[5]+a2*b[9] +a3*b[13];
    out[i*4+2]=a0*b[2]+a1*b[6]+a2*b[10]+a3*b[14];
    out[i*4+3]=a0*b[3]+a1*b[7]+a2*b[11]+a3*b[15];
  }
}
function rInvAffine(m, out) {
  var a=m[0],b=m[1],c=m[2], d=m[4],e=m[5],f=m[6], g=m[8],h=m[9],i=m[10];
  var A=(e*i-f*h), B=-(d*i-f*g), C=(d*h-e*g);
  var det=a*A+b*B+c*C;
  if (Math.abs(det)<1e-12){ out.set([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]); return; }
  var id=1/det;
  var i00=A*id, i01=-(b*i-c*h)*id, i02=(b*f-c*e)*id;
  var i10=B*id, i11=(a*i-c*g)*id,  i12=-(a*f-c*d)*id;
  var i20=C*id, i21=-(a*h-b*g)*id, i22=(a*e-b*d)*id;
  var tx=m[12],ty=m[13],tz=m[14];
  out[0]=i00;out[1]=i01;out[2]=i02;out[3]=0;
  out[4]=i10;out[5]=i11;out[6]=i12;out[7]=0;
  out[8]=i20;out[9]=i21;out[10]=i22;out[11]=0;
  out[12]=-(tx*i00+ty*i10+tz*i20);
  out[13]=-(tx*i01+ty*i11+tz*i21);
  out[14]=-(tx*i02+ty*i12+tz*i22);
  out[15]=1;
}

// ------------------------------------------------------------- 셰이더
var VS = "#version 300 es\nprecision highp float;\n" +
"layout(location=0) in vec3 aPos;\nlayout(location=1) in vec3 aNrm;\n" +
"layout(location=2) in vec2 aUV;\nlayout(location=3) in vec4 aBone;\n" +
"layout(location=4) in vec4 aWeight;\nlayout(location=5) in float aVA;\n" +
"uniform mat4 uMVP;\n" +
"uniform sampler2D uBones;\nuniform int uSkin;\n" +
"out vec3 vN; out vec2 vUV; out vec3 vP; out float vVA;\n" +
"void fetchBone(int b, out vec3 r0, out vec3 r1, out vec3 r2, out vec3 r3){\n" +
"  vec4 a=texelFetch(uBones,ivec2(b*3,0),0);\n" +
"  vec4 c=texelFetch(uBones,ivec2(b*3+1,0),0);\n" +
"  vec4 d=texelFetch(uBones,ivec2(b*3+2,0),0);\n" +
"  r0=a.xyz; r1=c.xyz; r2=d.xyz; r3=vec3(a.w,c.w,d.w);\n}\n" +
"void main(){\n  vec3 p=aPos, n=aNrm;\n  if(uSkin==1){\n" +
"    float sum=aWeight.x+aWeight.y+aWeight.z+aWeight.w;\n" +
"    if(sum>0.0){ vec3 ap=vec3(0.0), an=vec3(0.0);\n" +
"      for(int k=0;k<4;k++){ float w=aWeight[k]; if(w<=0.0) continue;\n" +
"        vec3 r0,r1,r2,r3; fetchBone(int(aBone[k]),r0,r1,r2,r3);\n" +
"        ap+=w*(aPos.x*r0+aPos.y*r1+aPos.z*r2+r3);\n" +
"        an+=w*(aNrm.x*r0+aNrm.y*r1+aNrm.z*r2);\n      }\n" +
"      p=ap/sum; n=an/sum;\n    }\n  }\n" +
"  vN=n; vUV=aUV; vP=p; vVA=aVA;\n  gl_Position=uMVP*vec4(p,1.0);\n}";

var FS = "#version 300 es\nprecision highp float;\n" +
"in vec3 vN; in vec2 vUV; in vec3 vP; in float vVA;\n" +
"uniform sampler2D uTex, uEmis;\n" +
"uniform int uHasTex,uHasEmis,uUnshaded;\nuniform float uCutout;\n" +
"uniform float uFade,uScroll;\n" +
"uniform vec3 uEye,uSolid,uTint;\nuniform float uEmisGain;\n" +
"out vec4 outColor;\n" +
"void main(){\n" +
"  vec2 uv=vUV; uv.y-=uScroll;\n" +      // 불·기 조각은 흐르게 (근사)
"  int emisOnly=(uHasTex==0 && uHasEmis==1)?1:0;\n" +
"  vec4 base;\n" +
"  if(uHasTex==1) base=texture(uTex,uv);\n" +
"  else if(emisOnly==1) base=texture(uEmis,uv);\n" +
"  else base=vec4(uSolid,1.0);\n" +
"  if(uCutout>0.0 && base.a<uCutout) discard;\n" +
"  vec3 col=base.rgb;\n" +
"  if(uUnshaded==0 && emisOnly==0){\n" +
"    vec3 N=normalize(vN); if(!gl_FrontFacing) N=-N;\n" +
"    vec3 key=normalize(vec3(0.45,-0.75,0.75));\n" +
"    vec3 fill=normalize(vec3(-0.7,0.35,0.25));\n" +
"    float kd=max(dot(N,key),0.0); float fd=max(dot(N,fill),0.0);\n" +
"    float h=N.z*0.5+0.5;\n" +
"    vec3 amb=mix(vec3(0.20,0.19,0.22),vec3(0.42,0.46,0.55),h);\n" +
"    vec3 V=normalize(uEye-vP); vec3 H=normalize(V+key);\n" +
"    float spec=pow(max(dot(N,H),0.0),28.0)*0.18;\n" +
"    col=base.rgb*(amb+kd*vec3(1.05,1.00,0.92)+fd*vec3(0.22,0.26,0.34))+vec3(spec);\n" +
"    float rim=pow(1.0-max(dot(N,V),0.0),3.0)*0.16;\n" +
"    col+=vec3(rim)*vec3(0.5,0.7,1.0);\n  }\n" +
// 발광은 «어두운 데를 밝히는» 것이지 «그림을 덮는» 것이 아니다. 그냥 더하면
// 넓은 발광맵(겐지 죽음송곳니 갑주)이 디퓨즈를 씻어내 민짜가 된다.
"  if(uHasEmis==1 && emisOnly==0){\n" +
"    vec3 e=texture(uEmis,uv).rgb*uEmisGain;\n" +
"    col=max(col,e)+e*0.25;\n  }\n" +
// 정점 알파 — 이펙트 리본이 끝으로 갈수록 흐려지는 모양이 여기 실려 있다.
// 알파에만 곱한다: 더하기 통로가 (SRC_ALPHA, ONE) 이라 색에도 곱하면 제곱이
// 되어 불꽃이 흩어진 불티처럼 성글어진다.
"  outColor=vec4(col*uTint*uFade, base.a*uFade*vVA);\n}";

var GVS = "#version 300 es\nprecision highp float;\n" +
"layout(location=0) in vec3 aPos;\nuniform mat4 uMVP;\n" +
"void main(){ gl_Position=uMVP*vec4(aPos,1.0); }";
var GFS = "#version 300 es\nprecision highp float;\n" +
"uniform vec3 uCol; uniform float uA; out vec4 outColor;\n" +
"void main(){ outColor=vec4(uCol,uA); }";

function compile(gl, type, src) {
  var s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
    throw new Error(gl.getShaderInfoLog(s));
  return s;
}
function program(gl, vs, fs) {
  var p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(p));
  return p;
}

// ------------------------------------------------------------- 준비
var cv = document.getElementById("gl");
var msg = document.getElementById("msg");
var gl = cv.getContext("webgl2", { antialias: true, alpha: false });
if (!gl) { msg.textContent = "이 브라우저는 WebGL2 를 지원하지 않는다."; return; }

var prog = program(gl, VS, FS), gprog = program(gl, GVS, GFS);
var U = {}, GU = {};
["uMVP","uTex","uEmis","uHasTex","uHasEmis","uUnshaded","uCutout","uEye",
 "uSolid","uBones","uSkin","uFade","uScroll",
 "uEmisGain","uTint"].forEach(function (n) {
  U[n] = gl.getUniformLocation(prog, n);
});
["uMVP","uCol","uA"].forEach(function (n) { GU[n] = gl.getUniformLocation(gprog, n); });

gl.enable(gl.DEPTH_TEST);
gl.enable(gl.CULL_FACE);
gl.cullFace(gl.BACK);
gl.clearColor(0.043, 0.059, 0.086, 1);

var gridVao = gl.createVertexArray(), gridN = 0;
(function () {
  var v = [], N = 20, S = 0.5;
  for (var i = -N; i <= N; i++) {
    v.push(i*S,-N*S,0, i*S,N*S,0, -N*S,i*S,0, N*S,i*S,0);
  }
  gridN = v.length / 3;
  gl.bindVertexArray(gridVao);
  var b = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, b);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
})();

// ------------------------------------------------------------- 자료 해석
function b64ToBuf(s) {
  var bin = atob(s), n = bin.length, a = new Uint8Array(n);
  for (var i = 0; i < n; i++) a[i] = bin.charCodeAt(i);
  return a.buffer;
}
function makeTexture(uri) {
  var t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA,
                gl.UNSIGNED_BYTE, new Uint8Array([160,160,160,255]));
  var im = new Image();
  im.onload = function () {
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);   // DirectX 식 UV
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    var ax = gl.getExtension("EXT_texture_filter_anisotropic");
    if (ax) gl.texParameterf(gl.TEXTURE_2D, ax.TEXTURE_MAX_ANISOTROPY_EXT,
      Math.min(8, gl.getParameter(ax.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
  };
  im.src = uri;
  return t;
}

function decodeAnim(a, map) {
  var raw = new Uint16Array(b64ToBuf(a.bones));
  var mapped = new Int32Array(raw.length);
  for (var i = 0; i < raw.length; i++)
    mapped[i] = map[raw[i]] !== undefined ? map[raw[i]] : -1;
  var o = { name: a.name, dur: a.dur || 1, bones: mapped };
  ["loc","rot","scl"].forEach(function (k) {
    o[k] = {
      off: new Uint32Array(b64ToBuf(a[k + "_off"])),
      t:   new Uint16Array(b64ToBuf(a[k + "_t"])),
      v:   (k === "rot") ? new Int16Array(b64ToBuf(a.rot_v))
                         : new Float32Array(b64ToBuf(a[k + "_v"]))
    };
  });
  return o;
}

var _tmp = { l: [0,0,0], r: [0,0,0,1], s: [1,1,1] };
function sampleTrack(tr, k, comps, t, scale, out) {
  var s = tr.off[k], e = tr.off[k + 1];
  if (e <= s) return false;
  var n = e - s, c;
  if (n === 1 || t <= tr.t[s]) {
    for (c = 0; c < comps; c++) out[c] = tr.v[s * comps + c] * scale;
    return true;
  }
  if (t >= tr.t[e - 1]) {
    for (c = 0; c < comps; c++) out[c] = tr.v[(e - 1) * comps + c] * scale;
    return true;
  }
  var lo = s, hi = e - 1;
  while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (tr.t[mid] <= t) lo = mid; else hi = mid; }
  var t0 = tr.t[lo], t1 = tr.t[lo + 1];
  var f = (t1 <= t0) ? 0 : (t - t0) / (t1 - t0);
  var o0 = lo * comps, o1 = (lo + 1) * comps;
  if (comps === 4) {
    var ax=tr.v[o0]*scale, ay=tr.v[o0+1]*scale, az=tr.v[o0+2]*scale, aw=tr.v[o0+3]*scale;
    var bx=tr.v[o1]*scale, by=tr.v[o1+1]*scale, bz=tr.v[o1+2]*scale, bw=tr.v[o1+3]*scale;
    var d = ax*bx + ay*by + az*bz + aw*bw;
    if (d < 0) { bx=-bx; by=-by; bz=-bz; bw=-bw; d=-d; }
    var k0 = 1 - f, k1 = f;
    if (d < 0.9995) {
      var th = Math.acos(Math.max(-1, Math.min(1, d))), sn = Math.sin(th);
      if (sn > 1e-6) { k0 = Math.sin(k0 * th) / sn; k1 = Math.sin(f * th) / sn; }
    }
    out[0]=ax*k0+bx*k1; out[1]=ay*k0+by*k1; out[2]=az*k0+bz*k1; out[3]=aw*k0+bw*k1;
    var ln = Math.hypot(out[0],out[1],out[2],out[3]) || 1;
    out[0]/=ln; out[1]/=ln; out[2]/=ln; out[3]/=ln;
    return true;
  }
  for (c = 0; c < comps; c++)
    out[c] = (tr.v[o0 + c] * (1 - f) + tr.v[o1 + c] * f) * scale;
  return true;
}

function applyAnim(S, A, t, loc, rot, scl, got) {
  var n = S.n;
  for (var i = 0; i < A.bones.length; i++) {
    var b = A.bones[i];
    if (b < 0 || b >= n) continue;
    var hit = 0;
    if (!(S.lockLoc && S.lockLoc[b]) &&
        sampleTrack(A.loc, i, 3, t, 1, _tmp.l)) { loc.set(_tmp.l, b*3); hit = 1; }
    if (sampleTrack(A.rot, i, 4, t, 1/32767, _tmp.r)) { rot.set(_tmp.r, b*4); hit = 1; }
    if (sampleTrack(A.scl, i, 3, t, 1, _tmp.s)) { scl.set(_tmp.s, b*3); hit = 1; }
    if (hit && got) got[b] = 1;
  }
}

/* 제자리 걷기: 걷기 동작은 뿌리 뼈를 앞으로 밀어 화면 밖으로 내보내므로 그
   이동을 무시한다(lockLoc). 그런데 뿌리가 하나가 아니다 —
   · 타이커스의 미니건은 제 뿌리 뼈에 매달려 «몸 옆 1.7칸» 에 주차돼 있고
     동작이 그것을 손으로 데려온다. 얼리면 총이 공중에 떠 버린다.
   · 폴스타트는 사람과 그리핀이 각각 제 뿌리를 갖는데, 둘의 동작 이동량이
     서로 달라 풀어 주면 사람이 그리핀 속으로 가라앉는다.
   가르는 기준은 «바인드에서 몸에 닿아 있는가» 다 — 소성 때 재서
   bones.free 에 «주차된 부속» 뿌리 번호를 적어 둔다. */
function tuneRootLocks(m) {
  var S = m.sk, fr = m.d.bones && m.d.bones.free;
  if (!S || !S.lockLoc || !fr) return;
  for (var k = 0; k < fr.length; k++)
    if (fr[k] >= 0 && fr[k] < S.n) S.lockLoc[fr[k]] = 0;
}

function updateBones(m, animIdx, t, faceIdx, ft) {
  var S = m.sk;
  if (!S) return;
  var n = S.n, b;
  var loc = S.curLoc, rot = S.curRot, scl = S.curScl;
  loc.set(S.bLoc); rot.set(S.bRot); scl.set(S.bScl);
  var got = S.got || (S.got = new Uint8Array(n));
  got.fill(0);
  var A = (animIdx >= 0 && m.anims[animIdx]) ? m.anims[animIdx] : null;
  if (A) applyAnim(S, A, t, loc, rot, scl, got);
  var F = (faceIdx >= 0 && m.faces[faceIdx]) ? m.faces[faceIdx] : null;
  if (F) applyAnim(S, F, ft, loc, rot, scl, got);

  var L = S.mL, W = S.mW, D = S.mD, tex = S.texData;
  for (b = 0; b < n; b++) {
    rTRS(loc.subarray(b*3,b*3+3), rot.subarray(b*4,b*4+4),
         scl.subarray(b*3,b*3+3), L);
    // 모델과 팩의 뼈 사슬이 다르면(레이너 marshall) 접기 행렬로 상쇄한다.
    // 접기는 제 팩(첫 팩) 기준이라 합쳐 온 팩(_fb) 동작에는 안 건다.
    if (m.fold && got[b] && m.fold[b] && !(A && A._fb)) {
      rMul(L, m.fold[b], D);
      L.set(D);
    }
    var p = S.parent[b], wo = b * 16;
    if (p >= 0 && p < b) rMul(L, W.subarray(p*16,p*16+16), S.scratch);
    else S.scratch.set(L);
    W.set(S.scratch, wo);
    rMul(S.invBind.subarray(wo, wo+16), S.scratch, D);
    var o = b * 12;
    tex[o]  =D[0]; tex[o+1]=D[1]; tex[o+2] =D[2];  tex[o+3] =D[12];
    tex[o+4]=D[4]; tex[o+5]=D[5]; tex[o+6] =D[6];  tex[o+7] =D[13];
    tex[o+8]=D[8]; tex[o+9]=D[9]; tex[o+10]=D[10]; tex[o+11]=D[14];
  }
  gl.bindTexture(gl.TEXTURE_2D, S.tex);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, n*3, 1, gl.RGBA, gl.FLOAT, tex);
}

function buildSkeleton(d) {
  if (!d.bones || !d.skin) return null;
  var n = d.bones.n;
  var S = {
    n: n,
    parent: new Int16Array(b64ToBuf(d.bones.parent)),
    bLoc: new Float32Array(b64ToBuf(d.bones.loc)),
    bRot: new Float32Array(b64ToBuf(d.bones.rot)),
    bScl: new Float32Array(b64ToBuf(d.bones.scl)),
    curLoc: new Float32Array(n*3), curRot: new Float32Array(n*4),
    curScl: new Float32Array(n*3),
    // 제자리 걷기용 (tuneRootLocks 참조) — 뒤에서 채운다
    roots: null, mainRoot: -1, lockLoc: null,
    mL: new Float32Array(16), mD: new Float32Array(16),
    scratch: new Float32Array(16),
    mW: new Float32Array(n*16), invBind: new Float32Array(n*16),
    texData: new Float32Array(n*12)
  };
  var L = new Float32Array(16), W = new Float32Array(n*16), tmp = new Float32Array(16);
  // 스키닝의 바인드는 뼈 초기값이 아니라 IREF(역바인드)다 — 정점이 그 자세로
  // 저장돼 있다. 구운 자료에 있으면 그걸 그대로 쓴다 (없으면 옛 방식).
  var IB = d.bones.ibind ? new Float32Array(b64ToBuf(d.bones.ibind)) : null;
  for (var b = 0; b < n; b++) {
    rTRS(S.bLoc.subarray(b*3,b*3+3), S.bRot.subarray(b*4,b*4+4),
         S.bScl.subarray(b*3,b*3+3), L);
    var p = S.parent[b];
    if (p >= 0 && p < b) rMul(L, W.subarray(p*16,p*16+16), tmp);
    else tmp.set(L);
    W.set(tmp, b*16);
    if (IB && IB.length >= (b + 1) * 16) {
      S.invBind.set(IB.subarray(b*16, b*16+16), b*16);
    } else {
      rInvAffine(tmp, L);
      S.invBind.set(L, b*16);
    }
  }
  // 뿌리마다 자손 수를 세어 «몸통 뿌리» 를 고른다 (부모 번호가 제 번호보다
  // 작다는 전제는 뼈 표가 위에서 아래로 정렬돼 있어 성립한다)
  var rootOf = new Int32Array(n), cnt = new Int32Array(n), i2;
  for (i2 = 0; i2 < n; i2++) {
    var p2 = S.parent[i2];
    rootOf[i2] = (p2 >= 0 && p2 < i2) ? rootOf[p2] : i2;
    cnt[rootOf[i2]]++;
  }
  S.roots = []; S.lockLoc = new Uint8Array(n);
  var best = -1;
  for (i2 = 0; i2 < n; i2++) {
    if (S.parent[i2] < 0 || S.parent[i2] >= i2) { S.roots.push(i2); S.lockLoc[i2] = 1; }
    if (cnt[i2] > (best < 0 ? 0 : cnt[best])) best = i2;
  }
  S.mainRoot = best;
  S.tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, S.tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, n*3, 1, 0, gl.RGBA, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return S;
}

/* 동작 묶음의 뼈 이름을 이 모델의 뼈 번호로 잇는다. 정확한 이름 우선,
   없으면 «가운데 토막 하나 뺀» 별칭 (본체 뷰어와 같은 규칙). */
function attachAnims(m) {
  var d = m.d;
  m.anims = []; m.faces = [];
  if (!m.sk || !d.bones || !d.bones.names) return;
  var byName = {}, alias = {}, bad = {};
  d.bones.names.forEach(function (nm, i) {
    if (nm && byName[nm] === undefined) byName[nm] = i;
  });
  d.bones.names.forEach(function (nm, i) {
    if (!nm) return;
    var p = nm.split("_");
    for (var k = 1; k < p.length; k++) {
      var a = p.slice(0, k).concat(p.slice(k + 1)).join("_");
      if (!a || byName[a] !== undefined) continue;
      if (alias[a] !== undefined && alias[a] !== i) bad[a] = 1;
      else alias[a] = i;
    }
  });
  Object.keys(bad).forEach(function (a) { delete alias[a]; });
  function idxOf(nm) {
    if (byName[nm] !== undefined) return byName[nm];
    if (alias[nm] !== undefined) return alias[nm];
    return -1;
  }
  /* 별칭으로 이은 뼈가 정말 같은 자리인지 견준다. 이름은 비슷한데 자리가
     아주 다른 짝을 끊는다 — 무라딘 이미야르 군주의 망치가 기본 스킨 망치
     트랙을 받아 손에서 땅밑으로 끌려갔었다. 끊긴 뼈는 부모만 따라간다. */
  function aliasOK(pack, i, bi) {
    if (!pack.rloc || !pack.rrot || !d.bones.loc) return true;
    if (!pack._rl) {
      pack._rl = new Float32Array(b64ToBuf(pack.rloc));
      pack._rr = new Float32Array(b64ToBuf(pack.rrot));
    }
    var ml = new Float32Array(b64ToBuf(d.bones.loc));
    var mr = new Float32Array(b64ToBuf(d.bones.rot));
    var dx = ml[bi*3] - pack._rl[i*3],
        dy = ml[bi*3+1] - pack._rl[i*3+1],
        dz = ml[bi*3+2] - pack._rl[i*3+2];
    if (Math.sqrt(dx*dx + dy*dy + dz*dz) > 0.15) return false;
    var dot = 0;
    for (var k = 0; k < 4; k++) dot += mr[bi*4+k] * pack._rr[i*4+k];
    return Math.abs(dot) > 0.866;        // 60° 안쪽만 통과
  }

  function load(key, inline) {
    var pack = inline || (key && (window.HERO_ANIMS || {})[key]);
    if (!pack) return [];
    var map = {};
    pack.names.forEach(function (nm, i) {
      var bi = byName[nm];
      if (bi === undefined) {            // 별칭으로 이은 것만 검사한다
        bi = alias[nm];
        if (bi !== undefined && !aliasOK(pack, i, bi)) bi = -1;
      }
      map[i] = (bi === undefined) ? -1 : bi;
    });
    return pack.anims.map(function (a) { return decodeAnim(a, map); });
  }
  // 이펙트 모델은 동작을 제 안에 들고 있다 (anims_inline)
  m.anims = load(d.anim_key, d.anims_inline);
  m.nOwn = m.anims.length;              // 전용 팩 동작 수 (기본 동작 고르기)
  m.faces = load(d.face_key);
  // 스킨 전용 팩이 보충용 몇 개뿐인 경우가 있다 — 잠옷투르는 제 팩에
  // Stand Cover 3개뿐이고 본 동작 38개는 영웅 기본 팩에 있다. 기본 팩
  // 뼈의 45% 이상이 이 모델에 이어질 때만 뒤에 합친다 (엉뚱한 골격이면
  // 몸이 뒤틀리므로 — 굽는 쪽과 같은 문턱). 같은 이름은 전용 것이 이긴다.
  var fb = PAGE.baseAnim;
  if (d.anim_key && fb && fb !== d.anim_key && (window.HERO_ANIMS || {})[fb]) {
    var pk = window.HERO_ANIMS[fb], hit = 0;
    pk.names.forEach(function (nm) { if (idxOf(nm) >= 0) hit++; });
    if (hit / Math.max(pk.names.length, 1) >= 0.45) {
      var have = {};
      m.anims.forEach(function (a) { have[a.name] = 1; });
      load(fb).forEach(function (a) {
        if (!have[a.name]) { a._fb = 1; m.anims.push(a); }
      });
    }
  }

  // ── 사슬 접기 준비 ────────────────────────────────────────────────
  // 모델과 팩의 뼈 사슬이 다른 경우가 있다. 레이너 marshall:
  //   모델  Torso → Bone_Neck(bind 회전 ~100°) → Head
  //   팩    Torso → Bone_Helmet               → Head
  // 팩의 Head 지역값은 «Helmet 기준»이라, 모델의 Neck 위에 그대로 얹으면
  // 목이 접힌다. 트랙 받은 뼈에 접기 행렬
  //   F = (팩 쪽 삽입 사슬의 쉬는 지역행렬 곱) · inv(모델 쪽 삽입 bind 곱)
  // 을 곱해 두 사슬의 차이를 상쇄한다 (updateBones 에서 L·F).
  function foldFor(pack) {
    if (!pack || !pack.rpar || !pack.rloc || !d.bones || !d.bones.n)
      return null;
    if (!pack._rl) {
      pack._rl = new Float32Array(b64ToBuf(pack.rloc));
      pack._rr = new Float32Array(b64ToBuf(pack.rrot));
    }
    if (!pack._rs && pack.rscl)
      pack._rs = new Float32Array(b64ToBuf(pack.rscl));
    if (!pack._rp) pack._rp = new Int16Array(b64ToBuf(pack.rpar));
    var nB = d.bones.n;
    // 팩 번호 -> 모델 뼈 번호 (막힌 별칭 제외), 그리고 그 역
    var p2m = new Int32Array(pack.names.length).fill(-1);
    var m2p = new Int32Array(nB).fill(-1);
    pack.names.forEach(function (nm, i) {
      var bi = byName[nm];
      if (bi === undefined) {
        bi = alias[nm];
        if (bi !== undefined && !aliasOK(pack, i, bi)) bi = undefined;
      }
      if (bi !== undefined && bi >= 0) {
        p2m[i] = bi;
        if (m2p[bi] < 0) m2p[bi] = i;
      }
    });
    var par = new Int16Array(b64ToBuf(d.bones.parent));
    var bl = new Float32Array(b64ToBuf(d.bones.loc));
    var br = new Float32Array(b64ToBuf(d.bones.rot));
    var bs = new Float32Array(b64ToBuf(d.bones.scl));
    var Lf = new Float32Array(16), Mf = new Float32Array(16),
        Nf = new Float32Array(16), Tf = new Float32Array(16);
    var one = new Float32Array([1, 1, 1]);
    var fold = null;
    for (var bb = 0; bb < nB; bb++) {
      var pi = m2p[bb];
      if (pi < 0) continue;
      // 모델 쪽: 팩이 모르는 조상들 (≤2)
      var mchain = [], u = par[bb];
      while (u >= 0 && m2p[u] < 0 && mchain.length < 3) {
        mchain.push(u);
        u = par[u];
      }
      if (u < 0 || m2p[u] < 0 || mchain.length > 2) continue;
      // 팩 쪽: 같은 조상까지의 삽입 뼈들 (≤2)
      var anc = u, pchain = [], q = pack._rp[pi], steps = 0;
      while (q >= 0 && p2m[q] !== anc && steps < 3) {
        pchain.push(q);
        q = pack._rp[q];
        steps++;
      }
      if (q < 0 || p2m[q] !== anc || pchain.length > 2) continue;
      if (!mchain.length && !pchain.length) continue;
      // Mf = 모델 삽입 bind 곱, Nf = 팩 삽입 쉬는자리 곱
      var first = true;
      for (var ci = 0; ci < mchain.length; ci++) {
        var ub = mchain[ci];
        rTRS(bl.subarray(ub*3, ub*3+3), br.subarray(ub*4, ub*4+4),
             bs.subarray(ub*3, ub*3+3), Lf);
        if (first) { Mf.set(Lf); first = false; }
        else { rMul(Mf, Lf, Tf); Mf.set(Tf); }
      }
      if (first) mIdent(Mf);
      first = true;
      for (var cj = 0; cj < pchain.length; cj++) {
        var pb = pchain[cj];
        rTRS(pack._rl.subarray(pb*3, pb*3+3),
             pack._rr.subarray(pb*4, pb*4+4),
             pack._rs ? pack._rs.subarray(pb*3, pb*3+3) : one, Lf);
        if (first) { Nf.set(Lf); first = false; }
        else { rMul(Nf, Lf, Tf); Nf.set(Tf); }
      }
      if (first) mIdent(Nf);
      rInvAffine(Mf, Tf);                // Tf = inv(모델 삽입)
      var F = new Float32Array(16);
      rMul(Nf, Tf, F);                   // F = 팩 삽입 · inv(모델 삽입)
      // 사실상 단위행렬이면 담지 않는다
      var big = 0;
      for (var k = 0; k < 16; k++) {
        var ref = (k % 5 === 0 && k < 15) ? 1 : 0;
        if (Math.abs(F[k] - ref) > 0.02) { big = 1; break; }
      }
      if (big) {
        if (!fold) fold = {};
        fold[bb] = F;
      }
    }
    return fold;
  }
  m.fold = foldFor(window.HERO_ANIMS
                   ? window.HERO_ANIMS[d.anim_key] : null);
}

function mIdent(o) {
  o.fill(0);
  o[0] = o[5] = o[10] = o[15] = 1;
}

function buildModel(d) {
  var pos = new Float32Array(b64ToBuf(d.pos));
  var nrm = new Float32Array(b64ToBuf(d.nrm));
  var uv  = new Float32Array(b64ToBuf(d.uv));
  var idx = new Uint32Array(b64ToBuf(d.idx));
  var bIdx = d.skin ? new Uint16Array(b64ToBuf(d.skin.idx)) : null;
  var bW   = d.skin ? new Uint8Array(b64ToBuf(d.skin.w)) : null;

  var vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  function attrF(loc, arr, n) {
    var b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, n, gl.FLOAT, false, 0, 0);
  }
  attrF(0, pos, 3); attrF(1, nrm, 3); attrF(2, uv, 2);
  // 정점 알파. 없는 모델이 대부분이라 그때는 상수 1.0 을 물린다.
  if (d.va) {
    var b5 = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b5);
    gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(b64ToBuf(d.va)),
                  gl.STATIC_DRAW);
    gl.enableVertexAttribArray(5);
    gl.vertexAttribPointer(5, 1, gl.UNSIGNED_BYTE, true, 0, 0);
  } else {
    gl.disableVertexAttribArray(5);
    gl.vertexAttrib1f(5, 1.0);
  }
  if (bIdx) {
    var b3 = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b3);
    gl.bufferData(gl.ARRAY_BUFFER, bIdx, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 4, gl.UNSIGNED_SHORT, false, 0, 0);
    var b4 = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b4);
    gl.bufferData(gl.ARRAY_BUFFER, bW, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 4, gl.UNSIGNED_BYTE, true, 0, 0);
  }
  var eb = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, eb);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
  gl.bindVertexArray(null);

  var m = { d: d, vao: vao, groups: d.groups,
            // 이펙트는 공용 텍스처 목록(_pool)의 GL 텍스처를 나눠 쓴다
            texs: d._pool || (d.textures || []).map(makeTexture),
            anims: [], faces: [], sk: null,
            // 카메라 맞춤용으로 정점·가중치를 CPU 쪽에도 들고 있는다
            _pos: pos, _bi: bIdx, _bw: bW, _idx: idx };
  m.sk = buildSkeleton(d);
  attachAnims(m);
  tuneRootLocks(m);
  return m;
}

/* 지금 뼈 자세(S.mW)로 정점 표본을 스키닝해 실제 점 구름을 얻는다.
   bind 자세 상자는 촉수를 뻗은 채라 몸보다 크게 부풀 수 있다 —
   아바투르는 6.5칸짜리 상자에 2.5칸짜리 몸이라 콩알만 하게 나왔다. */
function posedSamples(m) {
  var S = m.sk;
  if (!S || !m._pos || !m._bi) return null;
  var P = m._pos, BI = m._bi, BW = m._bw;
  var n = S.n, Dm = new Float32Array(n * 16), t = new Float32Array(16);
  for (var b = 0; b < n; b++) {
    rMul(S.invBind.subarray(b*16, b*16+16), S.mW.subarray(b*16, b*16+16), t);
    Dm.set(t, b * 16);
  }
  // 화면에 그려지는 조각의 정점만 센다 — 숨겨 둔 효과 판때기(빛기둥·궤적)가
  // 표본에 끼면 카메라가 엉뚱하게 멀어진다 (아콘이 콩알로 보였다).
  if (m._hv === undefined) {
    m._hv = null;
    var gs = m.groups || [];
    if (m._idx && gs.length > 1 && gs.some(function (g) { return g.fx; })) {
      var mask = new Uint8Array(P.length / 3);
      for (var gi = 0; gi < gs.length; gi++) {
        if (gs[gi].fx) continue;
        var s0 = gs[gi].start, s1 = s0 + gs[gi].count;
        for (var ii = s0; ii < s1; ii++) mask[m._idx[ii]] = 1;
      }
      m._hv = mask;
    }
  }
  var HV = m._hv;
  var xs = [], ys = [], zs = [];
  var nv = P.length / 3, step = Math.max(1, Math.floor(nv / 3000));
  for (var v = 0; v < nv; v += step) {
    if (HV && !HV[v]) continue;
    var x = P[v*3], y = P[v*3+1], z = P[v*3+2];
    var ox = 0, oy = 0, oz = 0, tw = 0;
    for (var k = 0; k < 4; k++) {
      var w = BW[v*4+k] / 255;
      if (!w) continue;
      var o = BI[v*4+k] * 16;
      ox += w * (x*Dm[o]   + y*Dm[o+4] + z*Dm[o+8]  + Dm[o+12]);
      oy += w * (x*Dm[o+1] + y*Dm[o+5] + z*Dm[o+9]  + Dm[o+13]);
      oz += w * (x*Dm[o+2] + y*Dm[o+6] + z*Dm[o+10] + Dm[o+14]);
      tw += w;
    }
    if (!tw) { ox = x; oy = y; oz = z; }
    // 땅밑 깊이 «주차»된 소품은 뺀다 — 잠옷투르의 Box 소품들은 기본
    // 자세에서 z −21.8 에 숨겨져 있어 표본의 9%를 차지, 카메라와
    // 이펙트 축소 기준을 통째로 오염시켰다
    if (oz < -1.5) continue;
    xs.push(ox); ys.push(oy); zs.push(oz);
  }
  return xs.length ? { xs: xs, ys: ys, zs: zs } : null;
}

function posedBounds(m) {         // 검증·이펙트 축척용 대략 상자
  var s = posedSamples(m);
  if (!s) return null;
  function num(a, b) { return a - b; }
  var xs = s.xs.slice().sort(num), ys = s.ys.slice().sort(num),
      zs = s.zs.slice().sort(num);
  function q(a, f) { return a[Math.min(a.length - 1,
                                       Math.floor(a.length * f))]; }
  return [[q(xs,.03), q(ys,.03), q(zs,.03)],
          [q(xs,.97), q(ys,.97), q(zs,.97)]];
}

/* 표본점들을 지금 시선(yaw·pitch)으로 투영해, 다 보이는 최소 거리를 잰다.
   구 반지름 근사와 달리 «꼬리가 깊이 방향으로 뻗은» 모델(아바투르)이
   억울하게 멀어지지 않는다. */
function fitDistance(sm, target, yaw, pitch) {
  var asp = (cv.clientWidth / cv.clientHeight) || 1;
  var tv = Math.tan(cam.fov / 2);              // 세로 반시야
  var th = tv * asp;                           // 가로 반시야
  var cp = Math.cos(pitch), sp = Math.sin(pitch);
  var back = [cp * Math.cos(yaw), cp * Math.sin(yaw), sp];  // 눈 쪽
  var right = [-Math.sin(yaw), Math.cos(yaw), 0];
  var up = [back[1]*right[2]-back[2]*right[1],
            back[2]*right[0]-back[0]*right[2],
            back[0]*right[1]-back[1]*right[0]];
  var needs = [];
  for (var i = 0; i < sm.xs.length; i++) {
    var px = sm.xs[i]-target[0], py = sm.ys[i]-target[1],
        pz = sm.zs[i]-target[2];
    var d = px*back[0] + py*back[1] + pz*back[2];       // 눈 쪽 +
    var sx = Math.abs(px*right[0] + py*right[1] + pz*right[2]);
    var sy = Math.abs(px*up[0] + py*up[1] + pz*up[2]);
    needs.push(Math.max(sx / th + d, sy / tv + d));
  }
  needs.sort(function (a, b) { return a - b; });
  // 최악 6% 는 화면 밖을 허용하고, 그래도 몸통(60백분위)보다 1.9배 넘게
  // 멀어지진 않는다 — 아바투르처럼 꼬리가 정점의 15%인 모델은 백분위
  // 컷만으론 여전히 콩알이 된다. 보통 영웅은 둘 다 최대치와 같다.
  function q(f) {
    return needs[Math.min(needs.length - 1,
                          Math.floor(needs.length * f))] || 0.4;
  }
  var need = Math.min(q(0.96), Math.max(q(0.6), 0.4) * 1.9);
  // 발밑(바닥)과 정수리는 백분위에 잘리지 않게 못 박는다 — 지팡이 끝은
  // 잘려도 되지만 발이 잘리면 서 있는 그림이 아니다
  var zsr = sm.zs.slice().sort(function (a, b) { return a - b; });
  var zTop = zsr[Math.min(zsr.length - 1, Math.floor(zsr.length * .995))];
  [0, zTop].forEach(function (z) {
    var pz = z - target[2];
    var n = Math.abs(pz * up[2]) / tv + pz * back[2];
    if (n > need) need = n;
  });
  return Math.max(need, 0.4) * 1.25;           // 가장자리 UI 여유
}

// ------------------------------------------------------------- 상태·카메라
var cam = { yaw: -1.05, pitch: 0.18, dist: 6, target: [0,0,1.2], fov: 0.72 };
var home = null;
var opt = { spin: false };
var play = { on: true, anim: -1, t: 0, speed: 1, face: -1, ft: 0 };
var cur = null;
var curIdx = 0;                 // 지금 보는 스킨 번호 (이펙트 고르기에 쓴다)
var lastT = 0;                  // 모션이 한 바퀴 돌았는지 본다
var mrot = [0, 0, 0];           // 시야를 화면축으로 돌린 각 (도)

/* 시야 축 회전: 세계축이 아니라 «화면» 기준이다. X = 위아래 기울이기,
   Y = 좌우 돌리기, Z = 화면 자체 기울이기(롤 — 궤도 카메라로는 안 되는 축).
   회전 중심은 궤도 표적을 뷰 공간으로 옮긴 점이다. 바닥까지 같이 돈다 —
   고개를 기울이면 바닥도 기울어 보이는 게 맞다. */
function viewRotated(view) {
  if (!mrot[0] && !mrot[1] && !mrot[2]) return view;
  var p = cam.target;
  var c = [view[0]*p[0]+view[4]*p[1]+view[8]*p[2]+view[12],
           view[1]*p[0]+view[5]*p[1]+view[9]*p[2]+view[13],
           view[2]*p[0]+view[6]*p[1]+view[10]*p[2]+view[14]];
  var D = Math.PI / 180;
  var R = mMul(mRotZ(mrot[2]*D), mMul(mRotX(mrot[0]*D), mRotY(mrot[1]*D)));
  return mMul(mTrans(c[0], c[1], c[2]),
              mMul(R, mMul(mTrans(-c[0], -c[1], -c[2]), view)));
}

/* ── 스킬 이펙트: 모션이 부른다 ────────────────────────────────────────
   PAGE_FX = { anims:{모션:[{m,at,s}]}, labels:{모션:"W 눈보라"},
               models:{슬러그:모델}, tex:[공용 그림] }
   모션을 고르면 딸린 이펙트를 전부 띄운다. 스킨 전용(s)이 있으면 그것,
   없으면 기본 스킨 것. 이펙트는 영웅과 같은 시계를 쓰고, 제 길이가 끝나면
   사라졌다가 모션이 한 바퀴 돌 때 다시 난다. */
var FXP = window.PAGE_FX || null;
var fxOn = true, fxActive = [], fxCache = {}, fxPoolGL = null;

function fxPool() {
  if (!fxPoolGL) fxPoolGL = (FXP.tex || []).map(makeTexture);
  return fxPoolGL;
}
function attBoneByName(names) {
  if (!cur || !cur.d.att || !names) return -1;
  for (var i = 0; i < names.length; i++)
    for (var j = 0; j < cur.d.att.length; j++)
      if (cur.d.att[j].name === names[i]) return cur.d.att[j].bone;
  return -1;
}
function fxForAnim(name) {
  if (!FXP) return [];
  var lst = FXP.anims[name];
  if (!lst || !lst.length) return [];
  var skinNow = (PAGE.skins[curIdx] || {}).skin || "base";
  var mine = lst.filter(function (f) { return (f.s || "base") === skinNow; });
  if (!mine.length)
    mine = lst.filter(function (f) { return (f.s || "base") === "base"; });
  return mine;
}
function applyAnimFx() {
  fxActive = [];
  if (!fxOn || !FXP || !cur || play.anim < 0) return;
  var a = cur.anims[play.anim];
  if (!a) return;
  // 영웅 크기. 과대한 이펙트를 줄이는 기준 — 자세 반영 키가 제일 믿을 만.
  var hb = cur.d.focus || cur.d.bounds;
  var heroR = cur._heroR ||
    (Math.max(hb[1][0]-hb[0][0], hb[1][1]-hb[0][1],
              hb[1][2]-hb[0][2]) / 2 || 1);
  window.__heroR = { r: heroR, posed: !!cur._heroR };   // 검증용
  fxForAnim(a.name).forEach(function (f) {
    var md = FXP.models[f.m];
    if (!md) return;
    var m = fxCache[f.m];
    if (!m) {
      md._pool = fxPool();
      m = fxCache[f.m] = buildModel(md);
    }
    // 리리의 수룡(16칸)처럼 이펙트가 영웅(2칸)보다 훨씬 크면 몸을 통째로
    // 가린다. 게임에선 날아가 버리니 괜찮지만 여기선 제자리라, 영웅
    // 반지름의 1.4배를 넘는 만큼 줄여서 얹는다.
    var sc = 1, fxR = 0;
    var fb = md.bounds;
    if (fb) {
      fxR = Math.max(fb[1][0]-fb[0][0], fb[1][1]-fb[0][1],
                     fb[1][2]-fb[0][2]) / 2;
      if (fxR > heroR * 1.4) sc = heroR * 1.4 / fxR;
    }
    // «대상·장판» 이펙트는 몸을 덮지 않게 앞쪽(영웅 정면 -Y)에 내려놓는다:
    // 이름이 _target 이거나, 매달 자리 정보가 없는데 영웅보다 큰 것
    // (공생체 싸개·가시 폭발처럼 대상을 감싸는 부류가 다 이렇다)
    var fwd = (/_target$/.test(f.m) || (!f.at && fxR > heroR))
              ? heroR * 2.4 : 0;
    fxActive.push({ m: m, bone: fwd ? -1 : attBoneByName(f.at), t: 0,
                    done: false, sc: sc, fwd: fwd });
  });
}
window.__render = renderFrame;        // 일괄 촬영용: 한 프레임만 그린다
window.__fit = function () {          // 검증용: 카메라 맞춤 근거
  var dec = null;
  if (cur && cur.sk && cur._pos) {    // 자세 반영 X 십분위 — 밖 덩어리 추적
    var S = cur.sk, P = cur._pos, BI = cur._bi, BW = cur._bw;
    var n = S.n, Dm = new Float32Array(n*16), t = new Float32Array(16);
    for (var b = 0; b < n; b++) {
      rMul(S.invBind.subarray(b*16,b*16+16), S.mW.subarray(b*16,b*16+16), t);
      Dm.set(t, b*16);
    }
    var xs = [], nv = P.length/3, step = Math.max(1, Math.floor(nv/4000));
    for (var v = 0; v < nv; v += step) {
      var x=P[v*3], y=P[v*3+1], z=P[v*3+2], ox=0, tw=0;
      for (var k = 0; k < 4; k++) {
        var w = BW[v*4+k]/255; if (!w) continue;
        var o = BI[v*4+k]*16;
        ox += w*(x*Dm[o]+y*Dm[o+4]+z*Dm[o+8]+Dm[o+12]); tw += w;
      }
      xs.push(tw ? ox : x);
    }
    xs.sort(function(a,b){return a-b;});
    dec = [];
    for (var q = 0; q <= 10; q++)
      dec.push(Math.round(xs[Math.min(xs.length-1,
        Math.floor(xs.length*q/10))]*100)/100);
  }
  return { bounds: cur && cur.d.bounds, focus: cur && cur.d.focus,
           posed: cur && posedBounds(cur), xdec: dec,
           target: cam.target, dist: cam.dist,
           anims: cur ? cur.anims.length : 0 };
};
window.__bone = function (re) {   // 검증용: 자세 반영된 뼈 자리
  if (!cur || !cur.sk || !cur.d.bones) return null;
  var S = cur.sk, rx = new RegExp(re, "i"), out = [];
  (cur.d.bones.names || []).forEach(function (n, i) {
    if (!rx.test(n)) return;
    var o = i * 16, W = S.mW;
    out.push([n, Math.round(W[o+12]*100)/100, Math.round(W[o+13]*100)/100,
              Math.round(W[o+14]*100)/100]);
  });
  return out;
};
window.__fx = function () {           // 검증용: 지금 떠 있는 이펙트 수
  return fxActive.filter(function (f) { return !f.done; }).length;
};
window.__fxinfo = function () {       // 검증용: 축소 배율까지
  return fxActive.map(function (f) {
    return { done: f.done, sc: Math.round(f.sc * 100) / 100, bone: f.bone,
             fwd: Math.round((f.fwd || 0) * 10) / 10 };
  });
};

/* 세로 화면에서는 가로 시야각이 좁다. 세로 시야각만 보고 거리를 정하면
   폭이 넓은 모델이 좌우로 잘리므로, 좁은 쪽 시야각으로 거리를 잡는다. */
function frameDist(r) {
  var asp = (cv.clientWidth / cv.clientHeight) || 1;
  var half = Math.min(cam.fov / 2, Math.atan(Math.tan(cam.fov / 2) * asp));
  return r / Math.tan(half) * 1.9;
}

/* 기본으로 틀 동작: 정확한 Stand, 없으면 Stand 계열 중 이름이 짧은 것.
   (전용 팩 우선은 해 봤다가 뺐다 — 잠옷투르의 «Stand Cover» 는 몸
   절반이 지하로 꺼지는 특수 자세라 첫 화면이 엉망이 된다.) */
function defaultAnim(m) {
  var best = -1;
  for (var i = 0; i < m.anims.length; i++) {
    var nm = m.anims[i].name;
    if (nm === "Stand") return i;
    if (nm.indexOf("Stand") === 0 &&
        (best < 0 || nm.length < m.anims[best].name.length)) best = i;
  }
  return best >= 0 ? best : (m.anims.length ? 0 : -1);
}

function frameModel(m) {
  cam.yaw = -1.05; cam.pitch = 0.18;
  var box = m.d.focus || m.d.bounds;
  var sm = null;
  // 기본 동작의 첫 프레임으로 자세를 잡고 실제 점 구름을 잰다
  if (m.sk && m.anims.length) {
    var di = defaultAnim(m);
    updateBones(m, di < 0 ? 0 : di, 0, -1, 0);
    sm = posedSamples(m);
  }
  if (sm) {
    function num(a, b) { return a - b; }
    var xs = sm.xs.slice().sort(num), ys = sm.ys.slice().sort(num),
        zs = sm.zs.slice().sort(num);
    function q(a, f) { return a[Math.min(a.length - 1,
                                         Math.floor(a.length * f))]; }
    // 표적은 중앙값 — 꼬리 같은 극단이 몸을 밀어내지 못한다
    cam.target = [q(xs, .5), q(ys, .5), (q(zs, .06) + q(zs, .94)) / 2];
    cam.dist = fitDistance(sm, cam.target, cam.yaw, cam.pitch);
    // 이펙트 축소 기준: 키(z 높이)가 제일 안정적이다 — 가로 상자는 꼬리·
    // 담요가 늘려 놓아 이펙트가 안 줄어드는 수가 있다
    m._heroR = Math.max((q(zs, .95) - q(zs, .05)) / 2, 0.5);
  } else {
    var lo = box[0], hi = box[1];
    cam.target = [(lo[0]+hi[0])/2, (lo[1]+hi[1])/2, (lo[2]+hi[2])/2];
    cam.dist = frameDist(
      Math.max(hi[0]-lo[0], hi[1]-lo[1], hi[2]-lo[2]) / 2 || 1);
  }
  home = { yaw: cam.yaw, pitch: cam.pitch, dist: cam.dist,
           target: cam.target.slice(), sm: sm };
}

/* 화면을 돌리거나 크기가 바뀌면, 사용자가 확대를 안 건드렸을 때만
   기본 거리를 새 화면비에 맞춰 다시 잡는다. */
window.addEventListener("resize", function () {
  if (!home) return;
  var nd = home.sm
    ? fitDistance(home.sm, home.target, home.yaw, home.pitch)
    : home.dist;
  if (Math.abs(cam.dist - home.dist) < home.dist * 0.01) cam.dist = nd;
  home.dist = nd;
});

function resize() {
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
  if (w && h && (cv.width !== w || cv.height !== h)) { cv.width = w; cv.height = h; }
}

var BLEND = {
  1: function () { gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA); },
  2: function () { gl.blendFunc(gl.SRC_ALPHA, gl.ONE); },
  3: function () { gl.blendFunc(gl.SRC_ALPHA, gl.ONE); },
  4: function () { gl.blendFunc(gl.DST_COLOR, gl.ZERO); },
  5: function () { gl.blendFunc(gl.DST_COLOR, gl.SRC_COLOR); }
};

var timeEl = document.getElementById("tl");
var last = performance.now();
function draw() { requestAnimationFrame(draw); renderFrame(); }
/* 그리기를 함수로 떼어 둔 이유: 스크린샷은 «한 프레임 그리고 같은 태스크
   안에서 바로» 뽑아야 한다. WebGL 은 프레임이 끝나면 버퍼를 비워서,
   아무 때나 toBlob 을 부르면 검은 그림이 나온다. */
function renderFrame() {
  var now = performance.now(), dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (opt.spin) cam.yaw += dt * 0.5;
  resize();
  gl.viewport(0, 0, cv.width, cv.height);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  if (!cur) return;

  var A = (play.anim >= 0 && cur.anims[play.anim]) ? cur.anims[play.anim] : null;
  if (A && play.on) {
    play.t += dt * 1000 * play.speed;
    if (play.t > A.dur) play.t %= A.dur;
    if (timeEl && document.activeElement !== timeEl)
      timeEl.value = String(Math.round(play.t / A.dur * 1000));
  }
  var F = (play.face >= 0 && cur.faces[play.face]) ? cur.faces[play.face] : null;
  if (F && play.on) {
    play.ft += dt * 1000 * play.speed;
    if (play.ft > F.dur) play.ft %= F.dur;
  }
  if (cur.sk) updateBones(cur, play.anim, play.t, play.face, play.ft);

  // 이펙트 시계: 모션이 처음으로 돌아가면(play.t 가 줄면) 다시 태어난다.
  // 제 길이를 넘기면 사라진 채로 있는다 (잔상 방지).
  if (fxActive.length) {
    var back = play.t < lastT;
    for (var fi = 0; fi < fxActive.length; fi++) {
      var FE = fxActive[fi];
      if (back) { FE.t = 0; FE.done = false; }
      else if (play.on) FE.t += dt * 1000 * play.speed;
      var FA = FE.m.anims[0];
      if (FA && FE.t >= FA.dur) { FE.t = FA.dur; FE.done = true; }
      if (!FE.done && FE.m.sk)
        updateBones(FE.m, FE.m.anims.length ? 0 : -1, FE.t, -1, 0);
    }
  }
  lastT = play.t;

  var cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  var eye = [
    cam.target[0] + cam.dist * cp * Math.cos(cam.yaw),
    cam.target[1] + cam.dist * cp * Math.sin(cam.yaw),
    cam.target[2] + cam.dist * sp
  ];
  var view = viewRotated(mLookAt(eye, cam.target, [0,0,1]));
  var proj = mPersp(cam.fov, (cv.width / cv.height) || 1,
                    cam.dist * 0.01 + 0.01, cam.dist * 20 + 100);
  var mvp = mMul(proj, view);

  // 바닥
  gl.useProgram(gprog);
  gl.uniformMatrix4fv(GU.uMVP, false, mvp);
  gl.uniform3f(GU.uCol, 0.30, 0.38, 0.50);
  gl.uniform1f(GU.uA, 0.30);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false);
  gl.bindVertexArray(gridVao);
  gl.drawArrays(gl.LINES, 0, gridN);
  gl.depthMask(true);
  gl.disable(gl.BLEND);

  gl.useProgram(prog);
  gl.uniform3fv(U.uEye, new Float32Array(eye));
  gl.uniform1i(U.uTex, 0);
  gl.uniform1i(U.uEmis, 1);
  gl.uniform1i(U.uBones, 2);
  gl.uniform3f(U.uSolid, 0.72, 0.74, 0.78);
  drawOne(cur, mvp, true);
  // 이펙트는 영웅 위에 겹쳐 그린다. 매다는 뼈가 있으면 그 뼈의 «지금 자세»
  // 행렬을 앞에 곱해 손·무기를 따라간다.
  for (var k2 = 0; k2 < fxActive.length; k2++) {
    var F3 = fxActive[k2];
    if (F3.done) continue;
    var M2 = mvp;
    if (F3.fwd) M2 = mMul(mvp, mTrans(0, -F3.fwd, 0));
    else if (cur.sk && F3.bone >= 0 && F3.bone < cur.sk.n)
      M2 = mMul(mvp, cur.sk.mW.subarray(F3.bone*16, F3.bone*16+16));
    if (F3.sc && F3.sc < 1) M2 = mMul(M2, mScale(F3.sc));
    var FD = F3.m.anims[0];
    var fade = 1;
    if (FD && FD.dur > 1) {
      var pp = F3.t / FD.dur;
      fade = pp < 0.12 ? pp / 0.12 : (pp > 0.7 ? Math.max(0, (1 - pp) / 0.3)
                                               : 1);
    }
    drawOne(F3.m, M2, false, fade, F3.t);
  }
}

/* 재질 알파 커브 [t0,a0,t1,a1,…] 를 t(ms) 에서 표본한다 */
function sampleFd(fd, t) {
  var n = fd.length;
  if (t <= fd[0]) return fd[1];
  if (t >= fd[n-2]) return fd[n-1];
  for (var i = 0; i + 3 < n; i += 2) {
    if (t <= fd[i+2]) {
      var f = (t - fd[i]) / (fd[i+2] - fd[i] || 1);
      return fd[i+1] + (fd[i+3] - fd[i+1]) * f;
    }
  }
  return fd[n-1];
}

function drawOne(m, mvpM, isHero, fade, tMs) {
  var baseFade = fade === undefined ? 1 : fade;
  gl.uniformMatrix4fv(U.uMVP, false, mvpM);
  gl.uniform1i(U.uSkin, m.sk ? 1 : 0);
  if (m.sk) { gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, m.sk.tex); }
  gl.bindVertexArray(m.vao);
  var groups = m.groups;
  for (var pass = 0; pass < 2; pass++) {
    for (var i = 0; i < groups.length; i++) {
      var g = groups[i];
      // 영웅 몸에 든 효과 판때기는 숨긴다. 이펙트 모델은 그게 본체라 다
      // 그리되, 그릴 색이 아예 없는 조각(디퓨즈·발광 다 없음)은 뺀다.
      if (isHero && g.fx) continue;
      if (!isHero && g.tex < 0 && g.emis < 0) continue;
      // 재질 알파 커브: 있으면 그 곡선대로 (원작자가 짠 등장·소멸)
      var gFade = (g.fd && tMs !== undefined) ? sampleFd(g.fd, tMs) : baseFade;
      if (!isHero && gFade <= 0.02) continue;      // 곡선상 꺼진 조각
      // 커브 낀 불투명 조각도 섞기 통로로 — 검게 저무는 대신 투명해진다
      var isBlend = g.blend !== 0 || (!isHero && !!g.fd);
      if ((pass === 0) === isBlend) continue;
      if (isBlend) {
        gl.enable(gl.BLEND);
        (BLEND[g.blend] || BLEND[1])();
        gl.depthMask(false);
        gl.disable(gl.CULL_FACE);
      } else {
        gl.disable(gl.BLEND);
        gl.depthMask(true);
        if (g.cutout > 0) gl.disable(gl.CULL_FACE);
        else gl.enable(gl.CULL_FACE);
      }
      var hasT = g.tex >= 0 && m.texs[g.tex];
      gl.uniform1i(U.uHasTex, hasT ? 1 : 0);
      if (hasT) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, m.texs[g.tex]); }
      var hasE = g.emis >= 0 && m.texs[g.emis];
      gl.uniform1i(U.uHasEmis, hasE ? 1 : 0);
      if (hasE) { gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, m.texs[g.emis]); }
      gl.uniform1i(U.uUnshaded, g.unshaded ? 1 : 0);
      gl.uniform1f(U.uCutout, g.cutout > 0 ? g.cutout / 255 : 0);
      // 넓게 덮는 발광은 세기를 낮춰 굽는다 (없으면 1.0)
      gl.uniform1f(U.uEmisGain, g.egain === undefined ? 1 : g.egain);
      // 옮길 수 없는 램프 대신 평균색을 쓰는 조각 (리밍 아콘의 몸)
      if (g.solid) gl.uniform3f(U.uSolid, g.solid[0], g.solid[1], g.solid[2]);
      else gl.uniform3f(U.uSolid, 0.72, 0.74, 0.78);
      // 조각 색조 (제라툴 검 초록 등)
      if (g.tint) gl.uniform3f(U.uTint, g.tint[0], g.tint[1], g.tint[2]);
      else gl.uniform3f(U.uTint, 1, 1, 1);
      gl.uniform1f(U.uFade, gFade);
      // 불꽃·에너지(더하기) 조각은 결을 흘려보낸다 — 게임의 UV 흐름 근사
      gl.uniform1f(U.uScroll,
        (!isHero && tMs && (g.blend === 2 || g.blend === 3))
          ? tMs / 1000 * 0.35 : 0);
      gl.drawElements(gl.TRIANGLES, g.count, gl.UNSIGNED_INT, g.start * 4);
    }
  }
  gl.disable(gl.BLEND);
  gl.depthMask(true);
  gl.enable(gl.CULL_FACE);
  gl.bindVertexArray(null);
}
requestAnimationFrame(draw);

// ------------------------------------------------------------- 조작
// 포인터를 손가락별로 들고 있는다. 한 손가락 = 돌리기, 두 손가락 = 오므려
// 확대 + 가운데점 끌어 이동. 마우스 오른쪽 끌기·Shift 끌기도 이동.
var ptrs = new Map();
function panBy(dx, dy) {
  var cp = Math.cos(cam.pitch);
  var fwd = [cp*Math.cos(cam.yaw), cp*Math.sin(cam.yaw), Math.sin(cam.pitch)];
  var right = vNorm(vCross([0,0,1], fwd));
  var up = vCross(fwd, right);
  var k = cam.dist * 0.0016;
  for (var i = 0; i < 3; i++)
    cam.target[i] += right[i] * dx * k + up[i] * dy * k;
}
cv.addEventListener("contextmenu", function (e) { e.preventDefault(); });
cv.addEventListener("pointerdown", function (e) {
  cv.setPointerCapture(e.pointerId);
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, btn: e.button });
  opt.spin = false; syncBtns();
});
cv.addEventListener("pointermove", function (e) {
  var p = ptrs.get(e.pointerId);
  if (!p) return;
  if (ptrs.size === 2) {
    var other = null;
    ptrs.forEach(function (v, k) { if (k !== e.pointerId) other = v; });
    var od = Math.hypot(p.x - other.x, p.y - other.y);
    var nd = Math.hypot(e.clientX - other.x, e.clientY - other.y);
    if (od > 10 && nd > 10) {
      cam.dist = Math.max(0.15, Math.min(300, cam.dist * od / nd));
    }
    panBy((e.clientX + other.x)/2 - (p.x + other.x)/2,
          (e.clientY + other.y)/2 - (p.y + other.y)/2);
  } else {
    var dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (p.btn === 2 || e.shiftKey) panBy(dx, dy);
    else {
      cam.yaw -= dx * 0.008;
      cam.pitch = Math.max(-1.45, Math.min(1.45, cam.pitch + dy * 0.008));
    }
  }
  p.x = e.clientX; p.y = e.clientY;
});
["pointerup", "pointercancel"].forEach(function (ev) {
  window.addEventListener(ev, function (e) { ptrs.delete(e.pointerId); });
});
cv.addEventListener("wheel", function (e) {
  e.preventDefault();
  cam.dist *= Math.exp(Math.sign(e.deltaY) * 0.12);
  cam.dist = Math.max(0.15, Math.min(300, cam.dist));
}, { passive: false });

// ------------------------------------------------------------- UI
var skinsEl = document.getElementById("skins");
var animListEl = document.getElementById("animList");
var animFindEl = document.getElementById("animFind");
var faceEl = document.getElementById("faceSel");
var playEl = document.getElementById("bPlay");
var spinEl = document.getElementById("bSpin");
var homeEl = document.getElementById("bHome");

function syncBtns() {
  playEl.textContent = play.on ? "⏸" : "▶";
  spinEl.classList.toggle("on", opt.spin);
}

/* 동작을 갈래별로 묶어 왼쪽 패널에 늘어놓는다. 50개짜리 드롭다운은 못 쓴다. */
function catOf(name) {
  var n = name.toLowerCase();
  if (n.indexOf("ride") >= 0) return "탈것";
  if (n.indexOf("spell") === 0) return "스킬";
  if (n.indexOf("attack") === 0) return "공격";
  if (n.indexOf("walk") === 0 || n.indexOf("run") === 0) return "이동";
  if (n.indexOf("stand") === 0 || n.indexOf("fidget") === 0)
    return "서기 · 잔동작";
  return "기타";
}
var CATORDER = ["스킬", "공격", "이동", "서기 · 잔동작", "탈것", "기타"];
var curAnimName = null;

function markAnim() {
  [].forEach.call(animListEl.querySelectorAll(".arow"), function (el) {
    el.classList.toggle("on", parseInt(el.dataset.i, 10) === play.anim);
  });
}

function selectAnim(i) {
  play.anim = i; play.t = 0;
  curAnimName = (i >= 0 && cur && cur.anims[i]) ? cur.anims[i].name : null;
  applyAnimFx();
  markAnim();
}

/* 웹판은 동작이 넷뿐이라 이름을 아이콘 + 한글로 바꿔 준다 (PAGE.animKo).
   낱개판은 동작이 수십 개라 원래 이름 그대로가 낫다. */
var ANIM_KO = [[/^stand dance/i, "\uD83D\uDC83 춤"],
               [/^taunt/i, "\uD83D\uDC4B 도발"],
               [/^walk/i, "\uD83D\uDEB6 걷기"],
               [/^stand/i, "\uD83E\uDDCD 대기"],
               [/^기본 자세$/, "\u2299 기본 자세"]];
function animLabel(name) {
  if (!(window.PAGE && PAGE.animKo)) return name;
  for (var i = 0; i < ANIM_KO.length; i++)
    if (ANIM_KO[i][0].test(name)) return ANIM_KO[i][1];
  return name;
}

function animRow(i, label, dur, fxn) {
  var e = document.createElement("div");
  e.className = "arow";
  e.dataset.i = String(i);
  var nm = document.createElement("span");
  nm.textContent = animLabel(label);
  e.appendChild(nm);
  if (fxn) {
    var fx = document.createElement("span");
    fx.className = "fxn"; fx.textContent = "✦" + fxn;
    e.appendChild(fx);
  }
  if (dur) {
    var d = document.createElement("span");
    d.className = "dur"; d.textContent = dur;
    e.appendChild(d);
  }
  e.onclick = function () { selectAnim(i); };
  animListEl.appendChild(e);
  return e;
}

function fillAnims(m) {
  var keepName = curAnimName;
  animListEl.innerHTML = "";
  animRow(-1, "기본 자세", null, 0);
  var by = {};
  m.anims.forEach(function (a, i) {
    var c = catOf(a.name);
    (by[c] = by[c] || []).push(i);
  });
  CATORDER.forEach(function (cat) {
    var idxs = by[cat];
    if (!idxs) return;
    var h = document.createElement("div");
    h.className = "ahead"; h.textContent = cat;
    animListEl.appendChild(h);
    idxs.forEach(function (i) {
      var a = m.anims[i];
      var lab = FXP && FXP.labels && FXP.labels[a.name];
      var n = FXP ? fxForAnim(a.name).length : 0;
      animRow(i, a.name + (lab ? " — " + lab : ""),
              (a.dur / 1000).toFixed(1) + "초", n);
    });
  });
  var idx = defaultAnim(m);
  if (keepName)
    for (var i = 0; i < m.anims.length; i++)
      if (m.anims[i].name === keepName) { idx = i; break; }
  play.anim = idx; play.t = 0;
  curAnimName = (idx >= 0) ? m.anims[idx].name : null;
  markAnim();
  applyFind();

  var keepFace = faceEl.options[faceEl.selectedIndex];
  var keepFN = keepFace ? keepFace.textContent : null;
  faceEl.innerHTML = "";
  var f0 = document.createElement("option");
  f0.value = "-1"; f0.textContent = "표정 없음";
  faceEl.appendChild(f0);
  m.faces.forEach(function (a, i) {
    var e = document.createElement("option");
    e.value = String(i); e.textContent = a.name;
    faceEl.appendChild(e);
  });
  var fi = -1;
  if (keepFN)
    for (var j = 0; j < m.faces.length; j++)
      if (m.faces[j].name === keepFN) { fi = j; break; }
  play.face = fi; play.ft = 0;
  faceEl.value = String(fi);
  faceEl.style.display = m.faces.length ? "" : "none";
}

/* 동작 찾기: 이름·스킬 이름으로 줄을 거르고, 빈 갈래 머리글은 감춘다 */
function applyFind() {
  var q = (animFindEl.value || "").trim().toLowerCase();
  var lastHead = null;
  [].forEach.call(animListEl.children, function (el) {
    if (el.className === "ahead") {
      if (lastHead) lastHead.style.display = lastHead._any ? "" : "none";
      el._any = false; lastHead = el;
      return;
    }
    var ok = !q || el.textContent.toLowerCase().indexOf(q) >= 0;
    el.style.display = ok ? "" : "none";
    if (ok && lastHead) lastHead._any = true;
  });
  if (lastHead) lastHead.style.display = lastHead._any ? "" : "none";
}

function markSkin(i) {
  [].forEach.call(skinsEl.children, function (el, j) {
    el.classList.toggle("on", j === i);
  });
}

/* ── 색배합(변형 팔레트) ──────────────────────────────────────────────
   게임의 색배합은 같은 모델에 텍스처만 갈아끼우는 것이라, 여기서도
   HERO_VARS[슬러그] = [{label, texs:[[칸,그림]…]}…] 를 그대로 바꿔 끼운다. */
var varsEl = document.getElementById("vars");
var varTexCache = {};
function fillVars(m) {
  varsEl.innerHTML = "";
  var lst = (window.HERO_VARS || {})[m.d.slug] || [];
  if (!lst.length) { varsEl.style.display = "none"; return; }
  varsEl.style.display = "";
  function chip(label, on, fn) {
    var b = document.createElement("button");
    b.textContent = label;
    if (on) b.className = "on";
    b.onclick = function () {
      [].forEach.call(varsEl.children, function (x) {
        x.classList.remove("on");
      });
      b.classList.add("on");
      fn();
    };
    varsEl.appendChild(b);
  }
  if (!m._origTex) m._origTex = m.texs.slice();
  chip("기본색", true, function () { m.texs = m._origTex.slice(); });
  lst.forEach(function (v, vi) {
    chip(v.label || ("배합 " + (vi + 1)), false, function () {
      m.texs = m._origTex.slice();
      v.texs.forEach(function (pair) {
        // 칸은 이름으로 다시 찾는다 — 모델을 다시 구우면 번호가 밀린다
        var k = pair[0], src = pair[2], ts = m.d.tex_src;
        if (src && ts) { var j = ts.indexOf(src); if (j >= 0) k = j; }
        var key = m.d.slug + "|" + vi + "|" + k;
        if (!varTexCache[key]) varTexCache[key] = makeTexture(pair[1]);
        if (k < m.texs.length) m.texs[k] = varTexCache[key];
      });
    });
  });
}

/* 웹판(PAGE.web 이 있을 때): 자료를 페이지에 안 박고 필요할 때 받아온다.
   낱개 파일(file://)은 예전처럼 통째로 들고 있어 이 길로 안 온다. */
var _got = {};
function need(src, cb) {
  if (_got[src]) return cb();
  var el = document.createElement("script");
  el.src = src;
  el.onload = function () { _got[src] = 1; cb(); };
  el.onerror = function () { cb("못 받음: " + src); };
  document.head.appendChild(el);
}
function show(i) {
  var s = PAGE.skins[i];
  if (!s || !PAGE.web) return showNow(i);
  var q = [];
  if (!(window.HERO_DATA || {})[s.slug])
    q.push(PAGE.web + "models/" + s.slug + ".js");
  [s.akey, s.fkey, PAGE.baseAnim].forEach(function (k) {
    if (k && !(window.HERO_ANIMS || {})[k])
      q.push(PAGE.web + "anims/" + k + ".js");
  });
  if (PAGE.varsKey && !window.HERO_VARS)
    q.push(PAGE.web + "variations/" + PAGE.varsKey + ".js");
  q = q.filter(function (v, k) { return q.indexOf(v) === k; });
  msg.textContent = "받는 중…";
  msg.style.display = "flex";
  (function next(k) {
    if (k >= q.length) return showNow(i);
    need(q[k], function (err) {
      // 색배합·표정은 없을 수도 있다 — 없으면 그냥 넘어간다
      if (err && /models\//.test(q[k])) {
        msg.textContent = err;
        return;
      }
      next(k + 1);
    });
  })(0);
}

function showNow(i) {
  var s = PAGE.skins[i];
  if (!s) return;
  if (s.href) { location.href = s.href; return; }   // 딴 파일 (쪼갠 영웅)
  var d = (window.HERO_DATA || {})[s.slug];
  if (!d) { msg.textContent = "자료 없음: " + s.slug; return; }
  curIdx = i;
  // 실패를 삼키면 단추가 «안 눌리는» 것처럼 보인다 — 무엇이 잘못됐는지
  // 화면에 말한다 (폰에서 조용히 죽는 경우 대비)
  try {
    cur = buildModel(d);
  } catch (err) {
    msg.textContent = "스킨 전환 실패: " + (err && err.message || err);
    msg.style.display = "flex";
    return;
  }
  frameModel(cur);
  fillAnims(cur);
  fillVars(cur);
  markSkin(i);
  applyAnimFx();
  msg.style.display = "none";
  document.getElementById("st").textContent =
    d.nverts.toLocaleString() + " 정점 · " + d.ntris.toLocaleString() +
    " 삼각형" + (d.bones ? " · " + d.bones.n + " 뼈" : "") +
    (cur.anims.length ? " · " + cur.anims.length + " 동작" : "");
}

(function initUI() {
  document.getElementById("t").textContent = PAGE.title || "";
  document.getElementById("s").textContent = PAGE.sub || "";
  // 스킨은 드롭다운이 아니라 큼직한 단추 줄로 — 안 보여서 못 쓰면 없는 것과
  // 같다. 쪼갠 영웅의 딴 스킨(href 있음)을 누르면 그 파일로 건너간다.
  PAGE.skins.forEach(function (s, i) {
    var b = document.createElement("button");
    b.textContent = s.label;
    b.onclick = function () { show(i); };
    skinsEl.appendChild(b);
  });
  if (PAGE.skins.length < 2) skinsEl.style.display = "none";
  animFindEl.oninput = applyFind;
  var bAnims = document.getElementById("bAnims");
  bAnims.onclick = function () {       // 좁은 화면에서 동작 목록 열고 닫기
    var on = document.getElementById("anims").classList.toggle("open");
    bAnims.classList.toggle("on", on);
  };
  var fxBtn = document.getElementById("bFx");
  // 스킬 이펙트는 더 이상 안 싣는다 (단추 자체가 없는 페이지가 정상)
  if (!fxBtn) {
    /* 없음 */
  } else if (!FXP || !Object.keys(FXP.models || {}).length) {
    fxBtn.style.display = "none";
  } else {
    fxBtn.classList.toggle("on", fxOn);
    fxBtn.onclick = function () {
      fxOn = !fxOn;
      fxBtn.classList.toggle("on", fxOn);
      applyAnimFx();
    };
  }
  if (faceEl) faceEl.onchange = function () {
    play.face = parseInt(faceEl.value, 10); play.ft = 0;
  };
  playEl.onclick = function () { play.on = !play.on; syncBtns(); };
  spinEl.onclick = function () { opt.spin = !opt.spin; syncBtns(); };
  homeEl.onclick = function () {
    if (!home) return;
    cam.yaw = home.yaw; cam.pitch = home.pitch; cam.dist = home.dist;
    cam.target = home.target.slice();
  };
  // 시점 단추. 영웅 정면은 -Y 쪽이다 (허리 앞/뒤 부착점으로 확인한 규약).
  function setView(yaw, pitch) {
    if (home) { cam.dist = home.dist; cam.target = home.target.slice(); }
    cam.yaw = yaw; cam.pitch = pitch;
    opt.spin = false; syncBtns();
  }
  var views = { vFront: [-Math.PI/2, 0.12], vSide: [0, 0.12],
                vBack: [Math.PI/2, 0.12], vTop: [-Math.PI/2, 1.30] };
  Object.keys(views).forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.onclick = function () { setView(views[id][0], views[id][1]); };
  });
  // 확대·축소 단추 (터치에서 휠이 없으니 단추로도 되게)
  function zoomBy(k) {
    cam.dist = Math.max(0.15, Math.min(300, cam.dist * k));
  }
  document.getElementById("bZin").onclick = function () { zoomBy(0.82); };
  document.getElementById("bZout").onclick = function () { zoomBy(1.22); };
  // ---- 축 회전 패널 ----
  // 축 패널은 넓은 화면에선 늘 보인다. 좁은 화면에서만 이 단추로 연다.
  var axesEl = document.getElementById("axes");
  var axBtn = document.getElementById("bAxes");
  axBtn.onclick = function () {
    var on = axesEl.classList.toggle("open");
    axBtn.classList.toggle("on", on);
  };
  // 슬라이더는 너무 민감해서 뺐다. 정한 단위만큼 눌러서 끊어 돌리고,
  // 길게 누르면 자동으로 반복한다. ±180 을 넘으면 반대쪽으로 감는다.
  var tick = 15;
  var tickBtns = document.querySelectorAll("#axes .tick button");
  [].forEach.call(tickBtns, function (b) {
    b.onclick = function () {
      tick = parseFloat(b.dataset.t);
      [].forEach.call(tickBtns, function (x) {
        x.classList.toggle("on", x === b);
      });
    };
  });
  function rotLabels() {
    ["rXv", "rYv", "rZv"].forEach(function (id, i) {
      document.getElementById(id).textContent = mrot[i] + "°";
    });
  }
  function bump(axis, dir) {
    mrot[axis] = ((mrot[axis] + dir * tick + 540) % 360) - 180;
    rotLabels();
  }
  [].forEach.call(document.querySelectorAll("#axes button.ax"), function (b) {
    var a = parseInt(b.dataset.a, 10), d = parseInt(b.dataset.d, 10);
    var hold = null, rep = null;
    b.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      bump(a, d);
      hold = setTimeout(function () {
        rep = setInterval(function () { bump(a, d); }, 140);
      }, 420);
    });
    ["pointerup", "pointerleave", "pointercancel"].forEach(function (ev) {
      b.addEventListener(ev, function () {
        clearTimeout(hold); clearInterval(rep);
      });
    });
  });
  document.getElementById("rotReset").onclick = function () {
    mrot = [0, 0, 0];
    rotLabels();
  };

  var fs = document.getElementById("bFull");
  if (fs) {
    if (!document.documentElement.requestFullscreen) fs.style.display = "none";
    else fs.onclick = function () {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen();
    };
  }

  // ---- 스크린샷: 지금 보이는 시점 그대로 ----
  var toastEl = document.getElementById("toast"), toastT = null;
  function toast(t) {
    toastEl.textContent = t;
    toastEl.style.display = "block";
    clearTimeout(toastT);
    toastT = setTimeout(function () { toastEl.style.display = "none"; }, 2200);
  }
  function shotName() {
    var s = PAGE.skins[curIdx] || {};
    var a = (play.anim >= 0 && cur && cur.anims[play.anim])
            ? cur.anims[play.anim].name : "";
    return ((PAGE.title || "hero") + "_" + (s.label || "") +
            (a ? "_" + a : "")).replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, "_");
  }
  function capture(cb) {
    renderFrame();                     // 같은 태스크에서 그리고 바로 뽑는다
    cv.toBlob(cb, "image/png");
  }
  window.__capture = capture;          // 검증용
  document.getElementById("bShot").onclick = function () {
    capture(function (b) {
      if (!b) { toast("캡처 실패"); return; }
      var a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = shotName() + ".png";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
      toast("저장: " + a.download);
    });
  };
  document.getElementById("bCopy").onclick = function () {
    capture(function (b) {
      if (!b || !navigator.clipboard || !window.ClipboardItem) {
        toast("이 브라우저는 그림 복사가 안 된다 — 📷 저장을 쓰세요");
        return;
      }
      navigator.clipboard.write([new ClipboardItem({ "image/png": b })])
        .then(function () { toast("클립보드에 복사했다"); },
              function () { toast("복사 실패 — 📷 저장을 쓰세요"); });
    });
  };
  timeEl.oninput = function () {
    var A = cur && cur.anims[play.anim];
    if (!A) return;
    play.on = false; syncBtns();
    play.t = A.dur * (parseInt(timeEl.value, 10) / 1000);
  };
  document.getElementById("speedSel").onchange = function (e) {
    play.speed = parseFloat(e.target.value);
  };
  syncBtns();
  show(PAGE.current || 0);
})();
})();
