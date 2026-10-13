import {ref,computed} from './vendor/vue.js?v=2026.10.13.2';
import {quantityError} from './data.js?v=2026.10.13.2';

// Local demo catalogue. A real integration must resolve codes on the server.
export function traceDraft(task,line){
 task.traceDrafts ||= {};
 return task.traceDrafts[line.id] ||= {step:1,codes:[]};
}
export function traceError(task,line){
 const d=traceDraft(task,line),qty=Number(task.drafts[line.id]);
 const error=quantityError(task.drafts[line.id]??'',line.occupied);
 if(error)return error;
 if(d.codes.length!==qty)return `需要扫描${qty}个追溯码，当前已扫${d.codes.length}个`;
 const all=task.lines.filter(l=>l.id!==line.id).flatMap(l=>l.traceRecord?.codes||task.traceDrafts?.[l.id]?.codes||[]).map(c=>c.code);
 if(new Set(d.codes.map(c=>c.code)).size!==d.codes.length||d.codes.some(c=>all.includes(c.code)))return '追溯码重复，请删除后重新扫描';
 if(d.codes.some(c=>!task.traceCatalog?.[c.code]||c.productId!==line.productId))return '追溯码商品不匹配，请重新扫描';
 return '';
}
export const TraceCount={
 props:['task','line','busy'],emits:['finish'],
 setup(props,{emit}){
  const input=ref(''),error=ref('');
  const state=computed(()=>traceDraft(props.task,props.line));
  const qty=computed(()=>props.task.drafts[props.line.id]??'');
  const target=computed(()=>Number(qty.value)||0);
  const removal=computed(()=>{
   const groups=new Map();
   for(const c of state.value.codes.filter(c=>c.batch!==props.line.batch)){
    const key=c.batch+'|'+c.expiry;
    if(!groups.has(key))groups.set(key,{batch:c.batch,expiry:c.expiry,codes:[]});
    groups.get(key).codes.push(c.code);
   }
   return [...groups.values()];
  });
  const result=computed(()=>{
   const before=Number(props.line.before),after=target.value,diff=after-before,unit=props.line.unit||'盒';
   return `${diff===0?'盘点一致':diff>0?'盘盈'+diff+unit:'盘亏'+(-diff)+unit} · 盘前${before}${unit} · 盘后${after}${unit}`;
  });
  function setQty(raw){props.task.drafts[props.line.id]=raw;error.value=''}
  function adjust(n){const raw=Number(qty.value);setQty(String(Math.max(0,Math.min(999999,(Number.isFinite(raw)?raw:0)+n))))}
  function back(){if(props.busy)return;state.value.step=Math.max(1,state.value.step-1);error.value='';input.value=''}
  function next(){
   if(props.busy)return;
   error.value=quantityError(qty.value,props.line.occupied);if(error.value)return;
   if(state.value.step===1){state.value.step=2;document.activeElement?.blur();return}
   error.value=traceError(props.task,props.line);if(error.value)return;
   if(state.value.step===2){state.value.step=3;input.value='';document.activeElement?.blur();return}
   emit('finish');
  }
  function scan(){
   if(props.busy)return;
   const code=input.value.trim();error.value='';
   if(!/^\d{20}$/.test(code)){error.value='请输入20位追溯码';return}
   const used=props.task.lines.flatMap(l=>l.traceRecord?.codes||props.task.traceDrafts?.[l.id]?.codes||[]);
   if(used.some(c=>c.code===code)){error.value='该追溯码已扫描，请勿重复扫描';return}
   if(state.value.codes.length>=target.value){error.value='已达到盘后数量，请核对数量或删除多余追溯码';return}
   const entry=props.task.traceCatalog?.[code];
   if(!entry){error.value='演示数据未收录此码，请使用下方演示扫码';return}
   if(entry.productId!==props.line.productId){error.value='该追溯码不属于当前商品';return}
   state.value.codes.push({...entry,code});input.value='';
  }
  function sample(other=false){
   if(props.busy)return;
   if(state.value.codes.length>=target.value){error.value='已达到盘后数量，请核对数量或删除多余追溯码';return}
   props.task.traceCatalog ||= {};
   let hash=0;for(const c of props.task.id+':'+props.line.id)hash=(Math.imul(hash,31)+c.charCodeAt(0))>>>0;
   const seq=(props.task.traceSequence||0)+1;props.task.traceSequence=seq;
   const code='8'+String(hash).padStart(10,'0')+String(seq).padStart(9,'0');
   props.task.traceCatalog[code]={productId:props.line.productId,batch:other?(props.line.batch==='20260518'?'20260519':'20260518'):props.line.batch,expiry:other?'2028-04-30':props.line.expiry};
   input.value=code;scan();
  }
  function remove(i){if(props.busy)return;state.value.codes.splice(i,1);error.value=''}
  return{state,input,error,qty,target,result,removal,setQty,adjust,back,next,scan,sample,remove};
 },
 template:`<div class="trace-count" :data-step="state.step">
  <div v-if="state.step===1" class="active-layout trace-quantity">
   <div class="active-primary"><div class="active-photo-wrap"><img class="active-photo" :src="line.image||'./assets/m_pic_placeholder.webp'" @error="$event.currentTarget.src='./assets/m_pic_placeholder.webp'" alt="商品图片"></div><div class="active-info"><h2>{{line.name}} | {{line.spec}}</h2><p>批号{{line.batch}}/有效期 {{line.expiry}}</p></div></div>
   <div class="active-actions"><label class="after-stack"><span class="after-label">盘后数量</span><button type="button" class="quantity-step step-minus" @click="adjust(-1)" aria-label="盘后数量减一">−</button><input :id="'quantity-'+line.id" :value="qty" @input="setQty($event.target.value)" @focus="$event.target.select()" inputmode="numeric" autocomplete="off" enterkeyhint="done" aria-label="盘后数量" placeholder="请输入" :aria-invalid="!!error"><button type="button" class="quantity-step step-plus" @click="adjust(1)" aria-label="盘后数量加一">＋</button></label><button class="trace-arrow trace-next" :disabled="busy" @click="next" aria-label="下一步，扫描追溯码">下一步</button></div>
  </div>
  <div v-else-if="state.step===2" class="trace-layout">
   <div class="trace-main"><div class="trace-progress" aria-live="polite">已扫 <b>{{state.codes.length}}</b> / {{target}} 个</div>
    <form class="trace-scan" @submit.prevent="scan"><input v-model="input" aria-label="追溯码扫描输入" placeholder="扫描 / 输入20位追溯码" inputmode="numeric" enterkeyhint="done" autocomplete="off"><button type="submit" aria-label="录入追溯码">录入</button></form>
    <div class="trace-code-list"><div class="trace-code-row" v-for="(c,i) in state.codes" :key="c.code"><span>{{c.code}}</span><button @click="remove(i)" :aria-label="'删除追溯码 '+c.code"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 9v9M14 9v9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button></div><p v-if="!state.codes.length" class="trace-empty">{{target===0?'盘后数量为0，无需扫码':'请逐盒扫描商品追溯码'}}</p></div>
    <div class="trace-demo-tools"><span>演示扫码</span><button @click="sample(false)">本批次 +1</button><button @click="sample(true)">其他批次 +1</button></div>
   </div><div class="trace-side"><button class="trace-arrow trace-back" :disabled="busy" @click="back" aria-label="上一步，修改数量">上一步</button><button class="trace-arrow trace-next" :disabled="busy" @click="next" aria-label="下一步，查看盘点结果">下一步</button></div>
  </div>
  <div v-else class="trace-layout">
   <div class="trace-main trace-result"><strong class="trace-result-title">{{result}}</strong>
    <template v-if="removal.length"><p class="trace-result-note">请将以下商品从架上取下，放置待办区：</p><div class="trace-removals"><section v-for="g in removal" :key="g.batch+'|'+g.expiry" class="trace-removal"><p><b>{{g.batch}}</b> / {{g.expiry}} / 数量{{g.codes.length}}</p><div v-for="code in g.codes" :key="code">{{code.slice(0,-4)}}<b>{{code.slice(-4)}}</b></div></section></div></template>
    <template v-else><p class="trace-result-note">无需取货下架</p><div class="trace-success" aria-label="盘点结果核对完成"><svg viewBox="0 0 100 100" aria-hidden="true"><path d="M25 50L43 68L77 33" stroke="white" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg></div></template>
   </div><div class="trace-side"><button class="trace-arrow trace-back" :disabled="busy" @click="back" aria-label="上一步，核对追溯码">上一步</button><button class="trace-arrow trace-finish" :disabled="busy" @click="next" aria-label="确认盘点结果，下一个">下一个</button></div>
  </div>
  <div class="trace-dots" :aria-label="'第'+state.step+'步，共3步'"><i v-for="n in 3" :key="n" :class="{active:state.step===n}"></i></div>
  <p v-if="error" class="field-error" role="alert">{{error}}</p>
 </div>`
};
