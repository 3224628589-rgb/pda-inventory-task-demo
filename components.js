import { computed, nextTick, onMounted, onUnmounted, ref } from './vendor/vue.js?v=2026.09.17.3';
import { countdown, doneCount, isDone, timeText, variance, taskTitle, dateText } from './data.js?v=2026.09.17.3';

export const PdaNav = {
  props: ['title', 'back', 'action'], emits:['back','action'],
  template:`<header class="pda-nav"><button v-if="back" class="icon-button nav-back" aria-label="返回" @click="$emit('back')"><img src="./assets/m_arrow_left_black_activity.webp" alt=""></button><h1>{{title}}</h1><button v-if="action" class="nav-action" @click="$emit('action')">{{action}}</button><slot /></header>`
};
export const GradientButton = {props:['disabled','type'],emits:['click'],template:`<button class="gradient-button" :type="type || 'button'" :disabled="disabled" @click="$emit('click',$event)"><slot/></button>`};
export const EmptyState = {props:['text'],template:`<div class="empty-state"><img src="./assets/m_hint_empty.webp" alt=""><p>{{text}}</p><slot/></div>`};
export const SearchField = {
  props:['modelValue','placeholder'], emits:['update:modelValue','search','scan'],
  template:`<form class="search-area" @submit.prevent="$emit('search')"><div class="search-field"><button aria-label="搜索" type="submit"><img src="./assets/m_search_pink.webp" alt=""></button><input aria-label="搜索商品或货位" :value="modelValue" @input="$emit('update:modelValue',$event.target.value)" :placeholder="placeholder || '输入品名、规格、条码或货位'" enterkeyhint="search"><button v-if="modelValue" type="button" aria-label="清空搜索" @click="$emit('update:modelValue','')"><img src="./assets/m_icon_clear.webp" alt=""></button></div><button class="icon-button scan" type="button" aria-label="扫码" @click="$emit('scan')"><img src="./assets/m_scan_indicator.webp" alt=""></button></form>`
};
export const TaskCard = {
  props:['task','now'], emits:['open'],
  setup(){return{countdown,doneCount,isDone,timeText,taskTitle,dateText}},
  template:`<button class="task-card" :data-task="task.id" @click="$emit('open',task.id)"><h2>{{taskTitle(task)}}<span v-if="task.phase==='review'" class="phase-badge">复盘</span></h2><div class="task-meta row between"><span>{{task.phase==='review'?'已复盘':'已盘'}} {{doneCount(task)}} / {{task.lines.length}} 项</span><span v-if="!isDone(task)" class="countdown" :class="{overdue:task.deadline<now}">{{countdown(task.deadline,now)}}</span><span v-else class="task-completed">完成于{{timeText(task.completedAt,true).slice(0,-3)}}</span></div><div class="progress-track"><i :style="{width:doneCount(task)/task.lines.length*100+'%'}"></i></div><div class="task-bottom"><span>创建于{{dateText(task.createdAt)}}——截止{{dateText(task.deadline)}}</span><span class="task-link">{{isDone(task)?'查看详情':doneCount(task)===task.lines.length?'提交任务':doneCount(task)?(task.phase==='review'?'继续复盘':'继续盘点'):(task.phase==='review'?'开始复盘':'开始盘点')}}<span class="chevron">›</span></span></div></button>`
};
export const InventoryCard = {
  props:['line','active','index','draft','error','readonly','busy'], emits:['select','draft','complete'],
  components:{GradientButton}, setup(){return{timeText,variance}},
  template:`<article class="inventory-card" :class="{'is-active':active,'is-counted':line.countedAt!==null}" :data-line="line.id" :data-counted="line.countedAt!==null">
    <button class="card-heading" :disabled="line.countedAt!==null || readonly" :aria-expanded="active" @click="$emit('select',line.id)">
      <div class="row between"><div class="slot-heading"><span class="line-index">{{String(index+1).padStart(2,'0')}}</span><strong class="slot">{{line.slot}}</strong></div><span class="line-state" :class="{current:active,finished:line.countedAt!==null}">{{line.countedAt!==null?'✓ 已盘点':active?'正在盘点':'未盘点'}}</span></div>
      <div class="product-summary"><img v-if="active" class="product-image" src="./assets/m_pic_placeholder.webp" alt="商品暂无图片"><div class="product-copy"><h2>{{line.name}}</h2><p>{{line.spec}}<template v-if="active"> / {{line.unit}}</template></p><p v-if="active">{{line.brand}}</p><p v-if="active" class="barcode">{{line.barcode}}</p></div><span v-if="!active && line.countedAt===null" class="chevron">›</span></div>
      <div class="batch-row"><span>批次 <b>{{line.batch}}</b></span><span>有效期 {{line.expiry}}</span></div>
    </button>
    <form v-if="active" class="count-form" @submit.prevent="$emit('complete',line.id)">
      <div class="quantity-panel"><div class="before-quantity"><span>盘前数量</span><p><b>{{line.before}}</b><small>{{line.unit}}</small></p></div><label :for="'quantity-'+line.id">盘后数量<div class="quantity-input"><input :id="'quantity-'+line.id" :value="draft ?? ''" @input="$emit('draft',line.id,$event.target.value)" inputmode="numeric" enterkeyhint="done" autocomplete="off" placeholder="请输入" :aria-invalid="!!error" :aria-describedby="error ? 'error-'+line.id : undefined"><small>{{line.unit}}</small></div></label></div>
      <p class="occupied" v-if="line.occupied">已占用 {{line.occupied}}{{line.unit}}，盘后数量须包含已占用库存</p>
      <p v-if="error" class="field-error" :id="'error-'+line.id" role="alert">{{error}}</p>
      <gradient-button type="submit" :disabled="busy"><span>{{busy?'保存中…':'盘点完毕'}}</span><img src="./assets/m_wave_sorting_finish.webp" alt=""></gradient-button>
    </form>
    <div v-else-if="line.countedAt!==null" class="counted-result"><div class="row between"><span>盘前 <b>{{line.before}}</b> → 盘后 <b>{{line.after}}</b></span><strong class="variance" :class="line.after>line.before?'gain':line.after<line.before?'loss':'equal'">{{variance(line)}}</strong></div><p>盘点变量：盘后{{line.after}} − 盘前{{line.before}} = {{line.after-line.before>0?'+':''}}{{line.after-line.before}}</p><time :datetime="new Date(line.countedAt).toISOString()">盘点时间 {{timeText(line.countedAt)}}</time></div>
    <div v-else class="pending-quantity">盘前数量 <strong>{{line.before}}</strong><span>{{line.unit}}</span></div>
  </article>`
};
export const BottomSheet = {
  props:['title'], emits:['close'],
  setup(props,{emit}){
    const dialog=ref(null);let prior;
    const key=e=>{if(e.key==='Escape'){e.preventDefault();emit('close');}if(e.key==='Tab'){const all=[...dialog.value.querySelectorAll('button:not(:disabled), input, select, [tabindex="0"]')];const first=all[0],last=all.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}};
    onMounted(async()=>{prior=document.activeElement;await nextTick();dialog.value?.querySelector('input, button')?.focus();document.addEventListener('keydown',key)});
    onUnmounted(()=>{document.removeEventListener('keydown',key);prior?.focus({preventScroll:true})});return{dialog};
  },
  template:`<div class="sheet-backdrop" @click.self="$emit('close')"><section class="bottom-sheet" role="dialog" aria-modal="true" :aria-label="title" ref="dialog"><header><h2>{{title}}</h2><button class="icon-button" aria-label="关闭" @click="$emit('close')"><img src="./assets/m_close_dialog.webp" alt=""></button></header><div class="sheet-body"><slot/></div><footer v-if="$slots.footer"><slot name="footer"/></footer></section></div>`
};
