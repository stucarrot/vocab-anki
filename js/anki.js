/* anki.js
 * sql.js(SQLite wasm) + JSZip 만으로 브라우저에서 직접 .apkg 를 생성한다.
 * (Anki legacy schema ver=11 — 최신 Anki도 가져오기 가능)
 */
const AnkiExport = (() => {

  let SQL = null;
  async function ensureSql() {
    if (SQL) return SQL;
    SQL = await initSqlJs({
      locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.2/${file}`,
    });
    return SQL;
  }

  const SCHEMA = `
    CREATE TABLE col (
      id integer primary key, crt integer not null, mod integer not null,
      scm integer not null, ver integer not null, dty integer not null,
      usn integer not null, ls integer not null, conf text not null,
      models text not null, decks text not null, dconf text not null,
      tags text not null
    );
    CREATE TABLE notes (
      id integer primary key, guid text not null, mid integer not null,
      mod integer not null, usn integer not null, tags text not null,
      flds text not null, sfld text not null, csum integer not null,
      flags integer not null, data text not null
    );
    CREATE TABLE cards (
      id integer primary key, nid integer not null, did integer not null,
      ord integer not null, mod integer not null, usn integer not null,
      type integer not null, queue integer not null, due integer not null,
      ivl integer not null, factor integer not null, reps integer not null,
      lapses integer not null, left integer not null, odue integer not null,
      odid integer not null, flags integer not null, data text not null
    );
    CREATE TABLE revlog (
      id integer primary key, cid integer not null, usn integer not null,
      ease integer not null, ivl integer not null, lastIvl integer not null,
      factor integer not null, time integer not null, type integer not null
    );
    CREATE TABLE graves (
      usn integer not null, oid integer not null, type integer not null
    );
    CREATE INDEX ix_notes_usn ON notes (usn);
    CREATE INDEX ix_cards_usn ON cards (usn);
    CREATE INDEX ix_revlog_usn ON revlog (usn);
    CREATE INDEX ix_cards_nid ON cards (nid);
    CREATE INDEX ix_cards_sched ON cards (did, queue, due);
    CREATE INDEX ix_revlog_cid ON revlog (cid);
    CREATE INDEX ix_notes_csum ON notes (csum);
  `;

  async function sha1Checksum(text) {
    const enc = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-1', enc);
    const bytes = new Uint8Array(digest);
    let hex = '';
    for (let i = 0; i < 4; i++) hex += bytes[i].toString(16).padStart(2, '0');
    return parseInt(hex, 16) >>> 0;
  }

  function randGuid() {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let out = '';
    for (let i = 0; i < 10; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  }

  const CSS = `
.card {
  font-family: "Noto Sans", "Noto Serif", sans-serif;
  font-size: 20px;
  text-align: left;
  color: #111111;
  background-color: #fdf6e3;
  padding: 20px;
  line-height: 1.6;
}
.meaning { margin-top: 10px; white-space: pre-line; color: #073642; }
.example { margin-top: 14px; font-style: italic; color: #268bd2; }
.example-tr { margin-top: 6px; color: #586e75; font-size: 0.9em; }
hr#answer { border: none; border-top: 1px solid #ddd3ad; margin: 14px 0; }
`;

  /**
   * notes: [{ word, meaning, example, exampleTranslation, audio: {bytes:Uint8Array, filename} | null }]
   * 반환: Blob (.apkg)
   */
  async function buildApkg(deckName, notes) {
    const sql = await ensureSql();
    const db = new sql.Database();
    db.run(SCHEMA);

    const now = Date.now();
    const nowSec = Math.floor(now / 1000);
    const modelId = now - 1;
    const deckId = now - 2;

    const conf = {
      nextPos: 1, estTimes: true, activeDecks: [deckId], sortType: 'noteFld',
      timeLim: 0, sortBackwards: false, addToCur: true, curDeck: deckId,
      newBury: true, newSpread: 0, dueCounts: true, curModel: String(modelId),
      collapseTime: 1200,
    };

    const decks = {
      '1': {
        id: 1, mod: 0, name: 'Default', usn: 0, collapsed: false,
        newToday: [0, 0], revToday: [0, 0], lrnToday: [0, 0], timeToday: [0, 0],
        conf: 1, desc: '', dyn: 0, extendNew: 0, extendRev: 50,
      },
      [String(deckId)]: {
        id: deckId, mod: nowSec, name: deckName, usn: 0, collapsed: false,
        newToday: [0, 0], revToday: [0, 0], lrnToday: [0, 0], timeToday: [0, 0],
        conf: 1, desc: '', dyn: 0, extendNew: 0, extendRev: 50,
      },
    };

    const dconf = {
      '1': {
        id: 1, mod: 0, name: 'Default', usn: 0, maxTaken: 60, autoplay: true,
        timer: 0, replayq: true, dyn: 0,
        new: { bury: true, delays: [1, 10], initialFactor: 2500, ints: [1, 4, 7], order: 1, perDay: 20, separate: true },
        rev: { bury: true, ease4: 1.3, fuzz: 0.05, ivlFct: 1, maxIvl: 36500, minSpace: 1, perDay: 100 },
        lapse: { delays: [10], leechAction: 0, leechFails: 8, minInt: 1, mult: 0 },
      },
    };

    const fieldNames = ['Word', 'Meaning', 'Example', 'ExampleTranslation'];
    const models = {
      [String(modelId)]: {
        id: modelId, name: '원서 단어장', type: 0, mod: nowSec, usn: 0, sortf: 0,
        did: deckId,
        tmpls: [{
          name: 'Card 1', ord: 0,
          qfmt: '{{Word}}',
          afmt: '{{FrontSide}}\n\n<hr id=answer>\n\n<div class="meaning">{{Meaning}}</div>\n{{#Example}}<div class="example">{{Example}}</div>{{/Example}}\n{{#ExampleTranslation}}<div class="example-tr">{{ExampleTranslation}}</div>{{/ExampleTranslation}}',
          bqfmt: '', bafmt: '', did: null, bfont: '', bsize: 0,
        }],
        flds: fieldNames.map((name, ord) => ({
          name, ord, sticky: false, rtl: false, font: 'Noto Sans', size: 20, media: [],
        })),
        css: CSS,
        latexPre: '\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n',
        latexPost: '\\end{document}',
        latexsvg: false,
        req: [[0, 'any', [0]]],
        tags: [], vers: [],
      },
    };

    db.run(
      `INSERT INTO col (id,crt,mod,scm,ver,dty,usn,ls,conf,models,decks,dconf,tags) VALUES (1,?,?,?,11,0,0,0,?,?,?,?,'{}')`,
      [nowSec, now, now, JSON.stringify(conf), JSON.stringify(models), JSON.stringify(decks), JSON.stringify(dconf)]
    );

    const media = {};        // zip 내부 인덱스(문자열) -> 실제 파일명
    const mediaFiles = [];   // { idx, bytes } 목록 (zip에 실제로 쓸 바이너리)
    let mediaIdx = 0;
    let noteId = now;
    let cardId = now + 100000;
    let pos = 0;

    for (const n of notes) {
      let exampleField = n.example || '';
      if (n.audio && n.audio.bytes) {
        const filename = n.audio.filename;
        media[String(mediaIdx)] = filename;
        mediaFiles.push({ idx: mediaIdx, bytes: n.audio.bytes });
        exampleField += ` [sound:${filename}]`;
        mediaIdx++;
      }

      const flds = [n.word || '', n.meaning || '', exampleField, n.exampleTranslation || ''].join('\x1f');
      const sfld = n.word || '';
      const csum = await sha1Checksum(sfld);
      const guid = randGuid();

      noteId += 1;
      db.run(
        `INSERT INTO notes (id,guid,mid,mod,usn,tags,flds,sfld,csum,flags,data) VALUES (?,?,?,?,0,'',?,?,?,0,'')`,
        [noteId, guid, modelId, nowSec, flds, sfld, csum]
      );

      cardId += 1;
      pos += 1;
      db.run(
        `INSERT INTO cards (id,nid,did,ord,mod,usn,type,queue,due,ivl,factor,reps,lapses,left,odue,odid,flags,data)
         VALUES (?,?,?,0,?,0,0,0,?,0,0,0,0,0,0,0,0,'')`,
        [cardId, noteId, deckId, nowSec, pos]
      );
    }

    const dbBytes = db.export();
    db.close();

    const zip = new JSZip();
    zip.file('collection.anki2', dbBytes);
    zip.file('media', JSON.stringify(media));
    for (const m of mediaFiles) {
      zip.file(String(m.idx), m.bytes);
    }

    return zip.generateAsync({ type: 'blob' });
  }

  return { buildApkg };
})();
