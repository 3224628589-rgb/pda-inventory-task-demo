import {ref,computed,nextTick,onMounted,onUnmounted} from './vendor/vue.js?v=2026.10.13.3';
import {quantityError} from './data.js?v=2026.10.13.3';
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
export function traceResult(task,line){
 const d=traceDraft(task,line),filled=entries(d),codes=filled.filter(([i,v])=>d.lookup[i]?.status==='resolved'&&d.lookup[i]?.code===v).map(([i])=>({...d.lookup[i]}));
 const enteredQuantity=Number(task.drafts[line.id]);
 return {enteredQuantity,quantity:filled.length?codes.filter(c=>c.batch===line.batch).length:enteredQuantity,hasCodes:filled.length>0,codes};
}
export const TraceCount={
 props:['task','line','busy'],emits:['finish'],
 setup(props,{emit}){
  const error=ref(''),root=ref(null),codeList=ref(null),focusIndex=ref(0),windowStart=ref(0),scanOpen=ref(false),scanInput=ref(''),scanTarget=ref(0),resizeConfirm=ref(false);
  const state=computed(()=>traceDraft(props.task,props.line));
  const qty=computed(()=>props.task.drafts[props.line.id]??'');
  const target=computed(()=>Number(qty.value)||0);
  const filled=computed(()=>entries(state.value));
  const completeCount=computed(()=>filled.value.filter(([,v])=>valid(v)).length);
  const pendingCount=computed(()=>Object.values(state.value.lookup).filter(v=>v.status==='pending').length);
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
   focusIndex.value=index;windowStart.value=Math.max(0,index-2);await nextTick();
   if(codeList.value)codeList.value.scrollTop=index*44;
   await nextTick();const node=root.value?.querySelector('[data-trace-index="'+index+'"]');node?.focus({preventScroll:true});
  }
  function scrollRows(){windowStart.value=Math.max(0,Math.floor((codeList.value?.scrollTop||0)/44)-2)}
  async function resolve(index){
   const d=state.value,code=d.values[index];if(!valid(code))return;
   const token=(requests.get(index)||0)+1;requests.set(index,token);d.lookup[index]={code,status:'pending'};
   // Simulated provider boundary. Never infer a real batch number from code digits.
   await new Promise(r=>setTimeout(r,180));
   if(!alive||requests.get(index)!==token||d.values[index]!==code)return;
   const found=props.task.traceCatalog?.[code];
   d.lookup[index]=found&&found.productId===props.line.productId?{...found,code,status:'resolved'}:{code,status:'error',message:found?'该追溯码不属于当前商品':'模拟目录未收录此码，请用演示扫码或重试'};
  }
  function duplicate(code,index){return filled.value.some(([i,v])=>Number(i)!==index&&v===code)}
  function manual(index,event){
   if(props.busy)return;
   let value=event.target.value.replace(/\D/g,'').slice(0,20);error.value='';
   if(valid(value)&&duplicate(value,index)){value=value.slice(0,19);error.value='请勿录入相同追溯码'}
   event.target.value=value;state.value.values[index]=value;delete state.value.lookup[index];requests.set(index,(requests.get(index)||0)+1);
   if(valid(value)){resolve(index);focusRow(firstIncomplete())}
  }
  function scanAt(raw,index=focusIndex.value){
   if(props.busy)return false;
   if(!valid(raw)){error.value='请扫描追溯码录入';return false}
   if(index<0||index>=state.value.count){error.value='当前无需录入追溯码';return false}
   if(duplicate(raw,index)){error.value='请勿录入相同追溯码';return false}
   error.value='';state.value.values[index]=raw;delete state.value.lookup[index];resolve(index);focusRow(firstIncomplete());return true;
  }
  function clear(index){if(props.busy)return;state.value.values[index]='';delete state.value.lookup[index];requests.set(index,(requests.get(index)||0)+1);error.value='';focusRow(index)}
  function back(){if(props.busy)return;state.value.step=Math.max(1,state.value.step-1);error.value='';if(state.value.step===2)focusRow(firstIncomplete())}
  function enterScan(){
   const d=state.value;for(const key of Object.keys(d.lookup))if(Number(key)>=target.value)delete d.lookup[key];
   for(const key of Object.keys(d.values))if(Number(key)>=target.value)delete d.values[key];d.count=target.value;d.step=2;resizeConfirm.value=false;error.value='';focusRow(firstIncomplete());
  }
  function next(){
   if(props.busy)return;
   error.value=quantityError(qty.value,props.line.occupied);if(error.value)return;
   if(state.value.step===1){
    if(Object.entries(state.value.values).some(([i,v])=>Number(i)>=target.value&&v)){resizeConfirm.value=true;return}
    enterScan();return;
   }
   error.value=traceError(props.task,props.line);if(error.value){if(error.value===consistencyMessage)focusRow(firstIncomplete());return}
   if(state.value.step===2){state.value.step=3;document.activeElement?.blur();return}
   emit('finish');
  }
  function sample(other=false){
   if(props.busy)return;
   const index=firstIncomplete();if(index<0){error.value='所有追溯码已录入，可清空后重新扫描';return}
   props.task.traceCatalog ||= {};let hash=0;for(const c of props.task.id+':'+props.line.id)hash=(Math.imul(hash,31)+c.charCodeAt(0))>>>0;
   const seq=(props.task.traceSequence||0)+1;props.task.traceSequence=seq;
   const code='8'+String(hash).padStart(10,'0')+String(seq).padStart(9,'0');
   props.task.traceCatalog[code]={productId:props.line.productId,batch:other?(props.line.batch==='20260518'?'20260519':'20260518'):props.line.batch,expiry:other?'2028-04-30':props.line.expiry};scanAt(code,index);
  }
  function openScanner(){scanTarget.value=Math.max(0,Math.min(focusIndex.value,state.value.count-1));scanInput.value='';scanOpen.value=true;error.value='';nextTick(()=>root.value?.querySelector('.trace-scanner input')?.focus())}
  function submitScan(){if(scanAt(scanInput.value,scanTarget.value))scanOpen.value=false}
  function bridgeScan(event){if(state.value.step===2)scanAt(String(event.detail?.code??''),event.detail?.index??focusIndex.value)}
  onMounted(()=>{window.addEventListener('pda-trace-scan',bridgeScan);for(const [i,v] of filled.value)if(valid(v)&&state.value.lookup[i]?.status!=='resolved')resolve(Number(i));if(state.value.step===2)focusRow(firstIncomplete())});
  onUnmounted(()=>{alive=false;window.removeEventListener('pda-trace-scan',bridgeScan)});
  return{state,error,root,codeList,focusIndex,windowStart,rowIndices,qty,target,completeCount,pendingCount,removal,setQty,adjust,back,next,manual,scanAt,clear,resolve,scrollRows,sample,scanOpen,scanInput,openScanner,submitScan,resizeConfirm,enterScan};
 },
 template:`<div ref="root" class="trace-count" :data-step="state.step">
  <div v-if="state.step===1" class="active-layout trace-quantity">
   <div class="active-primary"><div class="active-photo-wrap"><img class="active-photo" :src="line.image||'./assets/m_pic_placeholder.webp'" @error="$event.currentTarget.src='./assets/m_pic_placeholder.webp'" alt="商品图片"></div><div class="active-info"><h2>{{line.name}} | {{line.spec}}</h2><p>批号{{line.batch}}/有效期 {{line.expiry}}</p></div></div>
   <div class="active-actions"><label class="after-stack"><span class="after-label">盘后数量</span><button type="button" class="quantity-step step-minus" @click="adjust(-1)" aria-label="盘后数量减一">−</button><input :id="'quantity-'+line.id" :value="qty" @input="setQty($event.target.value)" @focus="$event.target.select()" inputmode="numeric" autocomplete="off" enterkeyhint="done" aria-label="盘后数量" placeholder="请输入" :aria-invalid="!!error"><button type="button" class="quantity-step step-plus" @click="adjust(1)" aria-label="盘后数量加一">＋</button></label><button class="trace-arrow trace-next" :disabled="busy" @click="next" aria-label="下一步，扫描追溯码">下一步</button></div>
  </div>
  <div v-else-if="state.step===2" class="trace-layout">
   <div class="trace-main"><div class="trace-progress" aria-live="polite">已录 <b>{{completeCount}}</b> / {{state.count}} 个 <span v-if="pendingCount">· 核准中</span></div>
    <div ref="codeList" class="trace-code-list" @scroll.passive="scrollRows" :data-row-count="state.count">
     <div :style="{height:windowStart*44+'px'}" aria-hidden="true"></div>
     <div class="trace-code-row" v-for="i in rowIndices" :key="i"><input :data-trace-index="i" :aria-label="'追溯码第'+(i+1)+'行'" :value="state.values[i]||''" :class="{'trace-complete':(state.values[i]||'').length===20}" @input="manual(i,$event)" @focus="focusIndex=i" @paste.prevent="scanAt($event.clipboardData.getData('text'),i)" inputmode="numeric" maxlength="20" autocomplete="off" placeholder="扫描 / 输入追溯码"><button @click="clear(i)" :aria-label="'清空追溯码第'+(i+1)+'行'"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 9v9M14 9v9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button></div>
     <div :style="{height:Math.max(0,state.count-windowStart-rowIndices.length)*44+'px'}" aria-hidden="true"></div>
     <p v-if="!state.count" class="trace-empty">盘后数量为0，无需扫码</p>
    </div>
    <div v-for="i in rowIndices.filter(i=>state.lookup[i]?.status==='error')" :key="'error'+i" class="trace-lookup-error">第{{i+1}}行：{{state.lookup[i].message}}<button @click="resolve(i)" :aria-label="'重试核准第'+(i+1)+'行'">重试</button></div>
    <p class="trace-rule">有追溯码请录全，无追溯码请全部留空</p>
    <div class="trace-demo-tools"><button @click="openScanner" :disabled="!state.count">扫码录入</button><span>演示扫码</span><button @click="sample(false)">本批次 +1</button><button @click="sample(true)">其他批次 +1</button></div>
   </div><div class="trace-side"><button class="trace-arrow trace-back" :disabled="busy" @click="back" aria-label="上一步，修改数量">上一步</button><button class="trace-arrow trace-next" :disabled="busy" @click="next" aria-label="下一步，查看盘点结果">下一步</button></div>
  </div>
  <div v-else class="trace-layout">
   <div class="trace-main trace-result">
    <template v-if="removal.length"><p class="trace-result-note">请将以下商品从架上取下，放置待办区：</p><div class="trace-removals"><section v-for="g in removal" :key="g.batch+'|'+g.expiry" class="trace-removal"><p><b>{{g.batch}}批次</b> / 数量{{g.codes.length}}</p><div v-for="code in g.codes" :key="code">{{code.slice(0,-4)}}<b>{{code.slice(-4)}}</b></div></section></div></template>
    <template v-else><p class="trace-result-note">无需取货下架，点击下一个完成盘点</p><div class="trace-success" aria-label="盘点结果核对完成"><svg viewBox="0 0 100 100" aria-hidden="true"><path d="M25 50L43 68L77 33" stroke="white" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg></div></template>
   </div><div class="trace-side"><button class="trace-arrow trace-back" :disabled="busy" @click="back" aria-label="上一步，核对追溯码">上一步</button><button class="trace-arrow trace-finish" :disabled="busy" @click="next" aria-label="确认盘点结果，下一个">下一个</button></div>
  </div>
  <div v-if="scanOpen" class="trace-modal-shade" @click.self="scanOpen=false"><section class="trace-scanner" role="dialog" aria-modal="true" aria-label="模拟扫码录入"><h3>模拟扫码录入</h3><p>在此输入一次完整扫描结果</p><form @submit.prevent="submitScan"><input v-model="scanInput" aria-label="模拟扫描结果" inputmode="numeric" autocomplete="off"><p v-if="error" class="field-error" role="alert">{{error}}</p><div><button type="button" @click="scanOpen=false">取消</button><button type="submit">确认扫码</button></div></form></section></div>
  <div v-if="resizeConfirm" class="trace-modal-shade"><section class="trace-scanner" role="dialog" aria-modal="true" aria-label="确认减少录入行"><h3>数量已减少</h3><p>继续将清除超出盘后数量的末尾追溯码。</p><div><button @click="resizeConfirm=false">返回修改</button><button @click="enterScan">确认清除</button></div></section></div>
  <div class="trace-dots" :aria-label="'第'+state.step+'步，共3步'"><i v-for="n in 3" :key="n" :class="{active:state.step===n}"></i></div>
  <p v-if="error&&!scanOpen" class="field-error" role="alert">{{error}}</p>
 </div>`
};
