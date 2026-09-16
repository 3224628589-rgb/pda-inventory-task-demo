import { createApp, ref, reactive, computed, watch, nextTick, onMounted, onUnmounted } from './vendor/vue.js';
import { createFixture, createLargeTask, createRealInventoryTask, countdown, doneCount, isDone, orderedLines, quantityError, timeText, variance, taskTitle } from './data.js';
import { PdaNav, GradientButton, EmptyState, SearchField, TaskCard, InventoryCard, BottomSheet } from './components.js';

import { InventoryFlow } from './inventory-flow.js';
const SESSION_KEY = 'pda-inventory-v3';
function readState() {
  let state;
  try {
    const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY));
    if(saved?.schema===1 && Array.isArray(saved.tasks) && saved.tasks.length && Array.isArray(saved.stock) && Array.isArray(saved.history)) state=saved;
  } catch {}
  state ||= createFixture();
  const large=createLargeTask(),largeIndex=state.tasks.findIndex(task=>task.id==='t100');
  if(largeIndex<0)state.tasks.push(large);
  else if(state.tasks[largeIndex].fixtureVersion!==large.fixtureVersion){
    const previous=state.tasks[largeIndex],progress=new Map(previous.lines.map(line=>[line.id,line]));
    large.lines=large.lines.map(line=>{const old=progress.get(line.id);return old?{...line,after:old.after,countedAt:old.countedAt,recordBefore:old.recordBefore,stockQuantity:old.stockQuantity}:line});
    large.direction=previous.direction||large.direction;large.current=previous.current||large.current;large.drafts=previous.drafts||{};large.completedAt=previous.completedAt;
    state.tasks.splice(largeIndex,1,large);
  }
  const real=createRealInventoryTask(),realIndex=state.tasks.findIndex(task=>task.id==='treal');
  if(realIndex<0)state.tasks.push(real);
  else if(state.tasks[realIndex].fixtureVersion!==real.fixtureVersion)state.tasks.splice(realIndex,1,real);
  return state;
}

createApp({
  components:{PdaNav,GradientButton,EmptyState,SearchField,TaskCard,InventoryCard,BottomSheet,InventoryFlow},
  setup(){
    const state=reactive(readState());
    const route=ref(location.hash.slice(1)||'/mine');
    const taskTab=ref(sessionStorage.getItem('pda-task-tab')||'todo');
    const now=ref(Date.now()), query=ref(''), historyQuery=ref(''), historyDate=ref('');
    const sheet=ref(null), sheetProduct=ref(null), selectedStock=ref(null), selectedHistory=ref(null);
    const temporaryQuantity=ref(''), temporaryError=ref(''), scanCode=ref(''), toast=ref('');
    const errors=reactive({}), busy=ref(false), savingTemp=ref(false), listRef=ref(null);
    let toastTimer, searchTimer, ticker, busyTimer, scrollRequest=0;
    const page=computed(()=>route.value==='/mine'?'mine':route.value.startsWith('/task/')?'detail':route.value==='/tasks'?'tasks':route.value==='/history'?'history':'temp');
    const task=computed(()=>state.tasks.find(t=>t.id===route.value.split('/')[2])||null);
    const title=computed(()=>({mine:'我的',temp:'临时盘点',tasks:'盘点任务',detail:'盘点任务',history:'临时盘点历史'})[page.value]);
    const lines=computed(()=>task.value?orderedLines(task.value):[]);
    const taskCounts=computed(()=>({todo:state.tasks.filter(t=>!isDone(t)).length,done:state.tasks.filter(isDone).length}));
    const visibleTasks=computed(()=>state.tasks.filter(t=>isDone(t)===(taskTab.value==='done')));
    const searchMatches=computed(()=>{
      const q=query.value.trim().toLowerCase(); if(!q)return[];
      return state.stock.filter(l=>[l.name,l.spec,l.barcode,l.slot].some(s=>s.toLowerCase().includes(q)));
    });
    const goods=computed(()=>[...new Map(searchMatches.value.map(l=>[l.productId,l])).values()]);
    const batchOptions=computed(()=>{
      if(sheetProduct.value?.slot)return state.stock.filter(l=>l.slot.toLowerCase()===sheetProduct.value.slot.toLowerCase());
      return state.stock.filter(l=>l.productId===sheetProduct.value?.productId);
    });
    const localDate=t=>{const d=new Date(t);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
    const historyRows=computed(()=>state.history.filter(h=>{
      const matchDate=!historyDate.value||localDate(h.createdAt)===historyDate.value;
      const q=historyQuery.value.trim().toLowerCase();
      return matchDate && (!q || [h.sn,h.line.name,h.line.slot,h.line.batch].some(x=>x.toLowerCase().includes(q)));
    }));
    function notify(message){toast.value=message;clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.value='',2300)}
    function persist(){try{sessionStorage.setItem(SESSION_KEY,JSON.stringify(state))}catch{notify('浏览器存储不可用，刷新后进度会重置')}}
    watch(state,persist,{deep:true});
    watch(taskTab,value=>{try{sessionStorage.setItem('pda-task-tab',value)}catch{}});
    function navigate(path){sheet.value=null;if(location.hash.slice(1)!==path)location.hash=path;else route.value=path}
    function onHash(){route.value=location.hash.slice(1)||'/mine';sheet.value=null;toast.value='';clearTimeout(toastTimer)}
    function goBack(){if(sheet.value){closeSheet();return}navigate(page.value==='detail'?'/tasks':page.value==='temp'?'/mine':'/temp')}
    function openTask(id){navigate('/task/'+id)}
    function search(){
      clearTimeout(searchTimer);
      const q=query.value.trim();if(!q)return;
      const exactSlot=state.stock.find(l=>l.slot.toLowerCase()===q.toLowerCase());
      const exactProduct=state.stock.find(l=>l.barcode===q);
      if(exactSlot){sheetProduct.value={slot:exactSlot.slot};sheet.value='batches'}
      else if(exactProduct){sheetProduct.value={...exactProduct,slot:undefined};sheet.value='batches'}
    }
    watch(query,()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{if(page.value==='temp'&&!sheet.value)search()},500)});
    function selectGoods(product){sheetProduct.value={...product,slot:undefined};sheet.value='batches'}
    function selectBatch(line){selectedStock.value=line;temporaryQuantity.value='';temporaryError.value='';sheet.value='count';nextTick(()=>document.getElementById('temporary-quantity')?.focus())}
    function closeSheet(){clearTimeout(searchTimer);sheet.value=null;temporaryError.value=''}
    function cancelCount(){temporaryError.value='';sheet.value='batches'}
    function saveTemporary(){
      if(savingTemp.value||!selectedStock.value)return;
      temporaryError.value=quantityError(temporaryQuantity.value,selectedStock.value.occupied);if(temporaryError.value)return;
      savingTemp.value=true;
      const source=selectedStock.value, timestamp=Date.now(), after=Number(temporaryQuantity.value);
      const record={id:'h'+timestamp,sn:'LS'+localDate(timestamp).replaceAll('-','')+String(state.history.length+1).padStart(4,'0'),createdAt:timestamp,line:{...source,after,countedAt:timestamp}};
      state.history.unshift(record);source.before=after;sheet.value=null;savingTemp.value=false;notify('临时盘点已完成');
    }
    function openScan(){scanCode.value='';sheet.value='scan'}
    function submitScan(){if(!scanCode.value.trim())return;query.value=scanCode.value.trim();sheet.value=null;search()}
    function openHistory(history){selectedHistory.value=history;sheet.value='history-detail'}
    const sheetTitle=computed(()=>({batches:sheetProduct.value?.slot?'选择货位商品批次':'选择商品批次',count:'输入盘后数量',scan:'扫描商品 / 货位','history-detail':'临时盘点详情'})[sheet.value]);
    onMounted(()=>{window.addEventListener('hashchange',onHash);ticker=setInterval(()=>now.value=Date.now(),1000);persist()});
    onUnmounted(()=>{window.removeEventListener('hashchange',onHash);clearInterval(ticker);clearTimeout(searchTimer);clearTimeout(toastTimer);clearTimeout(busyTimer)});
    return{notify,state,page,title,task,taskTab,now,query,historyQuery,historyDate,visibleTasks,taskCounts,lines,goods,historyRows,sheet,sheetTitle,sheetProduct,selectedStock,selectedHistory,batchOptions,temporaryQuantity,temporaryError,savingTemp,scanCode,toast,doneCount,isDone,countdown,timeText,variance,taskTitle,navigate,goBack,openTask,search,selectGoods,selectBatch,closeSheet,cancelCount,saveTemporary,openScan,submitScan,openHistory};
  },
  template:`<div class="pda-app">
    <div class="pda-app" style="min-height:0" :inert="sheet?true:undefined">
    <pda-nav v-if="page!=='mine'" :title="title" :back="true" @back="goBack"/>
    <template v-if="page==='mine'"><main class="page-scroll mine-page"><div class="mine-profile"><img src="./assets/m_mine_userpic.webp" alt=""><div><h1>小刘</h1><p>邻药汇演示门店 | 138****0000</p></div></div><section class="mine-stats"><div v-for="(label,i) in ['今日订单','今日条目','本月订单','本月条目']"><strong>{{[24,68,520,1386][i]}}</strong><small>{{label}}</small></div></section><section class="mine-functions"><h2>常用功能</h2><div class="mine-grid"><button v-for="(label,i) in ['盘点','破损','店内调拨','主商品库','版本管理','入库核准','签收','工单协作','采退待办','天气预报']" @click="i===0?navigate('/temp'):notify('本 Demo 演示盘点流程')"><img :src="'./assets/'+['m_inventory_count','m_damiage_count','m_store_inside_trans','m_main_inventory_goods','m_version_update_check','m_entry_approval','m_entry_sign','m_entry_collaboration','m_entry_mine_order_caitui','m_weather_entrance'][i]+'.webp'" alt=""><span>{{label}}</span></button></div></section></main><nav class="mine-tabs"><button @click="notify('本 Demo 演示盘点流程')"><img src="./assets/m_main_unselect.webp" alt="">首页</button><button class="active"><img src="./assets/m_mine_select.webp" alt="">我的</button></nav></template>
    <template v-if="page==='temp'">
      <main class="page-scroll temp-page"><search-field v-model="query" @search="search" @scan="openScan"/>
        <empty-state v-if="!query.trim()" text="输入品名、规格搜索"/>
        <template v-else-if="goods.length"><p class="result-summary">找到 {{goods.length}} 个商品</p><div class="search-results"><button class="goods-card" v-for="goodsInfo in goods" :key="goodsInfo.productId" @click="selectGoods(goodsInfo)"><img class="product-image" src="./assets/m_pic_placeholder.webp" alt="商品暂无图片"><div class="product-copy"><h2>{{goodsInfo.name}}</h2><p>{{goodsInfo.spec}}</p><p>{{goodsInfo.brand}}</p><p>{{goodsInfo.barcode}}</p></div><span class="chevron">›</span></button></div></template>
        <empty-state v-else text="未找到商品，请更换关键词"/>
      </main><footer class="bottom-actions"><gradient-button @click="navigate('/tasks')">盘点任务</gradient-button><button class="outline-button" @click="navigate('/history')">临时盘点历史</button></footer>
    </template>
    <template v-else-if="page==='tasks'">
      <nav class="tabs" role="tablist" aria-label="任务状态"><button role="tab" :aria-selected="taskTab==='todo'" :class="{active:taskTab==='todo'}" @click="taskTab='todo'">未完成 <small>{{taskCounts.todo}}</small></button><button role="tab" :aria-selected="taskTab==='done'" :class="{active:taskTab==='done'}" @click="taskTab='done'">已完成 <small>{{taskCounts.done}}</small></button></nav>
      <main class="page-scroll tasks-body" role="tabpanel"><task-card v-for="item in visibleTasks" :key="item.id" :task="item" :now="now" @open="openTask"/><empty-state v-if="!visibleTasks.length" :text="taskTab==='done'?'暂无已完成任务':'暂无未完成任务'"><button class="return-link" @click="navigate('/temp')">返回临时盘点</button></empty-state></main>
    </template>
    <template v-else-if="page==='detail' && task">
      <inventory-flow :key="task.id" :task="task" @notice="notify" @finished="taskTab='done'">
        <template #summary><section class="task-toolbar"><h2>{{taskTitle(task)}}</h2><div class="task-meta row between"><span>已盘 {{doneCount(task)}} / {{task.lines.length}} 项</span><span v-if="!isDone(task)" class="countdown" :class="{overdue:task.deadline<now}">{{countdown(task.deadline,now)}}</span><span v-else class="task-completed">已完成</span></div><div class="progress-track"><i :style="{width:doneCount(task)/task.lines.length*100+'%'}"></i></div></section></template>
      </inventory-flow>
    </template>
    <template v-else-if="page==='history'">
      <div class="history-tools"><input v-model="historyQuery" placeholder="商品、货位、单号" aria-label="搜索临时盘点历史"><input type="date" v-model="historyDate" aria-label="盘点日期"><button v-if="historyDate || historyQuery" @click="historyDate='';historyQuery=''">清空</button></div>
      <main class="page-scroll"><button v-for="record in historyRows" :key="record.id" class="history-card" @click="openHistory(record)"><div class="row between"><h2>{{record.sn}}</h2><span class="badge blue">已完成</span></div><p class="history-product">{{record.line.name}} · {{record.line.spec}}</p><p>{{record.line.slot}} · 批次 {{record.line.batch}}</p><p>盘前 {{record.line.before}} → 盘后 {{record.line.after}} · {{variance(record.line)}}</p><div class="task-bottom"><span>{{timeText(record.createdAt)}}</span><span class="task-link">查看详情 ›</span></div></button><empty-state v-if="!historyRows.length" text="暂无临时盘点记录"/></main>
    </template>
    </div>
    <bottom-sheet v-if="sheet" :key="sheet" :title="sheetTitle" @close="closeSheet">
      <template v-if="sheet==='batches'"><div class="sheet-product" v-if="sheetProduct?.name"><img class="product-image" src="./assets/m_pic_placeholder.webp" alt="商品暂无图片"><div><h2>{{sheetProduct.name}}</h2><p>{{sheetProduct.spec}}</p><p>{{sheetProduct.brand}}</p></div></div><button class="batch-option" v-for="option in batchOptions" :key="option.id" @click="selectBatch(option)"><div class="row between"><strong class="slot">{{option.slot}}</strong><span>总库存 <b>{{option.before}}</b> {{option.unit}} ›</span></div><p v-if="sheetProduct?.slot">{{option.name}} {{option.spec}}</p><p>批次 {{option.batch}} · 有效期 {{option.expiry}}</p></button><p class="sheet-empty" v-if="!batchOptions.length">该商品暂无可盘点批次</p></template>
      <template v-else-if="sheet==='count' && selectedStock"><div class="sheet-product"><img class="product-image" src="./assets/m_pic_placeholder.webp" alt="商品暂无图片"><div><h2>{{selectedStock.name}}</h2><p>{{selectedStock.spec}}</p><p>{{selectedStock.brand}}</p></div></div><div class="row between"><strong class="slot">{{selectedStock.slot}}</strong><span class="muted" style="font-size:12px">批次 {{selectedStock.batch}}</span></div><p class="sheet-label">盘前数量 {{selectedStock.before}}{{selectedStock.unit}}<span v-if="selectedStock.occupied"> · 已占用 {{selectedStock.occupied}}{{selectedStock.unit}}</span></p><form @submit.prevent="saveTemporary"><input id="temporary-quantity" class="sheet-input" v-model="temporaryQuantity" @input="temporaryError=''" placeholder="请输入盘后数量" aria-label="临时盘后数量" inputmode="numeric" enterkeyhint="done" autocomplete="off" :aria-invalid="!!temporaryError"><p class="field-error" v-if="temporaryError" role="alert">{{temporaryError}}</p></form></template>
      <template v-else-if="sheet==='scan'"><p class="scan-note">演示扫码：输入货位或商品条码。<br>示例货位：A-01-02；条码：6900000000024</p><form @submit.prevent="submitScan"><input class="sheet-input" v-model="scanCode" placeholder="输入扫描结果" aria-label="扫描结果"></form></template>
      <template v-else-if="sheet==='history-detail' && selectedHistory"><div class="history-detail"><h2>{{selectedHistory.line.name}}</h2><p class="muted">{{selectedHistory.line.spec}}</p><p><strong class="slot">{{selectedHistory.line.slot}}</strong> · 批次 {{selectedHistory.line.batch}}</p><div class="result-big"><div class="row between"><span>盘前 <strong>{{selectedHistory.line.before}}</strong></span><span>盘后 <strong>{{selectedHistory.line.after}}</strong></span><b :class="selectedHistory.line.after>=selectedHistory.line.before?'gain':'loss'">{{variance(selectedHistory.line)}}</b></div><p>盘点变量：盘后{{selectedHistory.line.after}} − 盘前{{selectedHistory.line.before}} = {{selectedHistory.line.after-selectedHistory.line.before}}</p></div><p>盘点时间 {{timeText(selectedHistory.createdAt,true)}}</p><p class="muted">{{selectedHistory.sn}}</p></div></template>
      <template #footer v-if="sheet==='count'"><button @click="cancelCount">取消</button><button @click="saveTemporary" :disabled="savingTemp">确定</button></template>
      <template #footer v-else-if="sheet==='scan'"><button @click="closeSheet">取消</button><button @click="submitScan" :disabled="!scanCode.trim()">确定</button></template>
    </bottom-sheet>
    <div v-if="toast" class="toast" role="status">{{toast}}</div>
  </div>`
}).mount('#app');
