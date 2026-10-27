(() => {
  const $ = id => document.getElementById(id);
  const brl = n => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const pad = n => String(n).padStart(2, '0');
  const STORAGE_KEY = 'relogio_ganhos_dados_v2';
  const weekdays = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

  let running = false;
  let startedAt = null;
  let accumulatedMs = 0;
  let manualPeriodMode = false;

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

      running = Boolean(data.running);
      startedAt = data.startedAt || null;
      accumulatedMs = data.accumulatedMs || 0;
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
        running,
        startedAt,
        accumulatedMs
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.error('Falha ao salvar dados no localStorage', e);
    }
  }

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
    if ($('holiday').value === 'yes') return { name: 'Feriado', rate: rates().holiday, isWorked: true };
    if (day === 0 || day === 6) return { name: day === 0 ? 'Domingo' : 'Sábado', rate: rates().weekend, isWorked: true };

    const lunch = getLunchInterval();
    if (lunch && mins >= lunch.startMins && mins < lunch.endMins) {
      return { name: 'Almoço / Intervalo', rate: 0, isWorked: false };
    }

    const lunchStart = lunch ? lunch.startMins : 720;
    const lunchEnd = lunch ? lunch.endMins : 720;

    if ((mins >= 480 && mins < lunchStart) || (mins >= lunchEnd && mins < 1080)) {
      return { name: 'Hora normal', rate: rates().base, isWorked: true };
    }
    return { name: 'Hora extra', rate: rates().weekday, isWorked: true };
  }

  function calculatePeriod(start, end) {
    if (end <= start) return { earned: 0, workedMs: 0 };
    let totalEarned = 0, workedMs = 0, cursor = start;
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
        totalEarned += (segmentMs / 3600000) * t.rate;
      }
      cursor = next;
    }
    return { earned: totalEarned, workedMs };
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
    // Atualização em tempo real do relógio oficial do topo
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

    if (manualPeriodMode) {
      $('start').disabled = true;
      $('pause').disabled = true;
      $('reset').disabled = true;

      const startVal = $('customStart').value;
      const endVal = $('customEnd').value;

      if (!startVal) {
        $('status').textContent = '● Defina a hora de início';
        $('elapsed').textContent = '00:00:00';
        $('earned').textContent = brl(0);
        return;
      }

      const startTime = new Date(startVal).getTime();
      const endTime = endVal ? new Date(endVal).getTime() : now.getTime();

      if (isNaN(startTime) || (endVal && isNaN(endTime))) {
        $('status').textContent = '● Data inválida';
        return;
      }

      if (endTime < startTime) {
        $('status').textContent = '● Fim antes do início';
        $('elapsed').textContent = '00:00:00';
        $('earned').textContent = brl(0);
        return;
      }

      const res = calculatePeriod(startTime, endTime);
      $('elapsed').textContent = duration(res.workedMs);
      $('earned').textContent = brl(res.earned);
      $('status').textContent = endVal ? '● Período fixo concluído' : '● Calculando até o momento atual';
      return;
    }

    $('reset').disabled = false;
    $('start').disabled = running;
    $('pause').disabled = !running;

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
    $('status').textContent = running ? '● Contando (em 2º plano)' : '● Parado';
  }

  $('start').addEventListener('click', () => {
    if (running || manualPeriodMode) return;
    startedAt = Date.now();
    running = true;
    saveState();
    tick();
  });

  $('pause').addEventListener('click', () => {
    if (!running || manualPeriodMode) return;
    accumulatedMs += Date.now() - startedAt;
    startedAt = null;
    running = false;
    saveState();
    tick();
  });

  $('reset').addEventListener('click', () => {
    if (manualPeriodMode) return;
    running = false;
    startedAt = null;
    accumulatedMs = 0;
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
  });

  document.addEventListener('visibilitychange', tick);
  window.addEventListener('focus', tick);

  ['salary', 'customDivisor', 'weekdayExtra', 'weekendExtra', 'holiday', 'customStart', 'customEnd', 'lunchStart', 'lunchEnd'].forEach(id => {
    $(id).addEventListener('input', () => {
      tick();
      saveState();
    });
  });

  loadState();
  $('customWrap').hidden = $('divisor').value !== 'custom';
  toggleManualFields();
  toggleLunchFields();

  // O tick é executado continuamente a cada segundo para manter o relógio visual sempre correndo
  setInterval(tick, 1000);
  tick();
})();
