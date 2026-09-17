import { realInventorySource } from './real-inventory.js';

export function createFixture(now = Date.now()) {
  const products = [
    { productId: 'g1', name: '感冒灵颗粒', spec: '10g×9袋', brand: '华南制药有限公司', barcode: '6900000000017', unit: '盒' },
    { productId: 'g2', name: '布洛芬缓释胶囊', spec: '0.3g×24粒', brand: '华东制药有限公司', barcode: '6900000000024', unit: '盒' },
    { productId: 'g3', name: '氯雷他定片', spec: '10mg×6片', brand: '康宁制药有限公司', barcode: '6900000000031', unit: '盒' },
    { productId: 'g4', name: '维生素C片', spec: '0.1g×100片', brand: '华南制药有限公司', barcode: '6900000000048', unit: '瓶' },
    { productId: 'g5', name: '医用外科口罩', spec: '独立包装 10只装', brand: '安心医疗用品有限公司', barcode: '6900000000055', unit: '袋' }
  ];
  const make = (id, product, slot, batch, before, occupied = 0) => ({ id, ...products[product], slot, batch, before, occupied, expiry: '2028-05-31', after: null, countedAt: null });
  products.push({productId:'g6',name:'正红花油',spec:'0.3g',brand:'示例药业',barcode:'6900000000062',unit:'瓶'});
  products[0].name='999感冒灵颗粒';products[0].spec='9g×10袋';
  const lines=[make('l0',0,'A-0102-02-02','20260602',12),make('l1',1,'A-0102-02-03','20260602',10),make('l2',1,'A-0102-02-04','20260602',12,2),make('l3',5,'A-0102-02-04','20260602',2),make('l4',0,'A-0102-02-05','20260602',2),make('l5',2,'A-0102-02-06','20260602',16),make('l6',3,'A-0102-02-07','20260602',24)];
  lines[0].after=12;lines[0].countedAt=now-600000;
  lines[1].after=12;lines[1].countedAt=now-300000;
  lines.forEach(l=>l.stockQuantity=l.after??l.before);
  return {
    schema: 1,
    tasks: [
      { id: 't1', title: 'A区货位盘点', sn: 'PD202609150001', range: 'A-0102-02-02 至 A-0102-02-07', method: '按货位', note: '请逐一核对货位与批次，按实物数量盘点。', deadline: now + 16220000, current: 'l2', direction: 'asc', drafts: {}, createdAt: now - 3600000, completedAt: null, lines },
      { id: 't2', title: '高动销商品盘点', sn: 'PD202609150002', range: '近30天高动销商品 · 2个货位', method: '按动销', note: '重点核对常销商品的实物库存。', deadline: now + 73200000, current: 'm1', direction: 'asc', drafts: {}, createdAt: now - 3000000, completedAt: null, lines: [make('m1',0,'B-01-01','20260501',18),make('m2',2,'B-02-01','20260512',9)] },
      { id: 't3', title: 'B区补充盘点', sn: 'PD202609140003', range: 'B-03-01', method: '按商品', note: '请尽快完成。', deadline: now - 4820000, current: 'n1', direction: 'asc', drafts: {}, createdAt: now - 86400000, completedAt: null, lines: [make('n1',4,'B-03-01','20260701',6)] },
      { id: 't4', title: '常备商品日常盘点', sn: 'PD202609140004', range: 'C-01-01 至 C-01-02', method: '按商品', note: '日常库存复核。', deadline: now - 3600000, current: null, direction: 'asc', drafts: {}, createdAt: now - 86400000, completedAt: now - 7200000, lines: [ {...make('p1',0,'C-01-01','20260501',12), after:13,countedAt:now-7320000},{...make('p2',3,'C-01-02','20260611',20),after:19,countedAt:now-7200000} ] }
    ],
    stock: lines.map(l => ({ ...l, after:null,countedAt:null })),
    history: [
      { id:'h1', sn:'LS202609150002', createdAt:now-1200000, line:{...lines[3], before:18, after:16, countedAt:now-1200000} },
      { id:'h2', sn:'LS202609140001', createdAt:now-86400000, line:{...lines[4], before:23, after:24, countedAt:now-86400000} }
    ]
  };
}

export function createLargeTask(now=Date.now()) {
 const sample=createFixture(now).stock;
 const lines=Array.from({length:100},(_,i)=>{
  const product=sample[i%sample.length],before=6+(i*7)%45;
  // The first five locations each contain three real-world-style product/batch lines.
  const slotNumber=i<15?Math.floor(i/3)+1:i+1;
  return {...product,id:'large-'+String(i+1).padStart(3,'0'),slot:'D-01-'+String(slotNumber).padStart(3,'0'),batch:'2026'+String(6+i%3).padStart(2,'0')+String(1+i%28).padStart(2,'0'),before,stockQuantity:before,occupied:0,after:null,countedAt:null};
 });
 return {id:'t100',fixtureVersion:2,title:'100行大盘点任务',sn:'PD202609160100',range:'100条商品批次 · 90个货位',method:'按货位',note:'含5个一货位三批次案例，用于连续盘点和首尾定位演示。',deadline:now+16220000,current:lines[0].id,direction:'asc',drafts:{},createdAt:now-3600000,completedAt:null,lines};
}

export function createRealInventoryTask(now=Date.now()) {
 const lines=realInventorySource.lines.map(line=>({...line}));
 return {
  id:'treal',fixtureVersion:realInventorySource.sampledAt,
  title:'真实门店货位盘点（脱敏）',sn:'PD202609160888',
  range:`${realInventorySource.slotCount}个货位 · ${realInventorySource.lineCount}条商品批次`,method:'按货位',
  note:'来自真实门店货位库存的只读脱敏抽样，商品、批次、数量与图片均为真实数据。',
  deadline:now+21620000,current:lines[0]?.id||null,direction:'asc',drafts:{},
  createdAt:now-900000,completedAt:null,lines
 };
}

export function createReviewTask(now=Date.now()) {
 const source=createFixture(now).tasks[0].lines;
 const lines=source.map((line,index)=>({
  ...line,id:'review-'+index,after:null,countedAt:null,recordBefore:null,
  stockQuantity:line.before,initialAfter:null,initialCountedAt:null,reviewing:false,reviewedAt:null
 }));
 const counted=(index,after,minutesAgo)=>{const line=lines[index];line.after=after;line.countedAt=now-minutesAgo*60000;line.stockQuantity=after};
 counted(0,12,12);
 counted(1,10,9);
 lines[1].initialAfter=8;lines[1].initialCountedAt=now-11*60000;lines[1].reviewedAt=lines[1].countedAt;
 lines[2].before=10;lines[2].occupied=0;
 counted(2,12,6);
 lines[2].initialAfter=12;lines[2].initialCountedAt=now-8*60000;lines[2].reviewedAt=lines[2].countedAt;
 lines[3].initialAfter=1;lines[3].initialCountedAt=now-5*60000;lines[3].reviewing=true;
 return {
  id:'treview',fixtureVersion:2,title:'动销品盘点复盘演示',sn:'PD202609150005',
  range:'A-0102-02-02 至 A-0102-02-07',method:'按货位',
  note:'A-0102-02-04的正红花油正在复盘；完成后可展开该货位，对比初盘与复盘结果。',
  deadline:now+16220000,current:lines[3].id,direction:'asc',drafts:{},createdAt:now-3600000,completedAt:null,
  reviewSelectionIds:[lines[2].id,lines[3].id],lines
 };
}

export const doneCount = task => task.lines.filter(l => l.countedAt !== null).length;
export const isDone = task => task.completedAt !== null;
const collator = new Intl.Collator('zh-CN', {numeric:true});
export const orderedLines = task => [...task.lines].sort((a,b) => {
  const key = collator.compare(a.slot,b.slot) || collator.compare(a.productId,b.productId) || collator.compare(a.batch,b.batch) || collator.compare(a.id,b.id);
  return task.direction === 'desc' ? -key : key;
});
export function variance(line) {
  const diff = line.after - line.before;
  return diff === 0 ? '账实相符' : (diff > 0 ? `盘盈${diff}` : `盘亏${Math.abs(diff)}`);
}

export function varianceAt(line, after) {
 const diff = Number(after) - Number(line.before);
 return diff === 0 ? '账实相符' : (diff > 0 ? `盘盈${diff}` : `盘亏${Math.abs(diff)}`);
}

export function resultText(line, after, prefix='') {
 const value=Number(after),before=Number(line.before),result=varianceAt(line,value);
 const equation=value===before?`盘后${value}=盘前${before}`:value>before?`盘后${value}-盘前${before}`:`盘前${before}-盘后${value}`;
 return `${prefix}${result}=${equation}`;
}
export function quantityError(raw, occupied = 0) {
  if (raw === '' || raw === undefined || raw === null) return '请输入盘后数量';
  if (!/^\d+$/.test(String(raw)) || !Number.isSafeInteger(Number(raw)) || Number(raw)>999999) return '请输入0–999999的整数';
  if (Number(raw) < occupied) return `盘后数量不能小于已占用数量${occupied}`;
  return '';
}
export function timeText(timestamp, full = false) {
  const date = new Date(timestamp);
  const p=n=>String(n).padStart(2,'0');
  return `${full ? `${date.getFullYear()}-` : ''}${p(date.getMonth()+1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}
export function countdown(deadline, now) {
  const diff = deadline - now;
  const seconds = Math.max(0, Math.ceil(Math.abs(diff)/1000));
  const h = Math.floor(seconds/3600), m = Math.floor(seconds%3600/60), s = seconds%60;
  return `${diff < 0 ? '已超时' : '剩余'}${h}h${String(m).padStart(2,'0')}min${String(s).padStart(2,'0')}s`;
}

// Display adapter keeps saved inventory progress while migrating example task names.
export function taskTitle(task) {
 const names={'A区货位盘点':'动销品盘点20260808','高动销商品盘点':'动销品盘点20260825','B区补充盘点':'高货值盘点20260820'};
 return `${task.sn}-${names[task.title] || task.title}`;
}
export function dateText(timestamp) { return timeText(timestamp,true).split(' ')[0]; }
