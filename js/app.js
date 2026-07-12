/* app.js — UI 상태와 이벤트 연결 */
(() => {
  const els = {
    fileInput: document.getElementById('fileInput'),
    pasteToggle: document.getElementById('pasteToggle'),
    pastePanel: document.getElementById('pastePanel'),
    pasteArea: document.getElementById('pasteArea'),
    pasteSubmit: document.getElementById('pasteSubmit'),
    pasteCancel: document.getElementById('pasteCancel'),
    langMode: document.getElementById('langMode'),
    ttsToggle: document.getElementById('ttsToggle'),
    settingsToggle: document.getElementById('settingsToggle'),
    settingsPanel: document.getElementById('settingsPanel'),
    apiKeyInput: document.getElementById('apiKeyInput'),
    apiKeySave: document.getElementById('apiKeySave'),
    apiKeyClear: document.getElementById('apiKeyClear'),
    statusLine: document.getElementById('statusLine'),
    mainArea: document.getElementById('mainArea'),
    emptyState: document.getElementById('emptyState'),
    sentenceList: document.getElementById('sentenceList'),
    scrollTrack: document.getElementById('scrollTrack'),
    scrollThumb: document.getElementById('scrollThumb'),
    scrollPos: document.getElementById('scrollPos'),
    bottomBar: document.getElementById('bottomBar'),
    loadbar: document.getElementById('loadbar'),
    loadbarToggle: document.getElementById('loadbarToggle'),
    loadbarToggleIcon: document.getElementById('loadbarToggleIcon'),
    loadbarBody: document.getElementById('loadbarBody'),
    statusLineCollapsed: document.getElementById('statusLineCollapsed'),
    selectionSummary: document.getElementById('selectionSummary'),
    saveProgressBtn: document.getElementById('saveProgressBtn'),
    exportBtn: document.getElementById('exportBtn'),
  };

  const STATE_KEY = 'vocab-anki:state';

  /** @type {{ id:number, text:string, lang:string, tokens: Array }[]} */
  let sentences = [];
  let rawSourceText = '';
  let rawFilename = '';

  function setStatus(msg, isError) {
    els.statusLine.textContent = msg || '';
    els.statusLine.style.color = isError ? 'var(--danger)' : '';
    els.statusLineCollapsed.textContent = msg || '';
    els.statusLineCollapsed.style.color = isError ? 'var(--danger)' : '';
  }

  // ---------- 언어별 폰트 클래스 ----------
  function langClass(lang) {
    return lang === 'ru' ? 'lang-ru' : 'lang-en';
  }

  // ---------- 토큰 span 생성 ----------
  function buildTokenSpan(tok, sIdx) {
    const span = document.createElement('span');
    span.textContent = tok.text;
    if (tok.isSpace) {
      span.className = 'token space';
    } else {
      span.className = 'token' + (tok.selected ? ' selected' : '');
      span.tabIndex = 0;
      span.addEventListener('click', () => toggleToken(sIdx, tok.i));
      span.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggleToken(sIdx, tok.i);
        }
      });
    }
    return span;
  }

  // ---------- 문장 하나(li) 생성 - 보기 모드 / 수정 모드 공용 ----------
  function buildSentenceItemEl(s, sIdx) {
    const li = document.createElement('li');
    li.className = 'sentence-item';
    li.dataset.sIdx = String(sIdx);

    if (s.editing) {
      const idxEl = document.createElement('div');
      idxEl.className = 'sentence-index';
      idxEl.textContent = `${sIdx + 1} / ${sentences.length}`;
      li.appendChild(idxEl);

      const ta = document.createElement('textarea');
      ta.className = 'edit-textarea';
      ta.value = s.text;
      li.appendChild(ta);

      const actions = document.createElement('div');
      actions.className = 'item-actions';

      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'solid-btn small-btn';
      saveBtn.textContent = '저장';
      saveBtn.addEventListener('click', () => commitEdit(sIdx, ta.value));

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'ghost-btn small-btn';
      cancelBtn.textContent = '취소';
      cancelBtn.addEventListener('click', () => {
        s.editing = false;
        refreshItem(sIdx);
      });

      actions.appendChild(saveBtn);
      actions.appendChild(cancelBtn);
      li.appendChild(actions);

      // Ctrl/Cmd+Enter로 빠르게 저장
      ta.addEventListener('keydown', e => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
          e.preventDefault();
          commitEdit(sIdx, ta.value);
        }
      });
      requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); });
    } else {
      const row = document.createElement('div');
      row.className = 'sentence-row';

      const idxEl = document.createElement('span');
      idxEl.className = 'sentence-index';
      idxEl.textContent = `${sIdx + 1}`;
      idxEl.title = `${sIdx + 1} / ${sentences.length}`;
      row.appendChild(idxEl);

      const textEl = document.createElement('div');
      textEl.className = `sentence-text ${langClass(s.lang)}`;
      s.tokens.forEach(tok => textEl.appendChild(buildTokenSpan(tok, sIdx)));
      row.appendChild(textEl);

      const actions = document.createElement('div');
      actions.className = 'item-actions';

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'ghost-btn item-icon-btn';
      editBtn.textContent = '✏';
      editBtn.title = '수정';
      editBtn.setAttribute('aria-label', '수정');
      editBtn.addEventListener('click', () => {
        s.editing = true;
        refreshItem(sIdx);
      });

      const dupBtn = document.createElement('button');
      dupBtn.type = 'button';
      dupBtn.className = 'ghost-btn item-icon-btn';
      dupBtn.textContent = '⧉';
      dupBtn.title = '복제';
      dupBtn.setAttribute('aria-label', '복제');
      dupBtn.addEventListener('click', () => duplicateSentence(sIdx));

      actions.appendChild(editBtn);
      actions.appendChild(dupBtn);

      li.appendChild(row);
      li.appendChild(actions);
    }

    updateSentenceSelClass(li, s);
    return li;
  }

  // 특정 문장 li만 다시 그림 (전체 리렌더 방지)
  function refreshItem(sIdx) {
    const s = sentences[sIdx];
    if (!s) return;
    const old = els.sentenceList.querySelector(`li[data-s-idx="${sIdx}"]`);
    const newLi = buildSentenceItemEl(s, sIdx);
    if (old) old.replaceWith(newLi);
    else render();
  }

  // ---------- 문장 목록 렌더링(전체) ----------
  function render() {
    els.sentenceList.innerHTML = '';
    if (!sentences.length) {
      els.emptyState.hidden = false;
      els.sentenceList.hidden = true;
      els.scrollTrack.hidden = true;
      updateSelectionSummary();
      return;
    }
    els.emptyState.hidden = true;
    els.sentenceList.hidden = false;
    els.scrollTrack.hidden = false;

    const frag = document.createDocumentFragment();
    sentences.forEach((s, sIdx) => frag.appendChild(buildSentenceItemEl(s, sIdx)));
    els.sentenceList.appendChild(frag);
    updateSelectionSummary();
    syncScrollThumb();
  }

  function updateSentenceSelClass(li, s) {
    const any = s.tokens.some(t => t.selected);
    li.classList.toggle('has-selection', any);
  }

  function toggleToken(sIdx, tokIdx) {
    const s = sentences[sIdx];
    const tok = s.tokens.find(t => t.i === tokIdx);
    if (!tok || tok.isSpace) return;
    tok.selected = !tok.selected;
    refreshItem(sIdx);
    updateSelectionSummary();
    debouncedAutosave();
  }

  // ---------- 문장 수정 ----------
  function commitEdit(sIdx, newText) {
    const text = newText.trim();
    if (!text) { setStatus('빈 문장은 저장할 수 없습니다.', true); return; }
    const s = sentences[sIdx];
    s.text = text;
    s.tokens = Parser.tokenize(text).map(tok => ({ ...tok, selected: false }));
    s.editing = false;
    refreshItem(sIdx);
    updateSelectionSummary();
    debouncedAutosave();
    setStatus('문장을 수정했습니다 (토큰 선택은 초기화됨).');
  }

  // ---------- 문장 복제 ----------
  function duplicateSentence(sIdx) {
    const orig = sentences[sIdx];
    const clone = {
      id: Date.now() + Math.random(),
      text: orig.text,
      lang: orig.lang,
      editing: false,
      tokens: orig.tokens.map(t => ({ ...t })),
    };
    sentences.splice(sIdx + 1, 0, clone);
    render();
    updateSelectionSummary();
    debouncedAutosave();
    requestAnimationFrame(() => {
      const li = els.sentenceList.querySelector(`li[data-s-idx="${sIdx + 1}"]`);
      if (li) li.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    setStatus('문장을 복제했습니다. 복제본에서 다른 토큰을 선택해 별도 카드로 만들 수 있어요.');
  }

  function updateSelectionSummary() {
    const n = sentences.filter(s => s.tokens.some(t => t.selected)).length;
    els.selectionSummary.textContent = `선택된 문장 ${n}개`;
    els.exportBtn.disabled = n === 0;
  }

  // ---------- 콘텐츠 로드 & 파싱 ----------
  function loadContent(filename, text, lang) {
    rawSourceText = text;
    rawFilename = filename;
    const raw = Parser.extractSentences(text, lang, filename);
    sentences = raw.map((t, i) => ({
      id: i,
      text: t,
      lang,
      editing: false,
      tokens: Parser.tokenize(t).map(tok => ({ ...tok, selected: false })),
    }));
    setStatus(`${sentences.length}개 문장을 찾았습니다.`);
    render();
  }

  function reparseWithCurrentLang() {
    if (!rawSourceText) return;
    loadContent(rawFilename, rawSourceText, els.langMode.value);
  }

  els.fileInput.addEventListener('change', async () => {
    const file = els.fileInput.files[0];
    if (!file) return;
    const text = await file.text();
    loadContent(file.name, text, els.langMode.value);
    els.fileInput.value = '';
  });

  els.pasteToggle.addEventListener('click', () => {
    els.pastePanel.classList.toggle('hidden');
    els.settingsPanel.classList.add('hidden');
  });
  els.pasteCancel.addEventListener('click', () => {
    els.pastePanel.classList.add('hidden');
  });
  els.pasteSubmit.addEventListener('click', () => {
    const text = els.pasteArea.value.trim();
    if (!text) { setStatus('붙여넣은 텍스트가 없습니다.', true); return; }
    loadContent('pasted.txt', text, els.langMode.value);
    els.pastePanel.classList.add('hidden');
  });

  els.langMode.addEventListener('change', reparseWithCurrentLang);
  els.ttsToggle.addEventListener('change', () => debouncedAutosave());

  // ---------- 설정 패널 ----------
  els.settingsToggle.addEventListener('click', () => {
    els.settingsPanel.classList.toggle('hidden');
    els.pastePanel.classList.add('hidden');
    if (!els.settingsPanel.classList.contains('hidden')) {
      els.apiKeyInput.value = Translate.getApiKey();
    }
  });
  els.apiKeySave.addEventListener('click', () => {
    Translate.setApiKey(els.apiKeyInput.value);
    setStatus('API 키가 이 브라우저에 저장되었습니다.');
  });
  els.apiKeyClear.addEventListener('click', () => {
    Translate.clearApiKey();
    els.apiKeyInput.value = '';
    setStatus('API 키를 삭제했습니다.');
  });

  // ---------- 로드바 접기/펼치기 ----------
  const LOADBAR_COLLAPSED_KEY = 'vocab-anki:loadbar-collapsed';

  function setLoadbarCollapsed(collapsed) {
    els.loadbarBody.classList.toggle('collapsed', collapsed);
    els.loadbarToggle.setAttribute('aria-expanded', String(!collapsed));
    els.loadbarToggleIcon.textContent = collapsed ? '▸' : '▾';
    els.statusLineCollapsed.hidden = !collapsed;
    try { localStorage.setItem(LOADBAR_COLLAPSED_KEY, collapsed ? '1' : '0'); } catch (e) {}
    measureBarHeights();
    syncScrollThumb();
  }

  els.loadbarToggle.addEventListener('click', () => {
    const collapsed = !els.loadbarBody.classList.contains('collapsed');
    setLoadbarCollapsed(collapsed);
  });

  // 처음엔 상태줄을 접힌 경우에만 보이게(펼쳐져 있을 땐 본문에 이미 표시되므로 중복 방지)
  els.statusLineCollapsed.hidden = true;

  {
    let initialCollapsed = false;
    try { initialCollapsed = localStorage.getItem(LOADBAR_COLLAPSED_KEY) === '1'; } catch (e) {}
    setLoadbarCollapsed(initialCollapsed);
  }

  // ---------- 저장 / 복원 ----------
  function serializeState() {
    return {
      lang: els.langMode.value,
      filename: rawFilename,
      rawSourceText,
      ttsEnabled: els.ttsToggle.checked,
      sentences: sentences.map(s => ({
        id: s.id, text: s.text, lang: s.lang,
        tokens: s.tokens.map(t => ({ i: t.i, text: t.text, isSpace: t.isSpace, clean: t.clean, selected: t.selected })),
      })),
    };
  }

  function saveState(showStatus) {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(serializeState()));
      if (showStatus) setStatus('중간 저장 완료.');
    } catch (e) {
      setStatus('저장 실패: 브라우저 저장 공간을 확인하세요.', true);
    }
  }

  let autosaveTimer = null;
  function debouncedAutosave() {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => saveState(false), 800);
  }

  function restoreState() {
    let raw;
    try { raw = localStorage.getItem(STATE_KEY); } catch (e) { return; }
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      rawSourceText = data.rawSourceText || '';
      rawFilename = data.filename || '';
      els.langMode.value = data.lang || 'en';
      if (typeof data.ttsEnabled === 'boolean') els.ttsToggle.checked = data.ttsEnabled;
      sentences = (data.sentences || []).map(s => ({
        id: s.id, text: s.text, lang: s.lang,
        editing: false,
        tokens: s.tokens,
      }));
      if (sentences.length) {
        setStatus(`이전에 저장한 작업(${sentences.length}개 문장)을 불러왔습니다.`);
        render();
      }
    } catch (e) { /* 손상된 저장값은 무시 */ }
  }

  els.saveProgressBtn.addEventListener('click', () => saveState(true));

  // ---------- 커스텀 스크롤바 ----------
  function measureBarHeights() {
    document.documentElement.style.setProperty('--loadbar-h', els.loadbar.offsetHeight + 'px');
    document.documentElement.style.setProperty('--bottombar-h', els.bottomBar.offsetHeight + 'px');
  }
  window.addEventListener('resize', measureBarHeights);

  let hideThumbTimer = null;
  function syncScrollThumb() {
    const { scrollTop, scrollHeight, clientHeight } = els.mainArea;
    if (scrollHeight <= clientHeight) {
      els.scrollThumb.style.height = '100%';
      els.scrollThumb.style.top = '0px';
      return;
    }
    const trackH = els.scrollTrack.clientHeight;
    const thumbH = Math.max(36, (clientHeight / scrollHeight) * trackH);
    const maxThumbTop = trackH - thumbH;
    const scrollRatio = scrollTop / (scrollHeight - clientHeight);
    const thumbTop = scrollRatio * maxThumbTop;
    els.scrollThumb.style.height = thumbH + 'px';
    els.scrollThumb.style.top = thumbTop + 'px';
  }

  function currentVisibleIndex() {
    const items = els.sentenceList.children;
    const areaTop = els.mainArea.getBoundingClientRect().top;
    for (let i = 0; i < items.length; i++) {
      const r = items[i].getBoundingClientRect();
      if (r.bottom > areaTop + 4) return i;
    }
    return items.length - 1;
  }

  function flashScrollPos() {
    const idx = currentVisibleIndex();
    if (idx < 0 || !sentences.length) return;
    els.scrollPos.textContent = `${idx + 1} / ${sentences.length}`;
    const thumbTop = parseFloat(els.scrollThumb.style.top || '0');
    const thumbH = parseFloat(els.scrollThumb.style.height || '0');
    els.scrollPos.style.top = (thumbTop + thumbH / 2) + 'px';
    els.scrollPos.classList.add('visible');
    clearTimeout(hideThumbTimer);
    hideThumbTimer = setTimeout(() => els.scrollPos.classList.remove('visible'), 900);
  }

  els.mainArea.addEventListener('scroll', () => {
    syncScrollThumb();
    flashScrollPos();
  }, { passive: true });

  // 스크롤바 드래그
  let dragging = false;
  els.scrollThumb.addEventListener('pointerdown', e => {
    dragging = true;
    els.scrollThumb.setPointerCapture(e.pointerId);
    els.scrollPos.classList.add('visible');
  });
  els.scrollThumb.addEventListener('pointermove', e => {
    if (!dragging) return;
    const trackRect = els.scrollTrack.getBoundingClientRect();
    const thumbH = els.scrollThumb.offsetHeight;
    let y = e.clientY - trackRect.top - thumbH / 2;
    y = Math.max(0, Math.min(trackRect.height - thumbH, y));
    const ratio = y / (trackRect.height - thumbH);
    const { scrollHeight, clientHeight } = els.mainArea;
    els.mainArea.scrollTop = ratio * (scrollHeight - clientHeight);
  });
  function stopDrag(e) {
    if (!dragging) return;
    dragging = false;
    clearTimeout(hideThumbTimer);
    hideThumbTimer = setTimeout(() => els.scrollPos.classList.remove('visible'), 500);
  }
  els.scrollThumb.addEventListener('pointerup', stopDrag);
  els.scrollThumb.addEventListener('pointercancel', stopDrag);

  // 트랙 클릭(썸 바깥) -> 그 위치로 점프
  els.scrollTrack.addEventListener('pointerdown', e => {
    if (e.target === els.scrollThumb) return;
    const trackRect = els.scrollTrack.getBoundingClientRect();
    const thumbH = els.scrollThumb.offsetHeight;
    let y = e.clientY - trackRect.top - thumbH / 2;
    y = Math.max(0, Math.min(trackRect.height - thumbH, y));
    const ratio = y / (trackRect.height - thumbH);
    const { scrollHeight, clientHeight } = els.mainArea;
    els.mainArea.scrollTop = ratio * (scrollHeight - clientHeight);
  });

  // ---------- Anki 내보내기 ----------

  async function exportToAnki() {
    const apiKey = Translate.getApiKey();
    if (!apiKey) {
      setStatus('API 키가 없어 비공식 방식으로 처리합니다 (느리고 실패할 수 있음, 특히 음성)…');
    }
    const lang = els.langMode.value;
    const includeTTS = els.ttsToggle.checked;
    const targets = sentences.filter(s => s.tokens.some(t => t.selected));
    if (!targets.length) {
      setStatus('선택된 토큰이 있는 문장이 없습니다.', true);
      return;
    }

    els.exportBtn.disabled = true;
    els.saveProgressBtn.disabled = true;
    const notes = [];
    let audioCounter = 0;
    let errorCount = 0;

    for (let i = 0; i < targets.length; i++) {
      const s = targets[i];
      const selectedTokens = s.tokens.filter(t => t.selected).sort((a, b) => a.i - b.i);
      const word = selectedTokens.map(t => t.clean).filter(Boolean).join(' ');
      const totalWordTokens = s.tokens.filter(t => !t.isSpace).length;
      const includeExample = totalWordTokens > selectedTokens.length;

      setStatus(`(${i + 1}/${targets.length}) "${word}" 처리 중…`);

      let meaning = '';
      try {
        meaning = await Translate.lookupWordMeaning(word, lang, 'ko', apiKey);
      } catch (e) { errorCount++; }

      let example = '';
      let exampleTranslation = '';
      let audio = null;

      if (includeExample) {
        example = s.text;
        try {
          exampleTranslation = await Translate.translateSentence(s.text, lang, 'ko', apiKey);
        } catch (e) { errorCount++; }
        if (includeTTS) {
          try {
            const tts = await Translate.synthesizeSpeech(s.text, lang, apiKey);
            audioCounter++;
            audio = { bytes: tts.bytes, filename: `vocab_${audioCounter}.mp3` };
          } catch (e) { errorCount++; }
        }
      }

      notes.push({ word, meaning, example, exampleTranslation, audio });
    }

    setStatus('Anki 패키지(.apkg) 생성 중…');
    try {
      const dateStr = new Date().toISOString().slice(0, 10);
      const deckName = `원서단어장::${lang === 'ru' ? 'Русский' : 'English'}::${dateStr}`;
      const blob = await AnkiExport.buildApkg(deckName, notes);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vocab-${lang}-${dateStr}.apkg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setStatus(
        errorCount
          ? `내보내기 완료 (${notes.length}개 노트, 일부 항목 ${errorCount}건 오류 — 해당 필드는 비어있을 수 있음).`
          : `내보내기 완료: ${notes.length}개 노트가 담긴 .apkg 파일을 다운로드했습니다.`
      );
    } catch (e) {
      console.error(e);
      setStatus('apkg 생성 중 오류가 발생했습니다: ' + e.message, true);
    } finally {
      els.exportBtn.disabled = false;
      els.saveProgressBtn.disabled = false;
    }
  }

  els.exportBtn.addEventListener('click', exportToAnki);

  // ---------- 초기화 ----------
  measureBarHeights();
  restoreState();
  updateSelectionSummary();
})();
