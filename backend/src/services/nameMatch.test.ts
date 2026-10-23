import { describe, it, expect } from 'vitest';
import { translit, nameTokens, tokenSim, scoreCandidates, pickCandidate, personAliases, objectAliases, type MatchCandidate } from './nameMatch';

const person = (id: string, first: string, last: string, role?: string): MatchCandidate =>
  ({ id, name: `${first} ${last}`.trim(), aliases: personAliases(first, last), role });
const obj = (id: string, name: string): MatchCandidate => ({ id, name, aliases: objectAliases(name) });

const PEOPLE = [
  person('u1', 'Botirjon', 'Karimov', 'prorab'),
  person('u2', 'Abdulaziz', 'Rahimov', 'brigadir'),
  person('u3', "G'ayrat", 'Xolmatov', 'ishchi'),
  person('u4', 'Sherzod', 'Toshmatov', 'direktor'),
  person('u5', 'Hurshid', 'Qodirov', 'ishchi'),
  person('u6', 'Sardorbek', 'Yusupov', 'omborchi'),
];
const OBJECTS = [
  obj('o1', '12-maktab'),
  obj('o2', 'Yunusobod turar joy majmuasi'),
  obj('o3', '45-maktab rekonstruksiya'),
  obj('o4', 'Chilonzor 7-kvartal uy'),
  obj('o5', "Sergeli bog'cha"),
];
const best = (q: string, c: MatchCandidate[]) => pickCandidate(q, c).match?.id;

describe('translit / tokens', () => {
  it('Cyrillic Uzbek and Russian → Latin', () => {
    expect(translit('Ғайрат Холматов')).toBe('gayrat xolmatov');
    expect(translit('Ўткир')).toBe('otkir');
    expect(translit('Шерзод')).toBe('sherzod');
    expect(translit("G'ayrat")).toBe('gayrat');
  });
  it('splits numbers, drops suffixes/honorifics, unifies synonyms', () => {
    expect(nameTokens('12-maktabdagi')).toEqual(['12', 'maktab']);
    expect(nameTokens('школа №12')).toEqual(['maktab', '12']);
    expect(nameTokens('Botir akaga')).toEqual(['batir']); // fonetik kalit (o → a)
    expect(nameTokens('Азизу')).toEqual(['aziz']);
    expect(nameTokens('12-chi maktab')).toEqual(['12', 'maktab']);
  });
  it('token similarity: prefixes, typos, numbers exact', () => {
    expect(tokenSim('aziz', 'abdulaziz')).toBeGreaterThan(0.85);
    expect(tokenSim('yunusabad', 'yunusobod')).toBeGreaterThan(0.7);
    expect(tokenSim('12', '45')).toBe(0);
  });
});

describe('people matching (uz/ru/cyrillic variants)', () => {
  it.each([
    ['Botir', 'u1'], ['Botirjon', 'u1'], ['Botirga', 'u1'], ['Botir akaga', 'u1'], ['Ботир ака', 'u1'], ['Ботиржону', 'u1'],
    ['Karimov', 'u1'], ['Каримову', 'u1'], ['prorab Botir', 'u1'], ['prorabga', 'u1'],
    ['Aziz', 'u2'], ['Азиз', 'u2'], ['Abdulaziz Rahimov', 'u2'], ['Rahimovga', 'u2'],
    ["G'ayrat", 'u3'], ['Гайрат', 'u3'], ['Ғайратга', 'u3'], ['Gayrat aka', 'u3'],
    ['Sherzod', 'u4'], ['Шерзод Тошматов', 'u4'], ['direktorga', 'u4'],
    ['Xurshid', 'u5'], ['Khurshid', 'u5'], ['Хуршид', 'u5'], ['Hurshidga', 'u5'],
    ['Sardor', 'u6'], ['Сардор', 'u6'], ['omborchi', 'u6'],
  ])('%s → %s', (q, id) => {
    expect(best(q, PEOPLE)).toBe(id);
  });
  it('unknown name → no match (kept as spoken)', () => {
    expect(best('Qudrat', PEOPLE)).toBeUndefined();
    expect(best('Metall savdo MChJ', PEOPLE)).toBeUndefined();
  });
  it('two people with the same first name → ambiguous', () => {
    const r = pickCandidate('Aziz', [...PEOPLE, person('u7', 'Aziz', 'Nazarov', 'ishchi')]);
    expect(r.match).toBeUndefined();
    expect(r.ambiguous?.map((c) => c.id).sort()).toEqual(['u2', 'u7']);
  });
  it('two prorabs, role only → ambiguous', () => {
    const r = pickCandidate('prorabga', [...PEOPLE, person('u8', 'Anvar', 'Saidov', 'prorab')]);
    expect(r.ambiguous?.map((c) => c.id).sort()).toEqual(['u1', 'u8']);
  });
});

describe('object matching', () => {
  it.each([
    ['12-maktab', 'o1'], ['12 maktab', 'o1'], ["12-chi maktabga", 'o1'], ['школа 12', 'o1'], ['12-школа', 'o1'], ['12-maktabdagi', 'o1'],
    ['Yunusobod', 'o2'], ['Yunusabad', 'o2'], ['Юнусабад', 'o2'], ['Юнусобод турар жой', 'o2'], ['Yunusoboddagi obyekt', 'o2'],
    ['45-maktab', 'o3'], ['45 школа', 'o3'],
    ['Chilonzor', 'o4'], ['Чиланзар', 'o4'], ['7-kvartal', 'o4'],
    ["Sergeli bog'chasi", 'o5'], ['Сергели детсад', 'o5'],
  ])('%s → %s', (q, id) => {
    expect(best(q, OBJECTS)).toBe(id);
  });
  it('wrong number does not match another school', () => {
    expect(best('33-maktab', OBJECTS)).toBeUndefined();
  });
  it('"maktab" alone with two schools → ambiguous', () => {
    const r = pickCandidate('maktab', OBJECTS);
    expect(r.match).toBeUndefined();
    expect(r.ambiguous?.map((c) => c.id).sort()).toEqual(['o1', 'o3']);
  });
  it('scores are sorted', () => {
    const s = scoreCandidates('Yunusobod', OBJECTS);
    expect(s[0].id).toBe('o2');
    for (let i = 1; i < s.length; i++) expect(s[i - 1].score).toBeGreaterThanOrEqual(s[i].score);
  });
});

describe('aliases', () => {
  it('person nicknames', () => {
    expect(personAliases('Abdulaziz', 'Rahimov')).toContain('aziz');
    expect(personAliases('Botirjon', 'Karimov')).toContain('botir');
    expect(personAliases('Sardorbek', '')).toContain('sardor');
  });
  it('object short forms', () => {
    expect(objectAliases('Yunusobod turar joy majmuasi')).toContain('yunusobod');
    expect(objectAliases('12-maktab')).toContain('12');
  });
});
