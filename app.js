(() => {
  const $ = id => document.getElementById(id);
  const brl = n => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const pad = n => String(n).padStart(2, '0');
  const STORAGE_KEY = 'relogio_ganhos_dados_v4';
  const WELCOME_SEEN_KEY = 'relogio_ganhos_welcome_v1';
  const weekdays = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

  let running = false;
  let startedAt = null;
  let accumulatedMs = 0;
  let manualPeriodMode = false;
  let sessionStartTimeDisplay = '—';
  let sessionPausedTimeDisplay = '—';
  let manualEntries = [];

  function formatTimeOnly(timestamp) {
    if (!timestamp) return '—';
    const d = new Date(timestamp);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function parseMinutes(timeStr, defaultVal) {
    if (!timeStr || !timeStr.includes(':')) return defaultVal;
    const [h, m] = timeStr.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return defaultVal;
    return h * 60 + m;
  }

  function getLunchInterval() {
    const enabled = $('enableLunch').checked;
    if (!enabled) return null;
    const startMins = parseMinutes($('lunchStart').value, 720); // 12:00
    const endMins = parseMinutes($('lunchEnd').value, 792);     // 13:12
    if (endMins <= startMins) return null;
    return { startMins, endMins };
  }

  function loadState() {
    try {
      // Exibe modal informativo na primeira visita
      if (!localStorage.getItem(WELCOME_SEEN_KEY)) {
        $('welcomeModal').removeAttribute('hidden');
        $('welcomeModal').style.display = 'flex';
      }

      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.salary !== undefined) $('salary').value = data.salary;
      if (data.divisor !== undefined) $('divisor').value = data.divisor;
      if (data.customDivisor !== undefined) $('customDivisor').value = data.customDivisor;
      if (data.weekdayExtra !== undefined) $('weekdayExtra').value = data.weekdayExtra;
      if (data.weekendExtra !== undefined) $('weekendExtra').value = data.weekendExtra;
      if (data.holiday !== undefined) $('holiday').value = data.holiday;

      if (data.enableLunch !== undefined) $('enableLunch').checked = data.enableLunch;
      if (data.lunchStart) $('lunchStart').value = data.lunchStart;
      if (data.lunchEnd) $('lunchEnd').value = data.lunchEnd;

      if (data.manualPeriodMode) {
        $('enableFixedPeriod').checked = true;
        manualPeriodMode = true;
        if (data.customStart) $('customStart').value = data.customStart;
        if (data.customEnd) $('customEnd').value = data.customEnd;
      }

      if (data.simDsrDays !== undefined) $('simDsrDays').value = data.simDsrDays;
      if (data.simWorkDays !== undefined) $('simWorkDays').value = data.simWorkDays;
      if (data.simOtherDiscounts !== undefined) $('simOtherDiscounts').value = data.simOtherDiscounts;
      if (data.simIncludeInss !== undefined) $('simIncludeInss').value = data.simIncludeInss;

      running = Boolean(data.running);
      startedAt = data.startedAt || null;
      accumulatedMs = data.accumulatedMs || 0;
      sessionStartTimeDisplay = data.sessionStartTimeDisplay || '—';
      sessionPausedTimeDisplay = data.sessionPausedTimeDisplay || '—';
      manualEntries = Array.isArray(data.manualEntries) ? data.manualEntries : [];
    } catch (e) {
      console.error('Falha ao restaurar dados do localStorage', e);
    }
  }

  function saveState() {
    try {
      const data = {
        salary: $('salary').value,
        divisor: $('divisor').value,
        customDivisor: $('customDivisor').value,
        weekdayExtra: $('weekdayExtra').value,
        weekendExtra: $('weekendExtra').value,
        holiday: $('holiday').value,
        enableLunch: $('enableLunch').checked,
        lunchStart: $('lunchStart').value,
        lunchEnd: $('lunchEnd').value,
        manualPeriodMode: $('enableFixedPeriod').checked,
        customStart: $('customStart').value,
        customEnd: $('customEnd').value,
        simDsrDays: $('simDsrDays').value,
        simWorkDays: $('simWorkDays').value,
        simOtherDiscounts: $('simOtherDiscounts').value,
        simIncludeInss: $('simIncludeInss').value,
        running,
        startedAt,
        accumulatedMs,
        sessionStartTimeDisplay,
        sessionPausedTimeDisplay,
        manualEntries
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.error('Falha ao salvar dados no localStorage', e);
    }
  }

  $('closeWelcomeModal').addEventListener('click', () => {
    $('welcomeModal').setAttribute('hidden', '');
    $('welcomeModal').style.display = 'none';
    localStorage.setItem(WELCOME_SEEN_KEY, 'true');
  });

  // Controle de Abas
  $('tabBtnClock').addEventListener('click', () => {
    $('tabBtnClock').classList.add('active');
    $('tabBtnCalculator').classList.remove('active');
    $('tabClockView').hidden = false;
    $('tabCalculatorView').hidden = true;
  });

  $('tabBtnCalculator').addEventListener('click', () => {
    $('tabBtnCalculator').classList.add('active');
    $('tabBtnClock').classList.remove('active');
    $('tabClockView').hidden = true;
    $('tabCalculatorView').hidden = false;
    renderEntries();
    updateHolerite();
  });

  function divisor() {
    return $('divisor').value === 'custom' ? Math.max(1, Number($('customDivisor').value) || 220) : Number($('divisor').value);
  }

  function rates() {
    const base = Math.max(0, Number($('salary').value) || 0) / divisor();
    return {
      base,
      weekday: base * (1 + Number($('weekdayExtra').value)),
      weekend: base * (1 + Number($('weekendExtra').value)),
      holiday: base * 2
    };
  }

  function typeAt(d) {
    const day = d.getDay();
    const mins = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
    if ($('holiday').value === 'yes') return { name: 'Feriado', rate: rates().holiday, isWorked: true, isExtra: true };
    if (day === 0 || day === 6) return { name: day === 0 ? 'Domingo' : 'Sábado', rate: rates().weekend, isWorked: true, isExtra: true };

    const lunch = getLunchInterval();
    if (lunch && mins >= lunch.startMins && mins < lunch.endMins) {
      return { name: 'Almoço / Intervalo', rate: 0, isWorked: false, isExtra: false };
    }

    const lunchStart = lunch ? lunch.startMins : 720;
    const lunchEnd = lunch ? lunch.endMins : 720;

    if ((mins >= 480 && mins < lunchStart) || (mins >= lunchEnd && mins < 1080)) {
      return { name: 'Hora normal', rate: rates().base, isWorked: true, isExtra: false };
    }
    return { name: 'Hora extra', rate: rates().weekday, isWorked: true, isExtra: true };
  }

  function calculatePeriod(start, end) {
    if (end <= start) return { earned: 0, workedMs: 0, normalMs: 0, extraMs: 0, extraEarned: 0 };
    let totalEarned = 0, workedMs = 0, normalMs = 0, extraMs = 0, extraEarned = 0, cursor = start;
    const lunch = getLunchInterval();

    while (cursor < end) {
      const d = new Date(cursor);
      const nextMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
      const baseDayMs = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

      const msMarkers = [8 * 3600000, 18 * 3600000];
      if (lunch) {
        msMarkers.push(lunch.startMins * 60000);
        msMarkers.push(lunch.endMins * 60000);
      }

      const boundaries = msMarkers
        .map(ms => baseDayMs + ms)
        .filter(t => t > cursor);

      const next = Math.min(end, nextMidnight, ...boundaries);
      const t = typeAt(new Date(cursor));
      const segmentMs = next - cursor;

      if (t.isWorked) {
        workedMs += segmentMs;
        const segmentVal = (segmentMs / 3600000) * t.rate;
        totalEarned += segmentVal;
        if (t.isExtra) {
          extraMs += segmentMs;
          extraEarned += segmentVal;
        } else {
          normalMs += segmentMs;
        }
      }
      cursor = next;
    }
    return { earned: totalEarned, workedMs, normalMs, extraMs, extraEarned };
  }

  function duration(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  }

  function formatDateTimeLocal(date) {
    const y = date.getFullYear();
    const m = pad(date.getMonth() + 1);
    const d = pad(date.getDate());
    const hh = pad(date.getHours());
    const mm = pad(date.getMinutes());
    return `${y}-${m}-${d}T${hh}:${mm}`;
  }

  function triggerFireworks() {
    if (typeof confetti === 'function') {
      const count = 220;
      const defaults = { origin: { y: 0.65 }, zIndex: 100001 };

      function fire(particleRatio, opts) {
        confetti(Object.assign({}, defaults, opts, {
          particleCount: Math.floor(count * particleRatio)
        }));
      }

      fire(0.25, { spread: 26, startVelocity: 55 });
      fire(0.2, { spread: 60 });
      fire(0.35, { spread: 100, decay: 0.91, scalar: 0.8 });
      fire(0.1, { spread: 120, startVelocity: 25, decay: 0.92, scalar: 1.2 });
      fire(0.1, { spread: 120, startVelocity: 45 });
    }
  }

  function speakText(text) {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'pt-BR';
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      window.speechSynthesis.speak(utterance);
    }
  }

  function showCelebrationModal(earnedText) {
    $('celebrationValue').textContent = earnedText;
    const modal = $('celebrationModal');
    modal.removeAttribute('hidden');
    modal.style.display = 'flex';

    triggerFireworks();

    const voiceMessage = `Muito bem! Hoje você ganhou ${earnedText}. Continue assim, seu esforço faz a diferença!`;
    speakText(voiceMessage);
  }

  function hideCelebrationModal() {
    const modal = $('celebrationModal');
    modal.setAttribute('hidden', '');
    modal.style.display = 'none';
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }

  $('closeCelebration').addEventListener('click', (e) => {
    e.stopPropagation();
    hideCelebrationModal();
  });

  $('celebrationModal').addEventListener('click', (e) => {
    if (e.target === $('celebrationModal')) {
      hideCelebrationModal();
    }
  });

  function toggleManualFields() {
    const isManual = $('enableFixedPeriod').checked;
    manualPeriodMode = isManual;
    const fields = $('fixedPeriodFields');
    if (isManual) {
      fields.style.opacity = '1';
      fields.style.pointerEvents = 'auto';
      if (!$('customStart').value) {
        const todayAtStart = new Date();
        todayAtStart.setHours(8, 0, 0, 0);
        $('customStart').value = formatDateTimeLocal(todayAtStart);
      }
    } else {
      fields.style.opacity = '0.5';
      fields.style.pointerEvents = 'none';
    }
    tick();
    saveState();
  }

  function toggleLunchFields() {
    const isEnabled = $('enableLunch').checked;
    const fields = $('lunchFields');
    fields.style.opacity = isEnabled ? '1' : '0.5';
    fields.style.pointerEvents = isEnabled ? 'auto' : 'none';
    tick();
    saveState();
  }

  function tick() {
    const now = new Date();
    $('now').textContent = now.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }) + ' · ' + now.toLocaleTimeString('pt-BR', { hour12: false });

    const t = typeAt(now);
    const r = rates();
    $('normalRate').textContent = brl(r.base);
    $('weekdayRate').textContent = brl(r.weekday);
    $('weekendRate').textContent = brl(r.weekend);
    $('holidayRate').textContent = brl(r.holiday);
    $('perMinute').textContent = brl(t.rate / 60);
    $('perSecond').textContent = 'R$ ' + (t.rate / 3600).toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
    $('kind').textContent = t.name;

    if (t.name === 'Almoço / Intervalo') {
      $('rateText').textContent = `Intervalo de almoço (R$ 0,00) · ${weekdays[now.getDay()]}`;
    } else {
      $('rateText').textContent = `Taxa atual: ${brl(t.rate)}/hora · ${weekdays[now.getDay()]}`;
    }

    // Exibição do intervalo de almoço configurado
    const lunchInfo = getLunchInterval();
    if (lunchInfo && $('enableLunch').checked) {
      $('lunchTimeDisplay').textContent = `${$('lunchStart').value} às ${$('lunchEnd').value}`;
    } else {
      $('lunchTimeDisplay').textContent = 'Sem intervalo';
    }

    if (manualPeriodMode) {
      $('start').disabled = true;
      $('pause').disabled = true;
      $('reset').disabled = true;

      const startVal = $('customStart').value;
      const endVal = $('customEnd').value;

      if (!startVal) {
        $('status').textContent = '● Defina a hora de início';
        $('status').className = 'pill';
        $('elapsed').textContent = '00:00:00';
        $('earned').textContent = brl(0);
        $('startedTime').textContent = '—';
        $('pausedTime').textContent = '—';
        return;
      }

      const startTime = new Date(startVal).getTime();
      const endTime = endVal ? new Date(endVal).getTime() : now.getTime();

      $('startedTime').textContent = formatTimeOnly(startTime);
      $('pausedTime').textContent = endVal ? formatTimeOnly(endTime) : '—';

      if (isNaN(startTime) || (endVal && isNaN(endTime))) {
        $('status').textContent = '● Data inválida';
        $('status').className = 'pill';
        return;
      }

      if (endTime < startTime) {
        $('status').textContent = '● Fim antes do início';
        $('status').className = 'pill';
        $('elapsed').textContent = '00:00:00';
        $('earned').textContent = brl(0);
        return;
      }

      const res = calculatePeriod(startTime, endTime);
      $('elapsed').textContent = duration(res.workedMs);
      $('earned').textContent = brl(res.earned);
      $('status').textContent = endVal ? '● Período fixo concluído' : '● Calculando até agora';
      $('status').className = endVal ? 'pill' : 'pill counting';
      return;
    }

    $('reset').disabled = false;
    $('start').disabled = running;
    $('pause').disabled = !running;

    $('startedTime').textContent = sessionStartTimeDisplay;
    $('pausedTime').textContent = sessionPausedTimeDisplay;

    let totalEarned = 0;
    let totalWorkedMs = 0;

    if (accumulatedMs > 0) {
      const pastStart = startedAt ? (startedAt - accumulatedMs) : (Date.now() - accumulatedMs);
      const pastEnd = startedAt ? startedAt : Date.now();
      const pastRes = calculatePeriod(pastStart, pastEnd);
      totalEarned += pastRes.earned;
      totalWorkedMs += pastRes.workedMs;
    }
    if (running && startedAt !== null) {
      const liveRes = calculatePeriod(startedAt, Date.now());
      totalEarned += liveRes.earned;
      totalWorkedMs += liveRes.workedMs;
    }

    $('elapsed').textContent = duration(totalWorkedMs);
    $('earned').textContent = brl(totalEarned);
    $('status').textContent = running ? '● Contando' : '● Parado';
    $('status').className = running ? 'pill counting' : 'pill';
  }

  $('start').addEventListener('click', () => {
    if (running || manualPeriodMode) return;
    const now = Date.now();
    startedAt = now;
    running = true;
    if (sessionStartTimeDisplay === '—') {
      sessionStartTimeDisplay = formatTimeOnly(now);
    }
    sessionPausedTimeDisplay = '—';
    saveState();
    tick();
  });

  $('pause').addEventListener('click', () => {
    if (!running || manualPeriodMode) return;
    const now = Date.now();
    accumulatedMs += now - startedAt;
    startedAt = null;
    running = false;
    sessionPausedTimeDisplay = formatTimeOnly(now);
    saveState();
    tick();

    const earnedText = $('earned').textContent;
    showCelebrationModal(earnedText);
  });

  $('reset').addEventListener('click', () => {
    if (manualPeriodMode) return;
    running = false;
    startedAt = null;
    accumulatedMs = 0;
    sessionStartTimeDisplay = '—';
    sessionPausedTimeDisplay = '—';
    saveState();
    tick();
  });

  $('downloadPdf').addEventListener('click', () => {
    const originalTitle = document.title;
    const now = new Date();
    const dateStr = now.toLocaleDateString('pt-BR').replace(/\//g, '-');
    document.title = `Relatorio_Ganhos_${dateStr}`;
    window.print();
    document.title = originalTitle;
  });

  $('enableFixedPeriod').addEventListener('change', toggleManualFields);
  $('enableLunch').addEventListener('change', toggleLunchFields);

  $('fillToday').addEventListener('click', () => {
    const today = new Date();
    const start = new Date(today);
    start.setHours(8, 0, 0, 0);
    const end = new Date(today);
    end.setHours(18, 0, 0, 0);
    $('customStart').value = formatDateTimeLocal(start);
    $('customEnd').value = formatDateTimeLocal(end);
    if (!$('enableFixedPeriod').checked) {
      $('enableFixedPeriod').checked = true;
      toggleManualFields();
    } else {
      tick();
      saveState();
    }
  });

  $('divisor').addEventListener('change', () => {
    $('customWrap').hidden = $('divisor').value !== 'custom';
    tick();
    saveState();
    updateHolerite();
  });

  // ========== LÓGICA DO SIMULADOR DE HOLERITE E LANÇAMENTOS ==========
  function calcInssProgressive(gross) {
    // Tabela oficial progressiva do INSS 2026
    const brackets = [
      { max: 1518.00, rate: 0.075 },
      { max: 2793.88, rate: 0.09 },
      { max: 4190.83, rate: 0.12 },
      { max: 8157.41, rate: 0.14 }
    ];
    let inss = 0;
    let prevMax = 0;

    for (const b of brackets) {
      if (gross > prevMax) {
        const taxable = Math.min(gross, b.max) - prevMax;
        inss += taxable * b.rate;
        prevMax = b.max;
      } else {
        break;
      }
    }
    return inss;
  }

  function updateHolerite() {
    const baseSalary = Math.max(0, Number($('salary').value) || 0);
    $('holeriteBase').textContent = brl(baseSalary);

    let totalExtraMs = 0;
    let totalExtraVal = 0;

    manualEntries.forEach(e => {
      totalExtraMs += e.extraMs || 0;
      totalExtraVal += e.extraVal || 0;
    });

    $('holeriteExtrasHours').textContent = duration(totalExtraMs);
    $('holeriteExtrasVal').textContent = '+ ' + brl(totalExtraVal);

    // DSR sobre Horas Extras: (Total HE / Dias Úteis) * Dias de Descanso
    const dsrDays = Math.max(0, Number($('simDsrDays').value) || 0);
    const workDays = Math.max(1, Number($('simWorkDays').value) || 25);
    const dsrVal = (totalExtraVal / workDays) * dsrDays;
    $('holeriteDsrVal').textContent = '+ ' + brl(dsrVal);

    const grossSalary = baseSalary + totalExtraVal + dsrVal;
    $('holeriteTotalGross').textContent = brl(grossSalary);

    // Desconto de INSS
    const includeInss = $('simIncludeInss').value === 'yes';
    const inssVal = includeInss ? calcInssProgressive(grossSalary) : 0;
    $('holeriteInssVal').textContent = '- ' + brl(inssVal);

    // Outros descontos
    const otherDiscounts = Math.max(0, Number($('simOtherDiscounts').value) || 0);
    $('holeriteOtherDiscountsVal').textContent = '- ' + brl(otherDiscounts);

    const netSalary = Math.max(0, grossSalary - inssVal - otherDiscounts);
    $('holeriteNet').textContent = brl(netSalary);
  }

  function renderEntries() {
    const tbody = $('entriesTableBody');
    if (!manualEntries.length) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color:var(--muted); padding:16px;">Nenhum lançamento adicionado ainda. Preencha acima e clique em "+ Adicionar à Lista".</td></tr>`;
      return;
    }

    tbody.innerHTML = manualEntries.map((e, idx) => {
      const dStart = new Date(e.start);
      const dEnd = new Date(e.end);
      const dateStr = dStart.toLocaleDateString('pt-BR');
      const startStr = `${pad(dStart.getHours())}:${pad(dStart.getMinutes())}`;
      const endStr = `${pad(dEnd.getHours())}:${pad(dEnd.getMinutes())}`;

      return `
        <tr>
          <td>${dateStr}</td>
          <td>${startStr}</td>
          <td>${endStr}</td>
          <td>${duration(e.workedMs)}</td>
          <td>${duration(e.normalMs)}</td>
          <td style="color:var(--green); font-weight:700;">${duration(e.extraMs)}</td>
          <td>${e.rateLabel}</td>
          <td style="color:var(--green); font-weight:700;">${brl(e.extraVal)}</td>
          <td><button type="button" class="btn-del" data-idx="${idx}">Excluir</button></td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('.btn-del').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        const i = Number(ev.target.getAttribute('data-idx'));
        manualEntries.splice(i, 1);
        saveState();
        renderEntries();
        updateHolerite();
      });
    });
  }

  $('btnAddEntry').addEventListener('click', () => {
    const startStr = $('entryStart').value;
    const endStr = $('entryEnd').value;
    if (!startStr || !endStr) {
      alert('Por favor, informe a Data e Hora de Início e de Fim.');
      return;
    }

    const start = new Date(startStr).getTime();
    const end = new Date(endStr).getTime();
    if (end <= start) {
      alert('A hora de fim deve ser posterior à hora de início.');
      return;
    }

    const res = calculatePeriod(start, end);
    const selectedRate = $('entryRateType').value;
    const baseHour = rates().base;

    let rateLabel = '50%';
    let extraVal = res.extraEarned;

    if (selectedRate !== 'auto') {
      const mult = Number(selectedRate);
      rateLabel = `${Math.round(mult * 100)}%`;
      extraVal = (res.extraMs / 3600000) * (baseHour * (1 + mult));
    } else {
      const day = new Date(start).getDay();
      rateLabel = (day === 0 || day === 6) ? '100% (Fim de semana)' : '50% (Dia útil)';
    }

    manualEntries.push({
      start,
      end,
      workedMs: res.workedMs,
      normalMs: res.normalMs,
      extraMs: res.extraMs,
      extraVal,
      rateLabel,
      desc: $('entryDesc').value || ''
    });

    $('entryStart').value = '';
    $('entryEnd').value = '';
    $('entryDesc').value = '';

    saveState();
    renderEntries();
    updateHolerite();
  });

  // Inputs automáticos da aba de holerite
  ['simDsrDays', 'simWorkDays', 'simOtherDiscounts', 'simIncludeInss'].forEach(id => {
    $(id).addEventListener('input', () => {
      saveState();
      updateHolerite();
    });
  });

  document.addEventListener('visibilitychange', tick);
  window.addEventListener('focus', tick);

  ['salary', 'customDivisor', 'weekdayExtra', 'weekendExtra', 'holiday', 'customStart', 'customEnd', 'lunchStart', 'lunchEnd'].forEach(id => {
    $(id).addEventListener('input', () => {
      tick();
      saveState();
      updateHolerite();
    });
  });

  // Inicialização com valores padrão para o form de lançamento
  const nowDef = new Date();
  const defStart = new Date(nowDef);
  defStart.setHours(8, 0, 0, 0);
  const defEnd = new Date(nowDef);
  defEnd.setHours(21, 26, 0, 0);
  $('entryStart').value = formatDateTimeLocal(defStart);
  $('entryEnd').value = formatDateTimeLocal(defEnd);

  loadState();
  $('customWrap').hidden = $('divisor').value !== 'custom';
  toggleManualFields();
  toggleLunchFields();
  renderEntries();
  updateHolerite();

  setInterval(tick, 1000);
  tick();
})();
