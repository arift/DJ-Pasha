import { shuffle } from "./utils";

export type QueueItem = {
  id: string;
  url: string;
  by: string;
  byNickname: string | null;
};

type onChange = (queue: Array<QueueItem>) => void;

class Queue {
  #queue: Array<QueueItem>;
  onChange?: onChange;
  constructor({ onChange }: { onChange?: onChange }) {
    this.#queue = [];
    this.onChange = onChange;
  }

  onChangeQueue = () => {
    if (this.onChange) {
      this.onChange(this.#queue);
    }
  };

  get(idx: number) {
    return this.#queue[idx];
  }

  getAll() {
    return this.#queue;
  }

  slice(start?: number, end?: number) {
    return this.#queue.slice(start, end);
  }

  pop() {
    const item = this.#queue.shift();
    this.onChangeQueue();
    return item;
  }

  enqueue(item: QueueItem | Array<QueueItem>) {
    if (Array.isArray(item)) {
      this.#queue.push(...item);
    } else {
      this.#queue.push(item);
    }
    this.onChangeQueue();
  }

  remove(idx: number) {
    this.#queue.splice(idx, 1);
    this.onChangeQueue();
  }

  clear(start?: number, end?: number) {
    console.log("START", start);
    console.log("end", end);
    if (typeof start === "number" && typeof end !== "number") {
      this.#queue.splice(start, this.#queue.length - start);
    } else if (typeof start === "number" && typeof end === "number") {
      this.#queue.splice(start, end - start + 1);
    } else {
      this.#queue = [];
    }
    this.onChangeQueue();
  }

  move(fromIdx: number, toIdx: number) {
    if (
      toIdx < 0 ||
      fromIdx < 0 ||
      fromIdx > this.#queue.length - 1 ||
      toIdx > this.#queue.length - 1
    ) {
      throw new Error(`Out of bounds.`);
    }
    this.#queue.splice(toIdx, 0, this.#queue.splice(fromIdx, 1)[0]);
    this.onChangeQueue();
  }

  shuffle() {
    this.#queue = shuffle(this.#queue);
    this.onChangeQueue();
  }

  size() {
    return this.#queue.length;
  }
}

export default Queue;
