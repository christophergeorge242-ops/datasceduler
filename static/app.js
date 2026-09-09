const tasks = [];
const busyBlocks = [];
const $ = (s) => document.querySelector(s);
const form = $('#task-form');
const list = $('#task-list');
const deadline = $('#deadline');
deadline.value = localScheduleContext().currentDate;

async function saveState() {
  await fetch('/api/state', {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({tasks, busyBlocks})});
}

function formatDate(d) { return new Date(d + 'T12:00:00').toLocaleDateString('en-US', {month:'short', day:'numeric'}); }
function localScheduleContext() {
  const now = new Date();
  const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  return { currentDate: localDate, currentMinutes: now.getHours() * 60 + now.getMinutes() };
}
function updateHeader() {
  const now = new Date();
  $('#date-label').textContent = now.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'}).toUpperCase();
  $('#task-count').textContent = tasks.length;
  $('#progress-text').textContent = `${tasks.length} of ${tasks.length} planned`;
  $('#progress-pct').textContent = tasks.length ? '100%' : '0%';
  $('#progress-bar').style.width = tasks.length ? '100%' : '0%';
}
function updateInsight(text) {
  if (text) $('#habit-insight').textContent = text;
}
function openDeadlineEditor(task, node) {
  if (node.querySelector('.deadline-editor')) return;
  const editor = document.createElement('form');
  editor.className = 'deadline-editor';
  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.setAttribute('aria-label', 'New deadline date');
  dateInput.value = task.deadline;
  dateInput.required = true;
  const timeInput = document.createElement('input');
  timeInput.type = 'time';
  timeInput.setAttribute('aria-label', 'New due time');
  timeInput.value = task.dueTime || '23:59';
  timeInput.required = true;
  const save = document.createElement('button');
  save.type = 'submit';
  save.textContent = 'Save';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  cancel.onclick = () => editor.remove();
  editor.append(dateInput, timeInput, save, cancel);
  editor.onsubmit = (event) => {
    event.preventDefault();
    task.deadline = dateInput.value;
    task.dueTime = timeInput.value;
    renderTasks();
    generate();
    saveState();
  };
  node.appendChild(editor);
  dateInput.focus();
}
function renderTasks() {
  list.innerHTML = '';
  tasks.forEach((task, index) => {
    const node = $('#task-template').content.firstElementChild.cloneNode(true);
    node.dataset.priority = task.priority;
    node.querySelector('strong').textContent = task.name;
    node.querySelector('small').textContent = `${task.duration} min · ${task.priority} · due ${formatDate(task.deadline)} at ${displayTime(task.dueTime || '23:59')}`;
    node.querySelector('.edit-deadline').onclick = () => openDeadlineEditor(task, node);
    node.querySelector('.remove-task').onclick = () => { tasks.splice(index,1); renderTasks(); generate(); saveState(); };
    list.appendChild(node);
  });
  updateHeader();
}
function displayTime(value) {
  const [hour, minute] = value.split(':').map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}
function renderBusyBlocks() {
  const container = $('#busy-list');
  container.innerHTML = '';
  busyBlocks.forEach((block, index) => {
    const item = document.createElement('div');
    item.className = 'busy-item';
    item.innerHTML = `<span>${block.title}</span><time>${displayTime(block.start)}–${displayTime(block.end)}</time><button aria-label="Remove unavailable time">×</button>`;
    item.querySelector('button').onclick = () => { busyBlocks.splice(index, 1); renderBusyBlocks(); generate(); saveState(); };
    container.appendChild(item);
  });
}
async function generate() {
  const empty = $('#empty-state'), timeline = $('#timeline');
  if (!tasks.length) { empty.hidden = false; timeline.innerHTML = ''; return; }
  empty.hidden = true;
  const response = await fetch('/api/schedule', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({tasks, busyBlocks, ...localScheduleContext()})});
  const result = await response.json();
  const {schedule} = result;
  updateInsight(result.habitInsight);
  timeline.innerHTML = '';
  schedule.forEach(task => {
    if (task.unscheduled) return;
    const row = document.createElement('div'); row.className = 'time-row';
    row.innerHTML = `<div class="time-label">${task.start}</div><article class="event ${task.priority.toLowerCase()}"><div><strong>${task.name}</strong><small>${task.duration} min · ${task.predictedWindow} · ${Math.round(task.predictedCompletion * 100)}% likely</small></div><div class="event-meta"><strong>${task.end}</strong><span class="deadline">Due ${formatDate(task.deadline)} at ${displayTime(task.dueTime || '23:59')}</span><div class="feedback"><button type="button" data-result="true">Done</button><button type="button" data-result="false">Skip</button></div></div></article>`;
    row.querySelectorAll('[data-result]').forEach(button => {
      button.onclick = async () => {
        const feedback = await fetch('/api/feedback', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({task, completed:button.dataset.result === 'true', window:task.predictedWindow})});
        const result = await feedback.json();
        updateInsight(result.habitInsight);
        generate();
      };
    });
    timeline.appendChild(row);
  });
}
form.addEventListener('submit', e => { e.preventDefault(); tasks.push({name:$('#task-name').value.trim(), deadline:deadline.value, dueTime:$('#due-time').value, duration:+$('#duration').value, priority:$('#priority').value, preferredTime:$('#preferredTime').value, difficulty:$('#difficulty').value}); form.reset(); deadline.value = localScheduleContext().currentDate; $('#due-time').value = '23:59'; renderTasks(); generate(); saveState(); });
$('#busy-form').addEventListener('submit', e => { e.preventDefault(); const title = $('#busy-title').value.trim(); const start = $('#busy-start').value; const end = $('#busy-end').value; if (title && start < end) { busyBlocks.push({title, start, end}); e.target.reset(); $('#busy-start').value = '10:00'; $('#busy-end').value = '11:00'; renderBusyBlocks(); generate(); saveState(); } });
$('#generate-btn').onclick = generate;
$('#clear-btn').onclick = () => { tasks.length = 0; busyBlocks.length = 0; renderTasks(); renderBusyBlocks(); generate(); saveState(); };
async function restoreState() {
  try {
    const response = await fetch('/api/state');
    const saved = await response.json();
    tasks.push(...(saved.tasks || []));
    updateInsight(saved.habitInsight);
    busyBlocks.push(...(saved.busyBlocks || []));
  } catch (error) { console.warn('Saved planner data could not be loaded.', error); }
  renderTasks(); renderBusyBlocks(); generate();
}
restoreState();
