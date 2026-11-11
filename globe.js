import { $, getJSON } from './lib.js';
import { countries, hasRanks } from './data.js';

export async function createGlobe(onSelect, onWorld, initial = countries[0], service = 'netflix') {
 const PALETTES = {
  netflix: {halo:['#e5091470','#e5091428','#e5091400'],sphere:'#0b0b0b',ocean:['#2c1417','#170d0f','#0a0707'],active:'#e50914',activeStroke:'#ff8a8f',worldFill:'#7a1a20',worldStroke:'#b23a42',charted:'#4b4b4b',chartedStroke:'#6e6e6e',land:'#262626',landStroke:'#3a3a3a',marker:'#8a8a8a',markerOff:'#3a3a3a',markerWorld:'#b23a42'},
  disney: {halo:['#1a52ff70','#1a52ff28','#1a52ff00'],sphere:'#050816',ocean:['#16245c','#0a1340','#040820'],active:'#2f8cff',activeStroke:'#bcd9ff',worldFill:'#1d3d9e',worldStroke:'#4f7dff',charted:'#3a4c8f',chartedStroke:'#5d73c4',land:'#1a2146',landStroke:'#2a3566',marker:'#7f90d8',markerOff:'#2a3566',markerWorld:'#4f7dff'}
 };
 let P = PALETTES[service] || PALETTES.netflix;
 const canvas = $('globe'), ctx = canvas.getContext('2d');
 if (!window.d3 || !window.topojson || !ctx) throw new Error('Globe dependencies unavailable');
 const d3 = window.d3;
 const atlas = await getJSON('./assets/countries-110m.json');
 const features = window.topojson.feature(atlas,atlas.objects.countries).features;
 // world-atlas leaves Kosovo without an id; 383 is its ISO numeric code.
 const featureId = f => f.id!=null?String(f.id).padStart(3,'0'):f.properties.name==='Kosovo'?'383':'';
 const byId = new Map(countries.map(c=>[c.id,c]));
 const drawn = new Set(features.map(featureId));
 const markers = countries.filter(c=>!drawn.has(c.id));
 const projection = d3.geoOrthographic().rotate([-initial.center[0],-initial.center[1]]).clipAngle(90).precision(.5);
 const path = d3.geoPath(projection,ctx), grid=d3.geoGraticule10();
 let width=0,height=0,ratio=1,radius=0,centerY=0,selected=initial,drag=null,animation=0,zoom=1,pinchDistance=0,pinching=false,zoomAnimation=0,lastTap=null,zoomFallback=0,world=false,releaseTimer=0;
 const touchPoints=new Map();
 const minZoom=.65,maxZoom=2.2;
 const motion = !matchMedia('(prefers-reduced-motion: reduce)').matches;
 function draw() {
  // Reapplied on every frame: some Android browsers drop the 2D context state, which left the globe at half size.
  ctx.setTransform(ratio,0,0,ratio,0,0);
  ctx.clearRect(0,0,width,height);
  // Deterministic stars keep the canvas still when idle (no perpetual animation loop).
    for(let i=0;i<45;i++){ctx.fillStyle=`rgba(255,255,255,${.06+(i%4)*.05})`;ctx.beginPath();ctx.arc((i*97+31)%width,(i*67+17)%height,i%3===0?1:.5,0,Math.PI*2);ctx.fill();}
    const globeRadius=radius*zoom,halo=ctx.createRadialGradient(width/2,centerY,globeRadius*.96,width/2,centerY,globeRadius+26);halo.addColorStop(0,P.halo[0]);halo.addColorStop(.35,P.halo[1]);halo.addColorStop(1,P.halo[2]);ctx.beginPath();ctx.arc(width/2,centerY,globeRadius+26,0,Math.PI*2);ctx.fillStyle=halo;ctx.fill();
    ctx.beginPath();path({type:'Sphere'});ctx.fillStyle=P.sphere;ctx.fill();
    const ocean=ctx.createRadialGradient(width/2-radius*.4,centerY-radius*.5,10,width/2,centerY,radius);
    ocean.addColorStop(0,P.ocean[0]);ocean.addColorStop(.58,P.ocean[1]);ocean.addColorStop(1,P.ocean[2]);
  ctx.beginPath();path({type:'Sphere'});ctx.fillStyle=ocean;ctx.fill();
    ctx.beginPath();path(grid);ctx.strokeStyle='#ffffff14';ctx.lineWidth=.5;ctx.stroke();
    for(const f of features){ctx.beginPath();path(f);const id=featureId(f),active=!!selected&&id===selected.id,listed=byId.get(id),charted=!!listed&&hasRanks(listed);ctx.fillStyle=active?P.active:charted?(world?P.worldFill:P.charted):P.land;ctx.strokeStyle=active?P.activeStroke:charted?(world?P.worldStroke:P.chartedStroke):P.landStroke;ctx.lineWidth=active?1.3:.55;ctx.fill();ctx.stroke();}
    const view=projection.invert([width/2,centerY]);
    for(const c of markers){if(d3.geoDistance(view,c.center)>=Math.PI/2)continue;const [x,y]=projection(c.center),active=!!selected&&c.id===selected.id;ctx.beginPath();ctx.arc(x,y,active?4.2:2.6,0,Math.PI*2);ctx.fillStyle=active?P.active:hasRanks(c)?(world?P.markerWorld:P.marker):P.markerOff;ctx.fill();ctx.strokeStyle=active?P.activeStroke:'#ffffff55';ctx.lineWidth=active?1.3:.8;ctx.stroke();}
    const shade=ctx.createRadialGradient(width/2-radius*.38,centerY-radius*.45,radius*.2,width/2,centerY,radius);shade.addColorStop(0,'#ffffff14');shade.addColorStop(.75,'#ffffff00');shade.addColorStop(1,'#00000066');ctx.beginPath();path({type:'Sphere'});ctx.fillStyle=shade;ctx.fill();
    ctx.beginPath();path({type:'Sphere'});ctx.strokeStyle='#ffffff40';ctx.lineWidth=.8;ctx.stroke();
  const center=projection.invert([width/2,centerY]);
  $('coordinate').textContent=`${Math.abs(center[1]).toFixed(1)}° ${center[1]>=0?'N':'S'} · ${Math.abs(center[0]).toFixed(1)}° ${center[0]>=0?'E':'W'}`;
 }
 function setZoom(value){zoom=Math.max(minZoom,Math.min(maxZoom,value));projection.scale(radius*zoom);draw();}
 function animateZoom(target){cancelAnimationFrame(zoomAnimation);clearTimeout(zoomFallback);const from=zoom,begin=performance.now();function frame(now){const t=motion?Math.min((now-begin)/280,1):1;setZoom(from+(target-from)*(1-Math.pow(1-t,3)));if(t<1)zoomAnimation=requestAnimationFrame(frame);}zoomAnimation=requestAnimationFrame(frame);zoomFallback=setTimeout(()=>{cancelAnimationFrame(zoomAnimation);setZoom(target);},400);}
 // Zooming out below the default size is elastic: on release the globe springs back to 1 and, if it was pulled in far enough, World mode starts.
 const worldThreshold=.88;
 function springBack(){cancelAnimationFrame(zoomAnimation);clearTimeout(zoomFallback);if(!motion){setZoom(1);return;}let velocity=0,last=performance.now();const stiffness=190,damping=11;function frame(now){let left=Math.min((now-last)/1000,.034);last=now;while(left>0){const step=Math.min(left,1/240);velocity+=(-stiffness*(zoom-1)-damping*velocity)*step;zoom+=velocity*step;left-=step;}setZoom(zoom);if(Math.abs(zoom-1)<.002&&Math.abs(velocity)<.01){setZoom(1);return;}zoomAnimation=requestAnimationFrame(frame);}zoomAnimation=requestAnimationFrame(frame);zoomFallback=setTimeout(()=>{cancelAnimationFrame(zoomAnimation);setZoom(1);},1600);}
 function releaseZoom(){clearTimeout(releaseTimer);if(zoom>=1)return;const entered=zoom<=worldThreshold;springBack();if(entered)onWorld();}
 // The World button plays the same pull-in and spring-back as the pinch gesture; `done` runs at the moment of release.
 function pulse(done){if(!motion){done();return;}cancelAnimationFrame(zoomAnimation);clearTimeout(zoomFallback);const from=zoom,target=.72,begin=performance.now();function frame(now){const p=Math.min((now-begin)/240,1);setZoom(from+(target-from)*(1-Math.pow(1-p,3)));if(p<1){zoomAnimation=requestAnimationFrame(frame);return;}springBack();done();}zoomAnimation=requestAnimationFrame(frame);}
 // Two quick taps in roughly the same spot reset the zoom (also covers mouse double-click and iOS, which skips dblclick).
 function registerTap(e){const now=performance.now();if(lastTap&&now-lastTap.time<320&&Math.hypot(e.clientX-lastTap.x,e.clientY-lastTap.y)<32){lastTap=null;animateZoom(1);}else lastTap={time:now,x:e.clientX,y:e.clientY};}
 function touchGap(){const points=[...touchPoints.values()];return Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y);}
 function resize(){const box=canvas.getBoundingClientRect();if(!box.width||!box.height)return;width=box.width;height=box.height;centerY=height*.47;ratio=Math.min(devicePixelRatio||1,2);const pixelWidth=Math.round(width*ratio),pixelHeight=Math.round(height*ratio);if(canvas.width!==pixelWidth)canvas.width=pixelWidth;if(canvas.height!==pixelHeight)canvas.height=pixelHeight;radius=Math.min(width*.46,height*.44);projection.translate([width/2,centerY]).scale(radius*zoom);draw();}
 function countryAtCenter(){const center=projection.invert([width/2,centerY]);const containing=features.find(f=>d3.geoContains(f,center));if(containing){const id=featureId(containing),mapped=byId.get(id);if(mapped)return mapped;return {code:null,id,name:containing.properties.name,en:containing.properties.name,center:d3.geoCentroid(containing)};}return countries.reduce((best,c)=>d3.geoDistance(center,c.center)<d3.geoDistance(center,best.center)?c:best,countries[0]);}
 function snap(country){selected=country;cancelAnimationFrame(animation);const start=projection.rotate(),target=[-country.center[0],-country.center[1],0];let delta=((target[0]-start[0]+540)%360)-180;const begin=performance.now();function frame(now){const t=motion?Math.min((now-begin)/650,1):1;const ease=1-Math.pow(1-t,4);projection.rotate([start[0]+delta*ease,start[1]+(target[1]-start[1])*ease,0]);draw();if(t<1)animation=requestAnimationFrame(frame);}animation=requestAnimationFrame(frame);}
 canvas.addEventListener('pointerdown',e=>{if(e.pointerType==='touch'){if(touchPoints.size>=2)return;cancelAnimationFrame(animation);canvas.setPointerCapture(e.pointerId);touchPoints.set(e.pointerId,{x:e.clientX,y:e.clientY});if(touchPoints.size===1)drag={id:e.pointerId,x:e.clientX,y:e.clientY,rotation:projection.rotate()};else{drag=null;pinching=true;pinchDistance=touchGap();}return;}if(!e.isPrimary)return;cancelAnimationFrame(animation);canvas.setPointerCapture(e.pointerId);drag={id:e.pointerId,x:e.clientX,y:e.clientY,rotation:projection.rotate()};});
 canvas.addEventListener('pointermove',e=>{if(e.pointerType==='touch'&&touchPoints.has(e.pointerId)){touchPoints.set(e.pointerId,{x:e.clientX,y:e.clientY});if(touchPoints.size===2){const distance=touchGap();if(pinchDistance>0){cancelAnimationFrame(zoomAnimation);clearTimeout(zoomFallback);setZoom(zoom*distance/pinchDistance);}pinchDistance=distance;return;}}if(!drag||drag.id!==e.pointerId)return;if(!drag.moved&&Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>5)drag.moved=true;projection.rotate([drag.rotation[0]+(e.clientX-drag.x)*.4,Math.max(-80,Math.min(80,drag.rotation[1]-(e.clientY-drag.y)*.4)),0]);selected=countryAtCenter();draw();});
 canvas.addEventListener('wheel',e=>{e.preventDefault();cancelAnimationFrame(zoomAnimation);clearTimeout(zoomFallback);clearTimeout(releaseTimer);setZoom(zoom*Math.exp(-e.deltaY*.002));releaseTimer=setTimeout(releaseZoom,180);},{passive:false});
 function finish(e){let moved=false;if(e.pointerType==='touch'&&touchPoints.has(e.pointerId)){const wasPinching=pinching;touchPoints.delete(e.pointerId);if(touchPoints.size===1){const [id,point]=touchPoints.entries().next().value;drag={id,x:point.x,y:point.y,rotation:projection.rotate()};pinchDistance=0;return;}moved=!!drag?.moved;drag=null;pinchDistance=0;pinching=false;if(wasPinching){releaseZoom();return;}}else{if(!drag||drag.id!==e.pointerId)return;moved=!!drag.moved;drag=null;}if(world&&!moved&&e.type!=='pointercancel'){registerTap(e);return;}const country=countryAtCenter();snap(country);if(moved||e.type==='pointercancel')onSelect(country);else registerTap(e);}
 canvas.addEventListener('pointerup',finish);canvas.addEventListener('pointercancel',finish);
 canvas.addEventListener('keydown',e=>{const r=projection.rotate();if(e.key==='ArrowLeft')r[0]-=12;else if(e.key==='ArrowRight')r[0]+=12;else if(e.key==='ArrowUp')r[1]=Math.min(80,r[1]+10);else if(e.key==='ArrowDown')r[1]=Math.max(-80,r[1]-10);else if(e.key==='Enter'){const c=countryAtCenter();snap(c);onSelect(c);e.preventDefault();return;}else return;e.preventDefault();cancelAnimationFrame(animation);projection.rotate(r);selected=countryAtCenter();draw();});
 // The page can come back from the background (or the GPU surface can be dropped) with a stale canvas.
 canvas.addEventListener('contextlost',e=>e.preventDefault());canvas.addEventListener('contextrestored',resize);
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')resize();});window.addEventListener('pageshow',resize);
 new ResizeObserver(resize).observe(canvas);resize();$('globe-loading').hidden=true;
 return {select:snap,refresh:draw,pulse,setService(name){P=PALETTES[name]||PALETTES.netflix;draw();},setWorld(on){world=!!on;if(world)selected=null;draw();}};
}
