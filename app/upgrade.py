from pathlib import Path
p=Path('work/app.html');s=p.read_text()
s=s.replace('<span>前门 / FRONT</span>','<span>窗台 / WINDOWS</span>').replace('<span>面向黑板 ↑</span>','<span>前门 / FRONT DOOR</span>')
s=s.replace("[[2,4,'第一组'],[5,7,'第二组'],[7,8,'加座'],[8,10,'第三组'],[11,13,'第四组']]","[[2,4,'第四组'],[5,7,'第三组'],[7,8,'加座'],[8,10,'第二组'],[11,13,'第一组']]")
s=s.replace('<button class="small" id="seatMenuBtn">','<button class="small" id="rotateBtn">↻ 大组轮换</button><button class="small" id="seatMenuBtn">')
s=s.replace('</nav>','<button data-page="call"><span class="icon">◎</span>随机点名</button></nav>')
s=s.replace("['seat','roster','exams']","['seat','roster','exams','call']")
s=s.replace("const titles={seat:","const titles={call:['ROLL CALL / 随机点名','让每位同学，都有参与的机会','按考试成绩分类抽取，支持一轮内不重复点名。'],seat:")
s=s.replace('renderWaiting();renderRoster();renderExams();','renderWaiting();renderRoster();renderExams();renderCall();')
s=s.replace('#rosterView,#examsView{display:none!important}', '#rosterView,#examsView,#callView{display:none!important}')
s=s.replace('</style>', '''.call-categories{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin:20px 0}.call-category{text-align:left;padding:17px;background:#fff}.call-category.active{border:2px solid var(--green);background:var(--mint)}.call-category b{display:block;font-size:24px;margin:9px 0}.call-category small{color:var(--muted);line-height:1.6}.call-stage{text-align:center;padding:36px 20px;background:linear-gradient(130deg,#f6f9f2,#edf4ee);border-radius:12px;margin:20px}.call-name{font-size:52px;font-weight:600;letter-spacing:5px;min-height:74px;overflow-wrap:anywhere}.call-detail{color:#718675;font-size:13px;min-height:38px;padding:8px}.call-stage button{padding:12px 35px;font-size:16px}.call-history{padding:0 22px 20px;color:var(--muted);font-size:12px;line-height:2}.call-controls{display:flex;gap:16px;align-items:center;flex-wrap:wrap}.call-controls label{font-size:13px}.call-rules{color:var(--muted);font-size:12px;line-height:1.8}.call-members{margin-top:18px}.call-members summary{padding:16px;cursor:pointer;color:#687d6b}.call-name.flash{animation:reveal .3s ease-out}@keyframes reveal{from{transform:scale(.92);opacity:.2}to{transform:scale(1);opacity:1}}@media(max-width:760px){.call-categories{grid-template-columns:repeat(2,1fr)}.call-category:last-child{grid-column:1/-1}nav{flex-wrap:wrap}.call-name{font-size:38px}}
</style>''')
section='''<section id="callView" class="hidden"><div class="panel"><div class="toolbar"><div class="toolbar-left"><label for="callExam">排名考试</label><select id="callExam"></select><label for="callSubject">排名科目</label><select id="callSubject"></select></div><div class="call-controls"><label class="switch-label"><input type="checkbox" id="noRepeat" checked>本轮不重复</label><button id="resetRound" class="small">开始新一轮</button></div></div><div style="padding:0 20px"><div id="callCategories" class="call-categories"></div><p class="call-rules">默认比例：优秀前 30% · 中等中间 40% · 后进生后 30%。仅对有有效成绩的学生排名；同分按平均名次归入同一类，实际人数可能偏离比例。缺考或未录入成绩单列。<br>切换考试、科目或修改名单／当前成绩会开始新一轮；本轮记录仅在此次打开期间保留。</p></div><div class="call-stage"><div class="eyebrow" id="callPoolLabel">等待点名</div><div id="callName" class="call-name" aria-live="polite">准备好了吗？</div><div id="callDetail" class="call-detail"></div><button id="drawStudent" class="primary">随机点名</button><p id="callRemaining" class="call-rules"></p></div><div class="call-history" id="callHistory"></div></div><details class="panel call-members"><summary>查看当前分类名单及排名</summary><div class="table-wrap" id="callMembers"></div></details></section>
'''
s=s.replace('<div class="footer-note">',section+'<div class="footer-note">')
js='''
// Group numbers run right to left; the two central seats do not rotate.
function rotateGroups(){
 if(!Object.keys(state.seats).some(k=>k.startsWith('R'))){toast('常规座位还没有学生，请先安排座位');return;}
 checkpoint();const next={};for(const [seat,id] of Object.entries(state.seats)){
  if(seat.startsWith('X'))next[seat]=id;
  else{const row=Number(seat[1]),col=Number(seat[3]);next[`R${row}C${col<=2?col+6:col-2}`]=id;}
 }
 state.seats=next;selected=null;changed('大组已轮换：1 → 2 → 3 → 4 → 1；中央加座保持原位');
}
const callLabels={all:'全班学生',excellent:'优秀',middle:'中等',support:'后进生',ungraded:'暂无成绩'};
let callCategory='all',calledIds=new Set(),callLog=[],callResult=null,callSignature='';
function rankedGroups(){
 const ex=getExam(), ranked=[], ungraded=[];
 for(const p of state.students){const score=ex?.scores[p.id]?.[state.subject];if(typeof score==='number'&&Number.isFinite(score))ranked.push({student:p,score});else ungraded.push({student:p,score:null,rank:null,category:'ungraded'});}
 ranked.sort((a,b)=>b.score-a.score||a.student.id.localeCompare(b.student.id,'zh-CN',{numeric:true}));
 const groups={all:[],excellent:[],middle:[],support:[],ungraded};
 for(let i=0;i<ranked.length;){let j=i+1;while(j<ranked.length&&ranked[j].score===ranked[i].score)j++;const avg=(i+1+j)/2,percent=(avg-.5)/ranked.length;const category=percent<=.3?'excellent':percent>=.7?'support':'middle';for(let k=i;k<j;k++){Object.assign(ranked[k],{rank:i+1,averageRank:avg,category});groups[category].push(ranked[k]);}i=j;}
 groups.all=[...ranked,...ungraded];return groups;
}
function syncCallRound(){const signature=JSON.stringify([state.examId,state.subject,state.students,getExam()?.scores]);if(signature!==callSignature){callSignature=signature;calledIds.clear();callLog=[];callResult=null;}}
function renderCall(){
 syncCallRound();const ex=getExam();$('#callExam').innerHTML=state.exams.length?state.exams.map(e=>`<option value="${esc(e.id)}">${esc(e.name)}</option>`).join(''):'<option value="">暂无考试</option>';$('#callExam').value=state.examId;$('#callExam').disabled=!state.exams.length;
 $('#callSubject').innerHTML=ex?ex.subjects.map(s=>`<option>${esc(s)}</option>`).join(''):'<option>总分</option>';$('#callSubject').value=state.subject;$('#callSubject').disabled=!ex;
 const groups=rankedGroups(),pool=groups[callCategory],noRepeat=$('#noRepeat').checked,available=pool.filter(p=>!noRepeat||!calledIds.has(p.student.id));
 $('#callCategories').innerHTML=Object.entries(callLabels).map(([key,label])=>`<button class="call-category ${callCategory===key?'active':''}" data-category="${key}" aria-pressed="${callCategory===key}">${label}<b>${groups[key].length} <small>人</small></b><small>${{all:'全部名单（含暂无成绩）',excellent:'成绩前 30%',middle:'成绩中间 40%',support:'成绩后 30%',ungraded:'缺考／未录入'}[key]}</small></button>`).join('');
 $('#callPoolLabel').textContent=`当前范围：${callLabels[callCategory]}`;
 $('#callName').textContent=callResult?callResult.student.name:'准备好了吗？';
 $('#callDetail').textContent=callResult?`学号 ${callResult.student.id} · ${studentSeat(callResult.student.id)?seatLabel(studentSeat(callResult.student.id)):'待安排座位'}`:ex?`${ex.name} · ${state.subject}`:'可先从全班点名；导入成绩后可按排名分类';
 $('#drawStudent').disabled=!available.length;$('#drawStudent').textContent=pool.length&&!available.length?'本类已全部点过':'随机点名';$('#callRemaining').textContent=`当前范围 ${pool.length} 人 · ${noRepeat?'本轮还可抽取':'可抽取'} ${available.length} 人`;
 $('#callHistory').textContent=callLog.length?'本轮已点名 '+callLog.length+' 次（最近 12 次）：'+callLog.slice(-12).reverse().map(x=>`${x.name}（${x.id}）`).join('、'):'本轮还没有点名记录。';
 $('#callMembers').innerHTML=pool.length?`<table><thead><tr><th>名次</th><th>学号</th><th>姓名</th><th>${esc(state.subject)}</th><th>分类</th><th>本轮状态</th></tr></thead><tbody>${pool.map(x=>`<tr><td>${x.rank??'—'}</td><td>${esc(x.student.id)}</td><td>${esc(x.student.name)}</td><td>${x.score??'—'}</td><td>${callLabels[x.category]}</td><td>${calledIds.has(x.student.id)?'已点名':'未点名'}</td></tr>`).join('')}</tbody></table>`:'<div class="table-empty">此分类暂无学生，请选择其他分类或导入成绩。</div>';
}
function drawStudent(){syncCallRound();const pool=rankedGroups()[callCategory].filter(p=>!$('#noRepeat').checked||!calledIds.has(p.student.id));if(!pool.length){renderCall();toast('此范围暂无可点名学生，可切换分类或开始新一轮');return null;}const choice=pool[Math.floor(Math.random()*pool.length)];calledIds.add(choice.student.id);callLog.push({id:choice.student.id,name:choice.student.name});callResult=choice;renderCall();const label=$('#callName');label.classList.remove('flash');void label.offsetWidth;label.classList.add('flash');return choice.student.id;}
$('#rotateBtn').onclick=rotateGroups;
$('#callExam').onchange=e=>{state.examId=e.target.value;changed();};
$('#callSubject').onchange=e=>{state.subject=e.target.value;changed();};
$('#callCategories').onclick=e=>{const b=e.target.closest('[data-category]');if(!b)return;callCategory=b.dataset.category;callResult=null;renderCall();};
$('#noRepeat').onchange=()=>{callResult=null;renderCall();};
$('#drawStudent').onclick=drawStudent;
$('#resetRound').onclick=()=>{calledIds.clear();callLog=[];callResult=null;renderCall();toast('已开始新一轮点名');};
'''
s=s.replace("render();setPage('seat');",js+"\nrender();setPage('seat');")
p.write_text(s)
Path('work/app.js').write_text(s.split('<script>')[-1].split('</script>')[0])
license=Path('work/vendor/LICENSE').read_text();lib=Path('work/vendor/xlsx.full.min.js').read_text()
Path('outputs/班序-班级管理.html').write_text(s.replace('/*XLSX_LIBRARY*/','/*\nSheetJS Community Edition 0.20.3\n'+license+'\n*/\n'+lib))
