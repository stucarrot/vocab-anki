/* translate.js
 * 번역/사전/TTS 는 모두 사용자가 직접 발급한 Google Cloud API 키로 호출한다.
 * (공개 GitHub Pages에 키를 커밋하지 않기 위해 localStorage 에서만 읽는다)
 *
 * - officialTranslate(): Cloud Translation API v2 (공식, 안정적, 단일 번역문)
 * - dictionaryLookup(): 비공식 translate.googleapis.com 사전 엔드포인트
 *   (품사별 여러 뜻을 제공하는 유일한 무료 경로. 실패 시 조용히 무시하고
 *    officialTranslate 결과로 대체된다)
 * - synthesizeSpeech(): Cloud Text-to-Speech API (공식, 여성 음성)
 */
const Translate = (() => {

  const LS_KEY = 'vocab-anki:api-key';

  function getApiKey() {
    return (localStorage.getItem(LS_KEY) || '').trim();
  }
  function setApiKey(key) {
    localStorage.setItem(LS_KEY, key.trim());
  }
  function clearApiKey() {
    localStorage.removeItem(LS_KEY);
  }

  // 언어 코드: 앱 내부 en/ru -> Google 언어 코드 (동일하지만 명시적으로 매핑)
  const LANG_MAP = { en: 'en', ru: 'ru' };

  // ---------- 공식 Cloud Translation API v2 ----------
  async function officialTranslate(text, sourceLang, targetLang, apiKey) {
    const url = `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q: text,
        source: LANG_MAP[sourceLang] || undefined,
        target: targetLang,
        format: 'text',
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Translation API 오류 (${res.status}): ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    const t = data?.data?.translations?.[0];
    return t ? t.translatedText : '';
  }

  // ---------- 비공식 사전 엔드포인트 (품사별 여러 뜻) ----------
  // 실패해도 예외를 던지지 않고 null을 반환한다.
  async function dictionaryLookup(word, sourceLang, targetLang) {
    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx`
        + `&sl=${encodeURIComponent(sourceLang)}&tl=${encodeURIComponent(targetLang)}`
        + `&dt=t&dt=bd&q=${encodeURIComponent(word)}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      // data[1] = [[posLabel, [단어 목록...], ...], ...] 형태 (품사 사전)
      const dictBlock = data?.[1];
      if (!Array.isArray(dictBlock)) return null;
      const byPos = [];
      for (const entry of dictBlock) {
        const pos = entry?.[0];
        const terms = entry?.[1];
        if (!pos || !Array.isArray(terms) || !terms.length) continue;
        byPos.push(`${pos}: ${terms.slice(0, 5).join(', ')}`);
      }
      if (byPos.length) return byPos.join('\n');

      // 사전 블록이 없으면 단순 번역이라도 data[0]에서 추출
      const plain = (data?.[0] || []).map(seg => seg?.[0]).filter(Boolean).join('');
      return plain || null;
    } catch (e) {
      return null;
    }
  }

  // 비공식 엔드포인트로 일반 텍스트(단어/문장) 번역 - 실패 시 예외를 던짐(호출부에서 처리)
  async function unofficialTranslateText(text, sourceLang, targetLang) {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx`
      + `&sl=${encodeURIComponent(sourceLang)}&tl=${encodeURIComponent(targetLang)}`
      + `&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`비공식 번역 실패 (${res.status})`);
    const data = await res.json();
    const segs = data?.[0] || [];
    const plain = segs.map(seg => seg?.[0]).filter(Boolean).join('');
    if (!plain) throw new Error('비공식 번역 응답이 비어 있습니다.');
    return plain;
  }

  // 단어의 "여러 품사별 뜻"
  // 1) 사전 엔드포인트(무료/비공식) 우선 시도 - 키 유무와 무관하게 항상 먼저 시도
  // 2) 실패 시: 키가 있으면 공식 API, 없으면 비공식 일반 번역으로 대체
  async function lookupWordMeaning(word, sourceLang, targetLang, apiKey) {
    const dict = await dictionaryLookup(word, sourceLang, targetLang);
    if (dict) return dict;
    if (apiKey) {
      try {
        return await officialTranslate(word, sourceLang, targetLang, apiKey);
      } catch (e) { /* 아래 비공식 폴백으로 계속 */ }
    }
    try {
      return await unofficialTranslateText(word, sourceLang, targetLang);
    } catch (e) {
      return '';
    }
  }

  // ---------- 문장 번역 ----------
  // 키가 있으면 공식 API(안정적), 없거나 실패하면 비공식 엔드포인트로 대체.
  async function translateSentence(sentence, sourceLang, targetLang, apiKey) {
    if (apiKey) {
      try {
        return await officialTranslate(sentence, sourceLang, targetLang, apiKey);
      } catch (e) { /* 아래 비공식 폴백으로 계속 */ }
    }
    return unofficialTranslateText(sentence, sourceLang, targetLang);
  }

  // ---------- Text-to-Speech (여성 음성) ----------
  const FEMALE_VOICE = {
    en: { languageCode: 'en-US', name: 'en-US-Standard-C', ssmlGender: 'FEMALE' },
    ru: { languageCode: 'ru-RU', name: 'ru-RU-Standard-A', ssmlGender: 'FEMALE' },
  };

  function base64ToBytes(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  // 공식 Cloud TTS - 반환: { bytes: Uint8Array, mimeType }
  async function officialSynthesize(text, lang, apiKey) {
    const voice = FEMALE_VOICE[lang] || FEMALE_VOICE.en;
    const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text },
        voice,
        audioConfig: { audioEncoding: 'MP3' },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Text-to-Speech API 오류 (${res.status}): ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    if (!data.audioContent) throw new Error('TTS 응답에 오디오가 없습니다.');
    return { bytes: base64ToBytes(data.audioContent), mimeType: 'audio/mpeg' };
  }

  // translate.google.com 의 비공식 음성 합성 엔드포인트.
  // 요청 1건당 텍스트 길이 제한이 있어 잘게 나눠 여러 번 호출한 뒤 mp3를 이어붙인다.
  // 브라우저 CORS 정책상 아예 막힐 수도 있음(그 경우 예외를 던짐 -> 호출부가 오디오 없이 계속 진행).
  function splitForUnofficialTTS(text, maxLen = 180) {
    const words = text.split(/\s+/).filter(Boolean);
    const chunks = [];
    let cur = '';
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (next.length > maxLen && cur) {
        chunks.push(cur);
        cur = w;
      } else {
        cur = next;
      }
    }
    if (cur) chunks.push(cur);
    return chunks.length ? chunks : [text];
  }

  async function unofficialSynthesize(text, lang) {
    const chunks = splitForUnofficialTTS(text);
    const buffers = [];
    for (const chunk of chunks) {
      const url = `https://translate.google.com/translate_tts?ie=UTF-8`
        + `&q=${encodeURIComponent(chunk)}&tl=${encodeURIComponent(lang)}&client=tw-ob`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`비공식 TTS 실패 (${res.status})`);
      buffers.push(new Uint8Array(await res.arrayBuffer()));
    }
    const total = buffers.reduce((n, b) => n + b.length, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const b of buffers) { merged.set(b, offset); offset += b.length; }
    return { bytes: merged, mimeType: 'audio/mpeg' };
  }

  // 반환: { bytes, mimeType } — 키가 있으면 공식(안정적), 없거나 실패하면 비공식(불안정) 시도.
  async function synthesizeSpeech(text, lang, apiKey) {
    if (apiKey) {
      try {
        return await officialSynthesize(text, lang, apiKey);
      } catch (e) { /* 아래 비공식 폴백으로 계속 */ }
    }
    return unofficialSynthesize(text, lang);
  }

  return {
    getApiKey, setApiKey, clearApiKey,
    lookupWordMeaning, translateSentence, synthesizeSpeech,
  };
})();
