import { describe, it, expect } from "vitest";
import { clearLines, createGame, GAME_IDS, move2048, slide2048, snakeStep, tttBest, tttWinner, type SnakeState } from "./games";

describe("mini-o'yinlar mantig'i", () => {
  it("2048: qo'shilish faqat bir marta, bo'sh joylar suriladi", () => {
    expect(slide2048([2, 2, 2, 2])).toEqual({ row: [4, 4, 0, 0], gained: 8 });
    expect(slide2048([0, 2, 0, 2])).toEqual({ row: [4, 0, 0, 0], gained: 4 });
    expect(slide2048([4, 4, 8, 0])).toEqual({ row: [8, 8, 0, 0], gained: 8 });
    const b = [[0, 0, 0, 2], [0, 0, 0, 2], [0, 0, 0, 0], [0, 0, 0, 0]];
    const up = move2048(b, "up");
    expect(up.board[0][3]).toBe(4);
    expect(up.moved).toBe(true);
    expect(move2048([[2, 4], [8, 16]], "left").moved).toBe(false);
  });

  it("ilon: ovqat yesa o'sadi, devor va o'ziga urilsa o'ladi, teskari burilmaydi", () => {
    const s: SnakeState = { body: [{ x: 2, y: 2 }, { x: 1, y: 2 }], dir: "right", food: { x: 3, y: 2 }, w: 5, h: 5 };
    const r = snakeStep(s, null);
    expect(r.ate).toBe(true);
    expect(r.state.body).toHaveLength(3);
    expect(snakeStep(s, "left").state.dir).toBe("right"); // teskari — e'tiborsiz
    expect(snakeStep({ ...s, body: [{ x: 4, y: 0 }, { x: 3, y: 0 }], food: { x: 0, y: 4 } }, null).dead).toBe(true);
    const coil: SnakeState = { body: [{ x: 2, y: 2 }, { x: 2, y: 3 }, { x: 1, y: 3 }, { x: 1, y: 2 }, { x: 1, y: 1 }], dir: "up", food: { x: 4, y: 4 }, w: 5, h: 5 };
    expect(snakeStep(coil, "left").dead).toBe(true);
  });

  it("bloklar: to'lgan qatorlar o'chadi, tepadan bo'sh qo'shiladi", () => {
    const b = [[0, 1, 0], [1, 1, 1], [1, 0, 1], [1, 1, 1]];
    const c = clearLines(b);
    expect(c.lines).toBe(2);
    expect(c.board).toEqual([[0, 0, 0], [0, 0, 0], [0, 1, 0], [1, 0, 1]]);
  });

  it("X-O: g'olibni topadi; agent yutuvchi yurishni qiladi va o'yinchini to'sadi", () => {
    expect(tttWinner([1, 1, 1, 0, 2, 2, 0, 0, 0])).toBe(1);
    expect(tttWinner([1, 2, 1, 1, 2, 2, 2, 1, 1])).toBe(3);
    expect(tttBest([2, 2, 0, 1, 1, 0, 0, 0, 0], 2)).toBe(2); // yutadi
    expect(tttBest([1, 1, 0, 0, 2, 0, 0, 0, 0], 2)).toBe(2); // to'sadi
  });

  it("har o'yin namoyish rejimida yiqilmay ishlaydi", () => {
    for (const id of GAME_IDS) {
      const g = createGame(id);
      for (let i = 0; i < 600; i++) g.update(1 / 15, null);
      g.playing = true;
      for (let i = 0; i < 200; i++) g.update(1 / 30, { x: Math.sin(i), y: Math.cos(i), dir: (["up", "down", "left", "right", null] as const)[i % 5], a: i % 7 === 0, tap: i % 11 === 0 ? { x: 0.5, y: 0.5 } : null });
      expect(g.score).toBeGreaterThanOrEqual(0);
    }
  });
});
