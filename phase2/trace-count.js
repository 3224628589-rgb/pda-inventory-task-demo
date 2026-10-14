import {ref,computed,nextTick,onMounted,onUnmounted,watch} from './vendor/vue.js?v=2026.10.14.1';
import {quantityError} from './data.js?v=2026.10.14.1';
export const consistencyMessage='若实物有追溯码，请录全追溯码，若实物无追溯码，请留空，不可录入部分追溯码';
const valid=code=>/^\d{20}$/.test(code||'');
export function traceDraft(task,line){
 task.traceDrafts ||= {};
 let draft=task.traceDrafts[line.id];
 if(!draft||draft.schema!==2){
  const values={},lookup={};
  for(const [i,c] of (draft?.codes||[]).entries()){values[i]=c.code;lookup[i]={...c,status:'resolved'}}
  draft=task.traceDrafts[line.id]={schema:2,step:draft?.step||1,values,lookup,count:Number(task.drafts[line.id])||0};
 }
 return draft;
}
const entries=d=>Object.entries(d.values).filter(([i,v])=>Number(i)<d.count&&v);
export function traceError(task,line){
 const d=traceDraft(task,line),qty=Number(task.drafts[line.id]),error=quantityError(task.drafts[line.id]??'',line.occupied);
 if(error)return error;
 const filled=entries(d);if(!filled.length)return '';
 if(d.count!==qty||filled.length!==qty||filled.some(([,v])=>!valid(v)))return consistencyMessage;
 if(new Set(filled.map(([,v])=>v)).size!==filled.length)return '请勿录入相同追溯码';
 if(filled.some(([i,v])=>d.lookup[i]?.status==='pending'))return '正在核准批号，请稍候';
 if(filled.some(([i,v])=>d.lookup[i]?.status!=='resolved'||d.lookup[i]?.code!==v))return '存在未核准的追溯码，请重试或重新录入';
 return '';
}
export function traceReady(task,line){
 const d=traceDraft(task,line);
 // Explicitly entered zero and all-empty scanning are the two PRD shortcuts.
 return d.step===3||(d.step===1&&Number(task.drafts[line.id])===0&&!entries(d).length)||(d.step===2&&!entries(d).length);
}
export function traceResult(task,line){
 const d=traceDraft(task,line),filled=entries(d),codes=filled.filter(([i,v])=>d.lookup[i]?.status==='resolved'&&d.lookup[i]?.code===v).map(([i])=>({...d.lookup[i]}));
 const enteredQuantity=Number(task.drafts[line.id]);
 return {enteredQuantity,quantity:filled.length?codes.filter(c=>c.batch===line.batch).length:enteredQuantity,hasCodes:filled.length>0,codes};
}
export const TraceCount={
 props:['task','line','busy'],emits:['finish','notice'],
 setup(props,{emit}){
  const error=ref(''),root=ref(null),codeList=ref(null),focusIndex=ref(0),windowStart=ref(0),sliding=ref(false),direction=ref('right'),resizeConfirm=ref(false);
  const state=computed(()=>traceDraft(props.task,props.line));
  const qty=computed(()=>props.task.drafts[props.line.id]??'');
  const target=computed(()=>Number(qty.value)||0);
  const filled=computed(()=>entries(state.value));
  const rowIndices=computed(()=>Array.from({length:Math.max(0,Math.min(16,state.value.count-windowStart.value))},(_,i)=>i+windowStart.value));
  const removal=computed(()=>{
   const groups=new Map();
   for(const c of traceResult(props.task,props.line).codes.filter(c=>c.batch!==props.line.batch)){
    if(!groups.has(c.batch))groups.set(c.batch,{batch:c.batch,codes:[]});groups.get(c.batch).codes.push(c.code);
   }
   return [...groups.values()];
  });
  const requests=new Map();let alive=true;
  function setQty(raw){props.task.drafts[props.line.id]=raw;error.value=''}
  function adjust(n){const raw=Number(qty.value);setQty(String(Math.max(0,Math.min(999999,(Number.isFinite(raw)?raw:0)+n))))}
  function firstIncomplete(){let index=0;while(index<state.value.count&&valid(state.value.values[index]))index++;return index<state.value.count?index:-1}
  async function focusRow(index){
   if(index<0||index>=state.value.count)return;
   focusIndex.value=index;
   const top=Math.max(0,Math.min(index*35,Math.max(0,state.value.count*35-7-214)));
   windowStart.value=Math.max(0,Math.floor(top/35)-2);await nextTick();
   if(codeList.value)codeList.value.scrollTop=top;
   await nextTick();const node=root.value?.querySelector('[data-trace-index="'+index+'"]');node?.focus({preventScroll:true});
  }
  function scrollRows(){windowStart.value=Math.max(0,Math.floor((codeList.value?.scrollTop||0)/35)-2)}
  async function resolve(index){
   const d=state.value,code=d.values[index];if(!valid(code))return;
   const token=(requests.get(index)||0)+1;requests.set(index,token);d.lookup[index]={code,status:'pending'};
   // Simulated provider boundary. Never infer a real batch number from code digits.
   await new Promise(r=>setTimeout(r,180));
   if(!alive||requests.get(index)!==token||d.values[index]!==code)return;
   const found=props.task.traceCatalog?.[code];
   d.lookup[index]=found&&found.productId===props.line.productId?{...found,code,status:'resolved'}:{code,status:'error',message:found?'该追溯码不属于当前商品':'未核准此追溯码，请点击输入框重新扫描'};
  }
  function duplicate(code,index){return filled.value.some(([i,v])=>Number(i)!==index&&v===code)}
  function scanAt(raw,index=focusIndex.value){
   if(props.busy)return false;
   if(!valid(raw)){error.value='请扫描追溯码录入';return false}
   if(index<0||index>=state.value.count){error.value='当前无需录入追溯码';return false}
   if(duplicate(raw,index)){error.value='请勿录入相同追溯码';return false}
   error.value='';state.value.values[index]=raw;delete state.value.lookup[index];resolve(index);focusRow(firstIncomplete());return true;
  }
  function clear(index){if(props.busy)return;state.value.values[index]='';delete state.value.lookup[index];requests.set(index,(requests.get(index)||0)+1);error.value='';focusRow(index)}
  function changeStep(step){direction.value=step>state.value.step?'right':'left';sliding.value=true;state.value.step=step;error.value=''}
  function settled(){sliding.value=false;if(state.value.step===2)focusRow(firstIncomplete())}
  function back(){if(props.busy||sliding.value)return;changeStep(Math.max(1,state.value.step-1))}
  function enterScan(){
   const d=state.value;for(const key of Object.keys(d.lookup))if(Number(key)>=target.value)delete d.lookup[key];
   for(const key of Object.keys(d.values))if(Number(key)>=target.value)delete d.values[key];d.count=target.value;resizeConfirm.value=false;
   if(target.value===0){document.activeElement?.blur();emit('finish');return}
   changeStep(2);
  }
  function next(){
   if(props.busy||sliding.value)return;
   error.value=quantityError(qty.value,props.line.occupied);if(error.value)return;
   if(state.value.step===1){
    if(Object.entries(state.value.values).some(([i,v])=>Number(i)>=target.value&&v)){resizeConfirm.value=true;return}
    enterScan();return;
   }
   error.value=traceError(props.task,props.line);if(error.value){if(error.value===consistencyMessage)focusRow(firstIncomplete());return}
   if(state.value.step===2){document.activeElement?.blur();if(!filled.value.length){emit('finish');return}changeStep(3);return}
   emit('finish');
  }
  function sample(index){
   if(props.busy||sliding.value)return;
   const other=index%3===2;
   props.task.traceCatalog ||= {};let hash=0;for(const c of props.task.id+':'+props.line.id)hash=(Math.imul(hash,31)+c.charCodeAt(0))>>>0;
   const seq=(props.task.traceSequence||0)+1;props.task.traceSequence=seq;
   const code='8'+String(hash).padStart(10,'0')+String(seq).padStart(9,'0');
   props.task.traceCatalog[code]={productId:props.line.productId,batch:other?(props.line.batch==='20260518'?'20260519':'20260518'):props.line.batch,expiry:other?'2028-04-30':props.line.expiry};scanAt(code,index);
  }
  function bridgeScan(event){if(state.value.step===2)scanAt(String(event.detail?.code??''),event.detail?.index??focusIndex.value)}
  watch(error,value=>{if(value)emit('notice',value)});
  onMounted(()=>{window.addEventListener('pda-trace-scan',bridgeScan);for(const [i,v] of filled.value)if(valid(v)&&state.value.lookup[i]?.status!=='resolved')resolve(Number(i));if(state.value.step===2)focusRow(firstIncomplete())});
  onUnmounted(()=>{alive=false;window.removeEventListener('pda-trace-scan',bridgeScan)});
  return{state,error,root,codeList,focusIndex,windowStart,rowIndices,qty,target,removal,setQty,adjust,back,next,scanAt,clear,resolve,scrollRows,sample,sliding,direction,settled,resizeConfirm,enterScan};
 },
 template:`<div ref="root" class="trace-count" :data-step="state.step">
  <div class="trace-viewport"><Transition :name="'trace-slide-'+direction" @after-enter="settled"><div :key="state.step" class="trace-panel">
  <div v-if="state.step===1" class="active-layout trace-quantity">
   <div class="active-primary"><div class="active-photo-wrap"><img class="active-photo" :src="line.image||'./assets/m_pic_placeholder.webp'" @error="$event.currentTarget.src='./assets/m_pic_placeholder.webp'" alt="商品图片"></div><div class="active-info"><h2>{{line.name}} | {{line.spec}}</h2><p>批号{{line.batch}}/有效期 {{line.expiry}}</p></div></div>
   <div class="active-actions"><label class="after-stack"><span class="after-label">盘后数量</span><button type="button" class="quantity-step step-minus" @click="adjust(-1)" aria-label="盘后数量减一">−</button><input :id="'quantity-'+line.id" :value="qty" @input="setQty($event.target.value)" @focus="$event.target.select()" inputmode="numeric" autocomplete="off" enterkeyhint="done" aria-label="盘后数量" placeholder="请输入" :aria-invalid="!!error"><button type="button" class="quantity-step step-plus" @click="adjust(1)" aria-label="盘后数量加一">＋</button></label><button class="trace-arrow trace-next" :disabled="busy||sliding" @click="next" aria-label="下一步，扫描追溯码">下一步</button></div>
  </div>
  <div v-else-if="state.step===2" class="trace-layout">
   <div class="trace-main">
    <div ref="codeList" class="trace-code-list" @scroll.passive="scrollRows" :data-row-count="state.count">
     <div :style="{height:windowStart*35+'px'}" aria-hidden="true"></div>
     <div class="trace-code-row" v-for="i in rowIndices" :key="i"><input :data-trace-index="i" :aria-label="'追溯码第'+(i+1)+'行'" :value="state.values[i]||''" :class="{'trace-complete':(state.values[i]||'').length===20}" @click="sample(i)" readonly @focus="focusIndex=i" @paste.prevent="scanAt($event.clipboardData.getData('text'),i)" inputmode="none" maxlength="20" autocomplete="off" placeholder="扫描 / 输入追溯码"><button @click="clear(i)" :aria-label="'清空追溯码第'+(i+1)+'行'"><img src="./assets/trace-figma/clear.svg" width="18" height="18" alt=""></button></div>
     <div :style="{height:Math.max(0,state.count-windowStart-rowIndices.length)*35+'px'}" aria-hidden="true"></div>
    </div>
   </div><div class="trace-side"><button class="trace-arrow trace-back" :disabled="busy||sliding" @click="back" aria-label="上一步，修改数量">上一步</button><button class="trace-arrow trace-next" :disabled="busy||sliding" @click="next" aria-label="下一步，查看盘点结果">下一步</button></div>
  </div>
  <div v-else class="trace-layout">
   <div class="trace-main trace-result">
    <template v-if="removal.length"><p class="trace-result-note">请将以下商品从架上取下，放置待办区：</p><div class="trace-removals"><section v-for="g in removal" :key="g.batch+'|'+g.expiry" class="trace-removal"><p><b>{{g.batch}}批次</b> / 数量{{g.codes.length}}</p><div v-for="code in g.codes" :key="code">{{code.slice(0,-4)}}<b>{{code.slice(-4)}}</b></div></section></div></template>
    <template v-else><p class="trace-result-note">无需取货下架，点击下一个完成盘点</p><div class="trace-success" aria-label="盘点结果核对完成"><img src="./assets/trace-figma/success.svg" width="150" height="150" alt=""></div></template>
   </div><div class="trace-side"><button class="trace-arrow trace-back" :disabled="busy||sliding" @click="back" aria-label="上一步，核对追溯码">上一步</button><button class="trace-arrow trace-finish" :disabled="busy||sliding" @click="next" aria-label="确认盘点结果，下一个">下一个</button></div>
  </div>
  </div></Transition></div>
  <div v-if="resizeConfirm" class="trace-modal-shade"><section class="trace-scanner" role="dialog" aria-modal="true" aria-label="确认减少录入行"><h3>数量已减少</h3><p>继续将清除超出盘后数量的末尾追溯码。</p><div><button @click="resizeConfirm=false">返回修改</button><button @click="enterScan">确认清除</button></div></section></div>
  <div class="trace-dots" :aria-label="'第'+state.step+'步，共3步'"><i v-for="n in 3" :key="n" :class="{active:state.step===n}"></i></div>

 </div>`
};
