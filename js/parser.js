/* parser.js
 * 입력 텍스트(txt 독서노트 / srt / 붙여넣기)를 받아
 * -> 후보 블록으로 분리 -> 메타데이터 줄 제거 -> 문장 단위 분리
 * -> 선택한 언어(en/ru)가 포함된 문장만 필터링 -> 토큰화
 * 까지 담당하는 순수 함수 모음.
 */
const Parser = (() => {

  const SRT_CUE_RE = /\d{1,2}:\d{2}:\d{2}[.,]\d{3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[.,]\d{3}/;

  function looksLikeSRT(filename, content) {
    if (filename && /\.srt$/i.test(filename)) return true;
    return SRT_CUE_RE.test(content);
  }

  // ---------- SRT ----------
  function parseSRT(content) {
    const blocks = content
      .replace(/\r\n/g, '\n')
      .split(/\n\s*\n/)
      .map(b => b.trim())
      .filter(Boolean);

    const cues = [];
    for (const block of blocks) {
      const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
      if (!lines.length) continue;
      // 첫 줄이 순수 인덱스 숫자면 제거
      let start = 0;
      if (/^\d+$/.test(lines[0])) start = 1;
      // 타임코드 줄 제거
      const textLines = lines.slice(start).filter(l => !SRT_CUE_RE.test(l));
      if (!textLines.length) continue;
      const text = textLines
        .join(' ')
        .replace(/<[^>]+>/g, '')      // 태그(<i> 등) 제거
        .replace(/\{[^}]+\}/g, '')    // ASS 스타일 태그 제거
        .trim();
      if (text) cues.push(text);
    }
    return cues;
  }

  // ---------- 일반 노트(txt/md) ----------
  const SEPARATOR_LINE_RE = /^[=\-_*~]{3,}$/;
  // Boox/Moonreader류 메타데이터 줄 흔한 패턴
  const METADATA_LINE_RE = new RegExp(
    [
      '^\\s*(위치|Location|Page|페이지|하이라이트|Highlight|Note|메모)\\b.*\\d',
      '^\\d{4}[./-]\\d{1,2}[./-]\\d{1,2}',           // 날짜
      '^\\d{1,2}:\\d{2}(:\\d{2})?\\s*(AM|PM)?$',      // 시간만 있는 줄
      '^[\\[(【].{0,40}[\\])】]\\s*$',                 // [출처] 같은 단독 대괄호 줄
    ].join('|'),
    'i'
  );

  function splitBlocks(content) {
    return content
      .replace(/\r\n/g, '\n')
      .split(/\n\s*\n/)
      .flatMap(chunk => {
        // 구분선으로도 한 번 더 나눔
        const lines = chunk.split('\n');
        const parts = [];
        let cur = [];
        for (const line of lines) {
          if (SEPARATOR_LINE_RE.test(line.trim())) {
            if (cur.length) parts.push(cur.join('\n'));
            cur = [];
          } else {
            cur.push(line);
          }
        }
        if (cur.length) parts.push(cur.join('\n'));
        return parts;
      })
      .map(b => b.trim())
      .filter(Boolean);
  }

  function stripMetadataLines(block) {
    return block
      .split('\n')
      .filter(line => {
        const t = line.trim();
        if (!t) return false;
        if (METADATA_LINE_RE.test(t)) return false;
        // 글자 비율이 너무 낮은(숫자/기호 위주) 줄 제거
        const letters = (t.match(/[\p{L}]/gu) || []).length;
        if (letters < Math.max(2, t.length * 0.3)) return false;
        return true;
      })
      .join(' ');
  }

  // 문장 종결부호 기준 분리 (영/러/한글 종결부호 포함, 마침표 없는 짧은 발췌는 한 문장 취급)
  function splitSentences(text) {
    const cleaned = text.replace(/\s+/g, ' ').trim();
    if (!cleaned) return [];
    const parts = cleaned
      .split(/(?<=[.!?…])\s+(?=[A-ZА-ЯЁ0-9"'“(«])/u)
      .map(s => s.trim())
      .filter(Boolean);
    return parts.length ? parts : [cleaned];
  }

  function parseGeneric(content) {
    const blocks = splitBlocks(content);
    const sentences = [];
    for (const block of blocks) {
      const joined = stripMetadataLines(block);
      if (!joined) continue;
      sentences.push(...splitSentences(joined));
    }
    return sentences;
  }

  // ---------- 언어 필터 ----------
  const LATIN_RE = /[A-Za-z]/g;
  const CYRILLIC_RE = /[\u0400-\u04FF]/g;

  function countMatches(str, re) {
    return (str.match(re) || []).length;
  }

  function filterByLanguage(sentences, lang) {
    const re = lang === 'ru' ? CYRILLIC_RE : LATIN_RE;
    const other = lang === 'ru' ? LATIN_RE : CYRILLIC_RE;
    return sentences.filter(s => {
      const target = countMatches(s, re);
      if (target < 4) return false; // 최소 알파벳 글자 수(너무 짧은 잡음 제거)
      // 대상 언어 글자가 반대 언어 글자보다 확연히 많아야 함
      const opposite = countMatches(s, other);
      return target >= opposite;
    });
  }

  function dedupe(sentences) {
    const seen = new Set();
    const out = [];
    for (const s of sentences) {
      const key = s.trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    }
    return out;
  }

  // ---------- 공개 API: 전체 파이프라인 ----------
  function extractSentences(content, lang, filename) {
    const raw = looksLikeSRT(filename, content)
      ? parseSRT(content)
      : parseGeneric(content);

    // SRT 큐 하나에 문장이 여러 개 섞여 있을 수 있으므로 한 번 더 분리
    const finer = raw.flatMap(s => splitSentences(s));
    const filtered = filterByLanguage(finer, lang);
    return dedupe(filtered);
  }

  // ---------- 토큰화 ----------
  // 원문의 공백을 보존한 채 공백/단어/구두점 토큰으로 분리.
  // 단어 앞뒤에 붙은 구두점(따옴표, 쉼표, 마침표 등)은 별도 토큰으로 떼어내
  // 화면에서 선택(하이라이트) 대상이 되지 않도록 한다.
  // 내부 구두점(don't, well-known 등)은 단어의 일부로 유지된다.
  function splitWordPunct(part) {
    const leadMatch = part.match(/^[^\p{L}\p{N}]+/u);
    const lead = leadMatch ? leadMatch[0] : '';
    const rest = part.slice(lead.length);
    if (!rest) return { lead: part, core: '', trail: '' }; // 전부 구두점/기호인 토큰
    const trailMatch = rest.match(/[^\p{L}\p{N}]+$/u);
    const trail = trailMatch ? trailMatch[0] : '';
    const core = trail ? rest.slice(0, rest.length - trail.length) : rest;
    return { lead, core, trail };
  }

  function tokenize(sentence) {
    const raw = sentence.match(/\S+|\s+/g) || [];
    const tokens = [];
    let i = 0;

    for (const part of raw) {
      if (/^\s+$/.test(part)) {
        tokens.push({ i: i++, text: part, isSpace: true, isPunct: false, clean: '' });
        continue;
      }
      const { lead, core, trail } = splitWordPunct(part);
      if (!core) {
        // 이모지, 대시, 따옴표 단독 등 - 전부 구두점으로 취급
        tokens.push({ i: i++, text: part, isSpace: false, isPunct: true, clean: '' });
        continue;
      }
      if (lead) tokens.push({ i: i++, text: lead, isSpace: false, isPunct: true, clean: '' });
      tokens.push({ i: i++, text: core, isSpace: false, isPunct: false, clean: core });
      if (trail) tokens.push({ i: i++, text: trail, isSpace: false, isPunct: true, clean: '' });
    }
    return tokens;
  }

  return { extractSentences, tokenize, looksLikeSRT };
})();
