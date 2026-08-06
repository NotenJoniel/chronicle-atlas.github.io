/**
 * Chronicle Atlas — 横串ビュー用の軽量ダイジェスト生成スクリプト
 *
 * data/index.json + data/timelines/*.json から、cross/（横串トップページ）が
 * 初期描画に使う軽量な data/digest.json を生成する。
 * タイムラインデータを編集したら node data/validate.js に加えてこれも実行し、
 * digest.json を再生成してからコミットすること。
 *
 * 使い方: node data/build-digest.js
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = __dirname;
const TIMELINES_DIR = path.join(DATA_DIR, 'timelines');
const OUT_PATH = path.join(DATA_DIR, 'digest.json');

const index = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'index.json'), 'utf-8'));

const digest = { generatedAt: new Date().toISOString().slice(0, 10), categories: null, timelines: {} };
let totalEvents = 0;

for (const meta of index.timelines) {
  const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, meta.dataFile), 'utf-8'));
  const charById = new Map(raw.characters.map(c => [c.id, c]));

  // categories は契約層（全時代共通の4種）なので、どのファイルから取っても同一である前提。
  // 横串ビューでカテゴリフィルタの名前・アイコンを表示するために先頭ファイルの値を1つだけ採用する。
  if (!digest.categories) digest.categories = raw.categories;

  const events = raw.events.map(ev => {
    const digestEv = { id: ev.id, year: ev.year, title: ev.title, category: ev.category, location: ev.location };
    const firstChar = ev.characters && ev.characters.length ? charById.get(ev.characters[0]) : null;
    const faction = firstChar && raw.factions[firstChar.faction];
    if (faction && faction.color) digestEv.color = faction.color;
    // 横串ビューのサイドバーで人物を選択した際、出来事カードを絞り込むために必要。
    if (ev.characters && ev.characters.length) digestEv.characters = ev.characters;
    return digestEv;
  });

  // 横串ビューの「時代を選択」内に人物一覧を出すための軽量な人物データ。
  // 一覧表示に必要な最小限（id/name/reading/faction/field）のみを含め、
  // role/description/historyTrivia等はモーダル表示時の遅延fetch（実JSON）に任せる。
  const characters = raw.characters.map(c => ({ id: c.id, name: c.name, reading: c.reading, faction: c.faction, field: c.field }));

  digest.timelines[meta.id] = { events, characters, factions: raw.factions };
  totalEvents += events.length;
}

fs.writeFileSync(OUT_PATH, JSON.stringify(digest, null, 2) + '\n');
console.log(`✅ digest.json generated: ${index.timelines.length} timelines, ${totalEvents} events`);
