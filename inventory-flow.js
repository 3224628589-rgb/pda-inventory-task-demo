import {ref,computed,watch,nextTick,onMounted,onUnmounted} from './vendor/vue.js';
import {orderedLines,quantityError,timeText,variance} from './data.js';
export const InventoryFlow={
 props:['task'],emits:['notice','finished'],
 setup(props,{emit}){
  const list=ref(null),expanded=ref(''),current=ref(''),selected=ref([]),busy=ref(false),error=ref(''),search=ref(''),searchQuery=ref(''),searchInput=ref(null),searchIndex=ref(-1);
  const summary=ref(null),summaryOpen=ref(true);
  const stage=ref(null),scrubbing=ref(false),scrubKey=ref(''),guideTop=ref(0);
  const groups=computed(()=>{const all=orderedLines(props.task),out=[];for(const done of [true,false]){const map=new Map();for(const line of all.filter(l=>(l.countedAt!==null)===done)){const key=(done?'done:':'todo:')+line.slot;if(!map.has(key)){const g={key,slot:line.slot,done,lines:[]};map.set(key,g);out.push(g)}map.get(key).lines.push(line)}}return out});
  const keyFor=l=>(l.countedAt!==null?'done:':'todo:')+l.slot;
  const activeGroup=computed(()=>groups.value.find(g=>g.key===expanded.value));
  const searchMatches=computed(()=>{const q=searchQuery.value.toLowerCase();return q?orderedLines(props.task).filter(l=>[l.slot,l.name,l.spec,l.batch,l.barcode].some(value=>String(value||'').toLowerCase().includes(q))):[]});
  const searchPosition=computed(()=>searchIndex.value<0||!searchMatches.value.length?0:searchIndex.value+1);
  const visibleLines=g=>expanded.value===g.key?g.lines:g.done?g.lines.filter(l=>l.after!==l.before):[];
  const value=l=>props.task.drafts[l.id]??String(l.before);
  const focusedValues=new Map();
  let motion=0,manual=false,programmatic=false,scrollTimer,frame,scanFrame,finishFrame,alive=true,animations=[],touching=false,candidate=null,spaceObserver;
  const reduce=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
  const target=()=>!list.value?null:activeGroup.value?.done?list.value.querySelector('[data-group="'+expanded.value+'"]'):list.value.querySelector('[data-line="'+current.value+'"]');
  function stop(){motion++;cancelAnimationFrame(frame);finishFrame?.();finishFrame=null;animations.forEach(a=>a.cancel());animations=[];programmatic=false;busy.value=false}
  async function center(token=motion,instant=false){
   await nextTick(); if(!alive||token!==motion||!target())return;
   updateSpacing();programmatic=true;const el=target(),box=list.value,rect=el.getBoundingClientRect(),view=box.getBoundingClientRect(),screen=document.querySelector('#app').getBoundingClientRect();
   const midpoint=Math.max(view.top+rect.height/2,Math.min((screen.top+screen.bottom)/2,view.bottom-rect.height/2));
   const top=Math.max(0,Math.min(box.scrollHeight-box.clientHeight,box.scrollTop+rect.top+rect.height/2-midpoint));
   const start=box.scrollTop,duration=reduce()||instant?0:320,t0=performance.now();
   await new Promise(resolve=>{finishFrame=resolve;function tick(t){if(token!==motion||!alive){resolve();return}const p=duration?Math.min(1,(t-t0)/duration):1;box.scrollTop=start+(top-start)*(1-Math.pow(1-p,3));if(p<1)frame=requestAnimationFrame(tick);else{finishFrame=null;resolve()}}frame=requestAnimationFrame(tick)});
   if(token===motion){programmatic=false;busy.value=false}
  }
  async function change(update,instant=false){
   stop();const token=motion;busy.value=true;manual=false;scrubbing.value=false;scrubKey.value='';candidate=null;clearTimeout(scrollTimer);cancelAnimationFrame(scanFrame);
   const before=new Map([...list.value?.querySelectorAll('[data-group]')||[]].map(e=>[e.dataset.group,e.getBoundingClientRect()]));
   update();error.value='';selected.value=[];await nextTick();
   if(!alive||token!==motion)return;
   if(!reduce()&&!instant){
    for(const el of list.value.querySelectorAll('[data-group]')){const old=before.get(el.dataset.group),r=el.getBoundingClientRect();if(old){const dy=old.top-r.top;const a=el.animate([{transform:`translateY(${dy}px)`,height:old.height+'px'},{transform:'translateY(0)',height:r.height+'px'}],{duration:240,easing:'cubic-bezier(.2,.7,.2,1)'});animations.push(a)}}
    await Promise.all(animations.map(a=>a.finished.catch(()=>{})));animations=[];
   }
   if(token===motion)await center(token,instant);
  }
  function updateSpacing(){
   if(!list.value||!stage.value)return;
   const screen=document.querySelector('#app').getBoundingClientRect(),view=stage.value.getBoundingClientRect();
   const mid=(screen.top+screen.bottom)/2;
   // Half-screen gutters allow either end to reach the center at any card height.
   list.value.style.setProperty('--list-top-space',Math.max(12,mid-view.top)+'px');
   list.value.style.setProperty('--list-bottom-space',Math.max(12,view.bottom-mid)+'px');
   if(scrubbing.value)updateCandidate();
  }
  function collapseSummary(){
   if(!summaryOpen.value||!summary.value||!list.value)return;
   const anchor=list.value.querySelector('[data-group]'),oldTop=anchor?.getBoundingClientRect().top;
   summaryOpen.value=false;
   // Commit before child handlers measure; preserve the control under the pointer.
   summary.value.style.height='0px';updateSpacing();
   if(anchor)list.value.scrollTop+=anchor.getBoundingClientRect().top-oldTop;
   nextTick(updateSpacing);
   if(scrubbing.value)updateCandidate();
  }
  async function expandSummary(){
   if(summaryOpen.value||!summary.value||!list.value)return;
   const anchor=list.value.querySelector('[data-group]'),oldTop=anchor?.getBoundingClientRect().top;
   summary.value.style.height='';summaryOpen.value=true;await nextTick();updateSpacing();
   if(anchor&&oldTop!==undefined)list.value.scrollTop+=anchor.getBoundingClientRect().top-oldTop;
  }
  function activate(group,line){change(()=>{expanded.value=group.key;current.value=group.done?'':(line||group.lines[0]).id;props.task.current=current.value||null})}
  function draft(l,event){props.task.drafts[l.id]=event.target.value;error.value=''}
  function focus(l,event){focusedValues.set(l.id,value(l));event.target.select()}
  function blur(l){if(props.task.drafts[l.id]==='')props.task.drafts[l.id]=focusedValues.get(l.id)??String(l.before)}
  async function complete(l){
   if(busy.value||l.id!==current.value||l.countedAt!==null)return;
   error.value=quantityError(value(l),l.occupied);if(error.value)return;
   const after=Number(value(l));document.activeElement?.blur();
   await change(()=>{
    l.recordBefore=l.before;l.after=after;l.stockQuantity=after;l.countedAt=Date.now();delete props.task.drafts[l.id];
    const all=orderedLines(props.task),i=all.findIndex(x=>x.id===l.id),next=all.slice(i+1).find(x=>x.countedAt===null)||all.find(x=>x.countedAt===null);
    if(next){expanded.value=keyFor(next);current.value=next.id;props.task.current=next.id}
    else{props.task.completedAt=Date.now();props.task.current=null;current.value='';expanded.value=keyFor(l);emit('finished');emit('notice','全部盘点完毕，任务已完成')}
   });
  }
  function toggle(l){selected.value=selected.value.includes(l.id)?selected.value.filter(x=>x!==l.id):[...selected.value,l.id]}
  function selectAll(g){selected.value=g.lines.every(l=>selected.value.includes(l.id))?[]:g.lines.map(l=>l.id)}
  function recount(g){if(!selected.value.length||busy.value)return;const ids=[...selected.value];change(()=>{for(const l of g.lines.filter(l=>ids.includes(l.id))){l.before=l.stockQuantity??l.after;l.recordBefore=null;l.after=null;l.countedAt=null;delete props.task.drafts[l.id]}props.task.completedAt=null;const next=orderedLines(props.task).find(l=>ids.includes(l.id));expanded.value=keyFor(next);current.value=next.id;props.task.current=next.id});emit('notice','已转为待盘点，重新核对实物数量')}
  function jumpToSearch(index){
   const matches=searchMatches.value;if(!matches.length){searchIndex.value=-1;emit('notice','未找到匹配的货位、商品或批次');return}
   searchInput.value?.blur();searchIndex.value=(index+matches.length)%matches.length;const l=matches[searchIndex.value];collapseSummary();activate(groups.value.find(g=>g.key===keyFor(l)),l);
  }
  function searchHit(){const q=search.value.trim();if(!q){searchInput.value?.focus();return}searchQuery.value=q;searchIndex.value=-1;nextTick(()=>jumpToSearch(0))}
  function searchMove(step){if(!searchQuery.value){searchHit();return}jumpToSearch(searchIndex.value<0?(step<0?searchMatches.value.length-1:0):searchIndex.value+step)}
  function clearSearch(){search.value='';searchQuery.value='';searchIndex.value=-1;error.value='';searchInput.value?.focus()}
  const isSearchMatch=l=>!!searchQuery.value&&searchMatches.value.some(match=>match.id===l.id);
  const groupSearchMatches=g=>g.lines.filter(isSearchMatch).length;
  const editing=()=>document.activeElement?.tagName==='INPUT';
  // Browsing feedback is separate from the committed expanded card.
  function updateCandidate(){
   if(!alive||!list.value||!stage.value||!manual||!scrubbing.value)return;
   const screen=document.querySelector('#app').getBoundingClientRect(),view=stage.value.getBoundingClientRect();
   const mid=Math.max(view.top,Math.min((screen.top+screen.bottom)/2,view.bottom));
   guideTop.value=mid-view.top;
   const candidates=[];
   for(const g of groups.value){
    const el=list.value.querySelector('[data-group="'+g.key+'"]');if(!el)continue;
    const r=el.getBoundingClientRect();if(r.bottom<view.top||r.top>view.bottom)continue;
    let l;
    if(!g.done&&g.key===expanded.value){
     const rows=g.lines.map(line=>({line,rect:list.value.querySelector('[data-line="'+line.id+'"]')?.getBoundingClientRect()})).filter(x=>x.rect);
     rows.sort((a,b)=>distance(a.rect,mid)-distance(b.rect,mid));l=rows[0]?.line;
    }
    candidates.push({g,l,rect:r});
   }
   candidates.sort((a,b)=>distance(a.rect,mid)-distance(b.rect,mid));
   candidate=candidates[0]||null;scrubKey.value=candidate?.g.key||'';
  }
  function distance(r,mid){return mid<r.top?r.top-mid:mid>r.bottom?mid-r.bottom:0}
  function gesture(){if(editing())return;stop();manual=true;clearTimeout(scrollTimer)}
  function touchStart(){if(editing())return;touching=true;gesture()}
  function touchEnd(){touching=false;if(manual&&scrubbing.value)settle()}
  function finishScrub(){
   if(!manual||touching||programmatic)return;
   if(editing()){manual=false;scrubbing.value=false;scrubKey.value='';return}
   updateCandidate();const hit=candidate;
   manual=false;scrubbing.value=false;scrubKey.value='';candidate=null;
   if(hit)activate(hit.g,hit.l);
  }
  function settle(){
   if(!manual||programmatic||editing())return;
   scrubbing.value=true;cancelAnimationFrame(scanFrame);scanFrame=requestAnimationFrame(updateCandidate);
   clearTimeout(scrollTimer);if(!touching)scrollTimer=setTimeout(finishScrub,220);
  }
  function sort(){collapseSummary();change(()=>{props.task.direction=props.task.direction==='asc'?'desc':'asc'})}
  watch(search,()=>{searchIndex.value=-1;searchQuery.value=''});
  onMounted(()=>{updateSpacing();spaceObserver=new ResizeObserver(updateSpacing);spaceObserver.observe(stage.value);const l=orderedLines(props.task).find(l=>l.countedAt===null)||orderedLines(props.task)[0];if(l){expanded.value=keyFor(l);current.value=l.countedAt===null?l.id:'';props.task.current=current.value||null;center(motion,true)}});
  onUnmounted(()=>{alive=false;spaceObserver?.disconnect();stop();clearTimeout(scrollTimer);cancelAnimationFrame(scanFrame)});
  return{list,summary,summaryOpen,collapseSummary,expandSummary,stage,scrubbing,scrubKey,guideTop,groups,expanded,current,selected,busy,error,search,searchQuery,searchInput,searchMatches,searchPosition,visibleLines,value,activate,draft,focus,blur,complete,toggle,selectAll,recount,searchHit,searchMove,clearSearch,isSearchMatch,groupSearchMatches,gesture,touchStart,touchEnd,settle,sort,timeText,variance};
 },
 template:`<div ref="summary" class="task-summary-collapse" :class="{'is-collapsed':!summaryOpen}" :aria-hidden="!summaryOpen" :inert="!summaryOpen?true:undefined"><slot name="summary"/></div><button v-if="!summaryOpen" class="summary-divider" @click="expandSummary" aria-label="展开任务信息"><span>任务信息</span><i>⌄</i></button><div class="flow-tools"><form @submit.prevent="searchHit"><input ref="searchInput" v-model="search" placeholder="货位 / 商品 / 批次 / 条码" aria-label="搜索任务明细" inputmode="search" enterkeyhint="search" autocomplete="off"><button v-if="search" type="button" class="find-clear" @click="clearSearch" aria-label="清空任务搜索"><img src="./assets/m_icon_clear.webp" alt=""></button><span v-if="searchQuery" class="find-count" aria-live="polite">{{searchPosition}}/{{searchMatches.length}}</span><button v-if="searchQuery&&searchMatches.length" type="button" class="find-step" @click="searchMove(-1)" aria-label="上一个搜索结果">↑</button><button v-if="searchQuery&&searchMatches.length" type="button" class="find-step" @click="searchMove(1)" aria-label="下一个搜索结果">↓</button><button type="submit" class="find-submit">搜索</button></form><button @click="sort" aria-label="切换货位排序">{{task.direction==='asc'?'A→Z':'Z→A'}} ⇅</button></div>
 <div class="inventory-scroll-stage" ref="stage" :class="{'is-scrubbing':scrubbing}"><div v-if="scrubbing" class="scrub-guide" :style="{top:guideTop+'px'}" aria-hidden="true"></div><main class="page-scroll slot-list" ref="list" @click.capture="collapseSummary" @focusin.capture="collapseSummary" @input.capture="collapseSummary" @keydown.capture="collapseSummary" @wheel.capture.passive="collapseSummary" @touchstart.capture.passive="collapseSummary" @wheel.passive="gesture" @touchstart.passive="touchStart" @touchend.passive="touchEnd" @touchcancel.passive="touchEnd" @scroll.passive="settle" aria-label="盘点明细" :aria-busy="busy">
 <article v-for="g in groups" :key="g.key" :data-group="g.key" class="slot-group" :class="{'group-done':g.done,'group-open':expanded===g.key,'is-scrub-target':scrubbing&&scrubKey===g.key,'is-search-match':groupSearchMatches(g)>0}">
  <header class="slot-head"><button v-if="g.done&&expanded===g.key" class="check-circle" :class="{checked:g.lines.every(l=>selected.includes(l.id))}" @click="selectAll(g)" aria-label="全选该货位批次">{{g.lines.every(l=>selected.includes(l.id))?'✓':''}}</button><button class="slot-toggle" @click="activate(g)" :aria-expanded="expanded===g.key"><strong>{{g.slot}}</strong><span class="slot-status">{{g.done?'已盘点':'待盘点'}}<small v-if="groupSearchMatches(g)"> · {{groupSearchMatches(g)}}处</small></span></button></header>
  <div v-for="l in visibleLines(g)" :key="l.id" class="batch-wrap">
   <button v-if="g.done&&expanded===g.key" class="check-circle" :class="{checked:selected.includes(l.id)}" @click="toggle(l)" :aria-label="'选择重新盘点 '+l.name+' '+l.batch">{{selected.includes(l.id)?'✓':''}}</button>
   <section :data-line="l.id" class="batch-card" :class="{'batch-active':!g.done&&current===l.id&&expanded===g.key,'batch-done':g.done,'is-search-match':isSearchMatch(l)}">
    <template v-if="!g.done&&current===l.id&&expanded===g.key"><img class="active-photo" :src="l.image||'./assets/m_pic_placeholder.webp'" @error="$event.currentTarget.src='./assets/m_pic_placeholder.webp'" alt="商品图片"><div class="active-bottom"><div class="active-info"><h2>{{l.name}} | {{l.spec}}</h2><p>{{l.batch}}/有效期 {{l.expiry}}</p><div class="quantity-pair"><label>盘前数量<output>{{l.before}}</output></label><label>盘后数量<input :id="'quantity-'+l.id" :value="value(l)" @input="draft(l,$event)" @focus="focus(l,$event)" @blur="blur(l)" @keydown.enter.prevent="complete(l)" inputmode="numeric" autocomplete="off" aria-label="盘后数量" :aria-invalid="!!error"></label></div></div><button class="next-button" :disabled="busy" @click="complete(l)">盘点完毕<br>下一条</button></div><p v-if="error" class="field-error" role="alert">{{error}}</p></template>
    <button v-else class="batch-summary" @click="g.done?activate(g):activate(g,l)"><img :src="l.image||'./assets/m_pic_placeholder.webp'" @error="$event.currentTarget.src='./assets/m_pic_placeholder.webp'" alt="商品图片"><div><h2>{{l.name}} | {{l.spec}}</h2><p>{{l.batch}}/有效期 {{l.expiry}}</p><template v-if="g.done"><p class="result-formula">{{variance(l)}}<span v-if="l.after!==l.before">=盘后{{l.after}}-盘前{{l.before}}</span><span v-else> · 盘后{{l.after}}=盘前{{l.before}}</span></p><time>{{timeText(l.countedAt)}}</time></template><p v-else>当前数量：{{l.before}}</p></div></button>
   </section>
  </div>
  <button v-if="g.done&&expanded===g.key" class="recount-button" :disabled="!selected.length||busy" @click="recount(g)">重新盘点{{selected.length?'（'+selected.length+'）':''}}</button>
 </article><p class="list-end">{{task.completedAt?'全部盘点完成，可展开货位复核':'已显示全部货位'}}</p>
 </main></div>`
};
